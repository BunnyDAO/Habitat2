import { BaseWorker } from './BaseWorker';
import { PriceMonitoringJob } from '../types/jobs';
import { 
  PublicKey, 
  TransactionMessage, 
  VersionedTransaction, 
  TransactionInstruction,
  Keypair,
  Connection
} from '@solana/web3.js';

const JUPITER_API_BASE = 'https://api.jup.ag/swap/v1';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Helper function to convert instruction fields to TransactionInstruction
const convertInstruction = (instr: {
  programId: string;
  accounts: Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data?: string;
}): TransactionInstruction | null => {
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
      keys: instr.accounts.map((account) => ({
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
  connection: Connection,
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
    } catch (error) {
      console.log(`Attempt ${attempt} failed:`, error);
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error('All retry attempts failed');
};

export class PriceMonitorWorker extends BaseWorker {
  private lastTriggered: number = 0;
  private cooldownPeriod: number = 300000; // 5 minutes cooldown
  private tradingWalletPublicKey: string;
  private tradingWalletSecretKey: Uint8Array;
  private targetPrice: number;
  private direction: 'above' | 'below';
  private percentageToSell: number;
  private tradingWalletKeypair: Keypair;

  constructor(job: PriceMonitoringJob, endpoint: string) {
    super(job, endpoint);
    this.tradingWalletPublicKey = job.tradingWalletPublicKey;
    this.tradingWalletSecretKey = job.tradingWalletSecretKey;
    this.targetPrice = job.targetPrice;
    this.direction = job.direction;
    this.percentageToSell = job.percentageToSell;
    this.tradingWalletKeypair = Keypair.fromSecretKey(this.tradingWalletSecretKey);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      // Start price monitoring
      this.isRunning = true;
      await this.monitorPrice();
    } catch (error) {
      console.error('Error starting price monitor:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
  }

  private async monitorPrice(): Promise<void> {
    while (this.isRunning) {
      try {
        // Get current SOL price from Jupiter API
        const response = await fetch(`${JUPITER_API_BASE}/price?ids=SOL`);
        const data = await response.json();
        const currentPrice = data.SOL;

        const shouldTrigger = this.direction === 'above' 
          ? currentPrice >= this.targetPrice
          : currentPrice <= this.targetPrice;

        if (shouldTrigger && Date.now() - this.lastTriggered >= this.cooldownPeriod) {
          console.log(`Price condition met! SOL price: $${currentPrice}`);
          await this.executeTrade(currentPrice);
          this.lastTriggered = Date.now();
          
          // Update job status
          (this.job as PriceMonitoringJob).lastActivity = new Date().toISOString();
          (this.job as PriceMonitoringJob).lastTriggerPrice = currentPrice;
          (this.job as PriceMonitoringJob).isActive = false;
          
          // Stop monitoring since condition was met
          await this.stop();
          break;
        }

        // Wait 10 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 10000));
      } catch (error) {
        console.error('Error monitoring price:', error);
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait longer on error
      }
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
        quoteResponse = await fetch(
          `${JUPITER_API_BASE}/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${amountInLamports}&slippageBps=50`
        );
      }

      if (!quoteResponse.ok) {
        throw new Error(`Failed to get quote: ${quoteResponse.statusText}`);
      }

      const quote = await quoteResponse.json();

      // Get transaction data
      const swapResponse = await fetch(`${JUPITER_API_BASE}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          route: quote,
          userPublicKey: this.tradingWalletPublicKey,
          wrapUnwrapSOL: true
        })
      });

      if (!swapResponse.ok) {
        throw new Error(`Failed to get swap transaction: ${swapResponse.statusText}`);
      }

      const swapData = await swapResponse.json();

      // Convert instructions
      const instructions = swapData.instructions.map(convertInstruction).filter(Boolean);
      if (instructions.length !== swapData.instructions.length) {
        throw new Error('Failed to convert all instructions');
      }

      // Get latest blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');

      // Create and sign transaction
      const messageV0 = new TransactionMessage({
        payerKey: tradingWallet,
        recentBlockhash: blockhash,
        instructions
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([this.tradingWalletKeypair]);

      // Execute transaction with retries
      const signature = await executeTransaction(
        this.connection,
        transaction,
        this.tradingWalletKeypair,
        lastValidBlockHeight
      );

      console.log(`Trade executed successfully! Signature: ${signature}`);

      // Update profit tracking
      const profit = currentPrice * amountToSwap - amountToSwap;
      (this.job as PriceMonitoringJob).profitTracking.trades.push({
        timestamp: new Date().toISOString(),
        type: 'sell',
        amount: amountToSwap,
        price: currentPrice,
        profit
      });

    } catch (error) {
      console.error('Error executing trade:', error);
      throw error;
    }
  }
} 