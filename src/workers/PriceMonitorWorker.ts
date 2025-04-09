import { BaseWorker } from './BaseWorker';
import { PriceMonitoringJob } from '../types/jobs';
import { PriceFeedService } from '../services/PriceFeedService';
import { 
  PublicKey, 
  TransactionMessage, 
  VersionedTransaction, 
  TransactionInstruction,
  Keypair
} from '@solana/web3.js';

const JUPITER_API_BASE = 'https://api.jup.ag/swap/v1';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Helper function to convert instruction fields to TransactionInstruction
const convertInstruction = (instr: any): TransactionInstruction | null => {
  try {
    if (!instr || typeof instr !== 'object') {
      console.error('Invalid instruction:', instr);
      return null;
    }

    if (!instr.programId || typeof instr.programId !== 'string') {
      console.error('Invalid programId:', instr.programId);
      return null;
    }

    if (!Array.isArray(instr.accounts)) {
      console.error('Invalid accounts array:', instr.accounts);
      return null;
    }

    return {
      programId: new PublicKey(instr.programId),
      keys: instr.accounts.map((account: any) => ({
        pubkey: new PublicKey(account.pubkey),
        isSigner: Boolean(account.isSigner),
        isWritable: Boolean(account.isWritable)
      })),
      data: Buffer.from(instr.data || '', 'base64')
    };
  } catch (error) {
    console.error('Error converting instruction:', error);
    console.error('Problematic instruction:', instr);
    return null;
  }
};

// Helper function to execute transaction with retries
const executeTransaction = async (
  connection: any,
  transaction: VersionedTransaction,
  tradingKeypair: Keypair,
  lastValidBlockHeight: number,
  retries = 3
): Promise<string> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        // Get fresh blockhash for retries
        const { blockhash: newBlockhash } = await connection.getLatestBlockhash('finalized');
        transaction.message.recentBlockhash = newBlockhash;
        // Re-sign with new blockhash
        transaction.signatures = [];
        transaction.sign([tradingKeypair]);
      }

      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: 'confirmed'
      });

      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash: transaction.message.recentBlockhash,
        lastValidBlockHeight
      });

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err.toString()}`);
      }

      return signature;
    } catch (error: any) {
      console.log(`Attempt ${attempt} failed:`, error);
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error('All retry attempts failed');
};

export class PriceMonitorWorker extends BaseWorker {
  private priceFeedService: PriceFeedService;
  private lastTriggered: number = 0;
  private cooldownPeriod: number = 300000; // 5 minutes cooldown
  private tradingWalletPublicKey: string;
  private tradingWalletSecretKey: Uint8Array;
  private targetPrice: number;
  private direction: 'above' | 'below';
  private percentageToSell: number;

  constructor(job: PriceMonitoringJob, endpoint: string) {
    super(job, endpoint);
    this.priceFeedService = PriceFeedService.getInstance();
    this.tradingWalletPublicKey = job.tradingWalletPublicKey;
    this.tradingWalletSecretKey = job.tradingWalletSecretKey;
    this.targetPrice = job.targetPrice;
    this.direction = job.direction;
    this.percentageToSell = job.percentageToSell;

    // Bind the price update handler
    this.handlePriceUpdate = this.handlePriceUpdate.bind(this);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log(`Starting price monitor for SOL at $${this.targetPrice}`);
    this.priceFeedService.on('price_update', this.handlePriceUpdate);
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.priceFeedService.removeListener('price_update', this.handlePriceUpdate);
    this.isRunning = false;
  }

  private async handlePriceUpdate(prices: { sol: number }): Promise<void> {
    const currentPrice = prices.sol;
    const now = Date.now();

    // Check if we're still in cooldown period
    if (now - this.lastTriggered < this.cooldownPeriod) {
      return;
    }

    const shouldTrigger = this.direction === 'above' 
      ? currentPrice >= this.targetPrice
      : currentPrice <= this.targetPrice;

    if (shouldTrigger) {
      console.log(`Price condition met! SOL price: $${currentPrice}`);
      await this.executeTrade(currentPrice);
      this.lastTriggered = now;
      
      // After executing the trade, remove the job
      const job = this.job as PriceMonitoringJob;
      job.lastActivity = new Date().toISOString();
      job.lastTriggerPrice = currentPrice;
      job.isActive = false;  // Mark the job as inactive
      
      // Dispatch an event to remove the job from UI
      window.dispatchEvent(new CustomEvent('remove-price-monitor', {
        detail: { jobId: job.id }
      }));
      
      // Stop the worker
      await this.stop();
    }
  }

  private async executeTrade(currentPrice: number): Promise<void> {
    try {
      // Get trading wallet's SOL balance
      const tradingWallet = new PublicKey(this.tradingWalletPublicKey);
      const balance = await this.connection.getBalance(tradingWallet);
      const solBalance = balance / 1e9; // Convert lamports to SOL

      // Check SOL balance for fees
      if (balance < 10000) { // ~0.00001 SOL for fees
        throw new Error('Insufficient SOL balance for transaction fees');
      }

      // Calculate amount to swap
      const amountToSwap = (solBalance * this.percentageToSell) / 100;
      const amountInLamports = Math.floor(amountToSwap * 1e9);

      if (amountInLamports <= 0 || amountInLamports >= balance - 10000) {
        throw new Error('Invalid swap amount or insufficient balance');
      }

      // Validate fee amount
      const feeAmount = Math.floor(amountInLamports * 0.0005); // 0.05%
      if (feeAmount < 1000) { // Minimum fee amount in lamports
        throw new Error(`Transaction amount too small for fee calculation. Minimum fee amount is 0.000001 SOL`);
      }

      console.log(`Executing trade for ${amountToSwap} SOL at $${currentPrice}`);

      // Try direct route first
      let quoteResponse = await fetch(
        `${JUPITER_API_BASE}/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${amountInLamports}&slippageBps=50&onlyDirectRoutes=true`
      );

      // If direct route fails, try without restrictions
      if (!quoteResponse.ok) {
        console.log('Direct route not found, trying alternative routes...');
        quoteResponse = await fetch(
          `${JUPITER_API_BASE}/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${amountInLamports}&slippageBps=50`
        );
      }

      if (!quoteResponse.ok) {
        throw new Error(`Quote request failed: ${await quoteResponse.text()}`);
      }

      const quoteData = await quoteResponse.json();

      // Get swap instructions
      const swapRequestBody = {
        quoteResponse: quoteData,
        userPublicKey: this.tradingWalletPublicKey,
        wrapUnwrapSOL: true,
        prioritizationFeeLamports: 5000,
        asLegacyTransaction: false,
        useTokenLedger: false,
        mode: "instructions"
      };

      const swapResponse = await fetch(`${JUPITER_API_BASE}/swap-instructions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(swapRequestBody)
      });

      if (!swapResponse.ok) {
        throw new Error(`Swap request failed: ${await swapResponse.text()}`);
      }

      const swapData = await swapResponse.json();
      const {
        computeBudgetInstructions = [],
        setupInstructions = [],
        swapInstruction,
        cleanupInstruction,
        addressLookupTableAddresses = []
      } = swapData;

      // Get the trading wallet keypair
      const tradingKeypair = Keypair.fromSecretKey(new Uint8Array(this.tradingWalletSecretKey));

      // Get latest blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');

      // Convert all instructions
      const validatedInstructions = [
        ...computeBudgetInstructions.map(convertInstruction),
        ...setupInstructions.map(convertInstruction),
        convertInstruction(swapInstruction),
        ...(cleanupInstruction ? [convertInstruction(cleanupInstruction)] : [])
      ].filter((instr): instr is TransactionInstruction => instr !== null);

      if (validatedInstructions.length === 0) {
        throw new Error('No valid instructions generated from swap response');
      }

      // Construct the transaction
      const messageV0 = new TransactionMessage({
        payerKey: tradingKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: validatedInstructions
      }).compileToV0Message([]);

      const transaction = new VersionedTransaction(messageV0);

      // Execute the transaction with retries
      const signature = await executeTransaction(
        this.connection,
        transaction,
        tradingKeypair,
        lastValidBlockHeight
      );

      console.log('Swap transaction confirmed:', signature);

      // Dispatch balance update event
      window.dispatchEvent(new CustomEvent('update-balances'));
      
    } catch (error) {
      console.error('Error executing price monitor trade:', error);
      throw error; // Re-throw to handle in caller
    }
  }
} 