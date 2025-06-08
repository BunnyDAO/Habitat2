import { Connection, PublicKey, Keypair, VersionedTransaction, ParsedAccountData } from '@solana/web3.js';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { JupiterService } from './jupiter.service';

// Common token decimals
const TOKEN_DECIMALS: { [key: string]: number } = {
    'So11111111111111111111111111111111111111112': 9,  // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,  // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6,  // USDT
};

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

interface SwapRequest {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps?: number;
    walletKeypair: {
        publicKey: string;
        secretKey: number[];
    };
    feeWalletPubkey?: string;
    feeBps?: number;
}

interface SwapResponse {
    signature: string;
    inputAmount: string;
    outputAmount: string;
    routePlan?: Array<{
        swapInfo: {
            label: string;
            inputMint: string;
            outputMint: string;
        };
        percent: number;
    }>;
    message: string;
}

interface JupiterQuoteResponse {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    priceImpactPct: number;
    routePlan: Array<{
        swapInfo: {
            ammKey: string;
            label: string;
            inputMint: string;
            outputMint: string;
            inAmount: string;
            outAmount: string;
            feeAmount: string;
            feeMint: string;
        };
        percent: number;
    }>;
    contextSlot: number;
    timeTaken: number;
}

export class SwapService {
  private pool: Pool;
  private connection: Connection;
  private redisClient: ReturnType<typeof createClient> | null;
  private jupiterService: JupiterService;

  constructor(pool: Pool, connection: Connection, redisClient: ReturnType<typeof createClient> | null = null) {
    this.pool = pool;
    this.connection = connection;
    this.redisClient = redisClient;
    this.jupiterService = new JupiterService(pool, redisClient);
  }

  async getQuote(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: number,
    slippageBps: number = 50
  ): Promise<JupiterQuoteResponse> {
    const quote = await this.jupiterService.getQuote(
      inputMint.toString(),
      outputMint.toString(),
      amount,
      slippageBps
    );
    
    // Convert to the expected format
    return {
      inputMint: inputMint.toString(),
      outputMint: outputMint.toString(),
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      otherAmountThreshold: quote.otherAmountThreshold,
      swapMode: quote.swapMode,
      slippageBps: quote.slippageBps,
      priceImpactPct: quote.priceImpactPct,
      routePlan: quote.routePlan || [],
      contextSlot: 0,
      timeTaken: 0
    };
  }

  async executeSwap(request: SwapRequest): Promise<SwapResponse> {
    try {
      const {
        inputMint,
        outputMint,
        amount,
        slippageBps = 50,
        walletKeypair,
        feeWalletPubkey,
        feeBps = 100
      } = request;

      console.log('Starting swap execution with request:', {
        inputMint,
        outputMint,
        amount,
        slippageBps
      });

      // Create keypair from provided secret key
      const tradingKeypair = Keypair.fromSecretKey(new Uint8Array(walletKeypair.secretKey));
      console.log('Trading wallet public key:', tradingKeypair.publicKey.toBase58());
    
      // Check SOL balance for fees and rent
      const solBalance = await this.connection.getBalance(tradingKeypair.publicKey);
      console.log('Current SOL balance:', solBalance / 1e9, 'SOL');
      
      // Calculate required SOL for the transaction
      const MIN_SOL_BALANCE = 10000000; // 0.01 SOL for fees and rent
      const REQUIRED_SOL = inputMint === WSOL_MINT ? 
        Math.max(MIN_SOL_BALANCE, Math.ceil(amount * 1e9)) : // If swapping SOL, need amount + fees
        MIN_SOL_BALANCE; // If swapping tokens, just need fees
      
      if (solBalance < REQUIRED_SOL) {
        const requiredSol = REQUIRED_SOL / 1e9;
        const currentSol = solBalance / 1e9;
        throw new Error(
          `Insufficient SOL balance for transaction. ` +
          `Need at least ${requiredSol} SOL (${inputMint === WSOL_MINT ? 'amount + fees' : 'fees'}), ` +
          `have ${currentSol} SOL`
        );
      }

      // Get token decimals
      const inputDecimals = await this.getTokenDecimals(inputMint);
      const outputDecimals = await this.getTokenDecimals(outputMint);

      // Convert amount to base units using correct decimals
      const baseAmount = Number.isInteger(amount) ? 
        amount : // If it's already in base units
        Math.floor(amount * Math.pow(10, inputDecimals)); // If it's in token units

      console.log('Converting amount:', {
        originalAmount: amount,
        inputDecimals,
        baseAmount,
        isInteger: Number.isInteger(amount)
      });

      // Get quote from Jupiter API directly
      const jupiterQuote = await this.jupiterService.getQuote(
        inputMint,
        outputMint,
        baseAmount,
        slippageBps
      );

      console.log('Got quote from Jupiter:', {
        inAmount: jupiterQuote.inAmount,
        outAmount: jupiterQuote.outAmount,
        priceImpactPct: jupiterQuote.priceImpactPct
      });

      // Get swap transaction from Jupiter
      const swapTransaction = await this.jupiterService.executeSwap(
        jupiterQuote,
        tradingKeypair.publicKey.toString(),
        feeWalletPubkey
      );

      console.log('Got swap transaction from Jupiter');

      // Deserialize and sign the transaction
      const transactionBuf = Buffer.from(swapTransaction.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      
      // Sign the transaction
      transaction.sign([tradingKeypair]);

      // Send and confirm the transaction
      const signature = await this.connection.sendTransaction(transaction, {
        maxRetries: 3,
        skipPreflight: false,
      });

      console.log('Transaction sent:', signature);

      // Wait for confirmation
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log('Transaction confirmed:', signature);

      // TODO: Log the swap to database (requires swaps table)
      // await this.logSwap({
      //   walletPubkey: tradingKeypair.publicKey.toString(),
      //   inputMint,
      //   outputMint,
      //   inputAmount: baseAmount,
      //   outputAmount: parseInt(quoteData.outAmount),
      //   txid: signature,
      //   feeBps
      // });

      // Calculate UI amounts for response
      const inputUiAmount = (baseAmount / Math.pow(10, inputDecimals)).toFixed(inputDecimals);
      const outputUiAmount = (parseInt(jupiterQuote.outAmount) / Math.pow(10, outputDecimals)).toFixed(outputDecimals);

      return {
        signature,
        inputAmount: inputUiAmount,
        outputAmount: outputUiAmount,
        routePlan: jupiterQuote.routePlan,
        message: `Successfully swapped ${inputUiAmount} tokens for ${outputUiAmount} tokens`
      };

    } catch (error) {
      console.error('Error executing swap:', error);
      throw error;
    }
  }

  private async getTokenDecimals(mint: string): Promise<number> {
    if (TOKEN_DECIMALS[mint]) {
      return TOKEN_DECIMALS[mint];
    }

    try {
      const mintPubkey = new PublicKey(mint);
      const accountInfo = await this.connection.getParsedAccountInfo(mintPubkey);
      
      if (!accountInfo.value) {
        throw new Error(`Token mint ${mint} not found`);
      }
      
      const parsedData = accountInfo.value.data as ParsedAccountData;
      return parsedData.parsed.info.decimals;
    } catch (error) {
      console.error('Error getting token decimals:', error);
      throw error;
    }
  }

  private async logSwap(params: {
    walletPubkey: string;
    inputMint: string;
    outputMint: string;
    inputAmount: number;
    outputAmount: number;
    txid: string;
    feeBps?: number;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO swaps (
          wallet_pubkey,
          input_mint,
          output_mint,
          input_amount,
          output_amount,
          txid,
          fee_bps
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        params.walletPubkey,
        params.inputMint,
        params.outputMint,
        params.inputAmount,
        params.outputAmount,
        params.txid,
        params.feeBps
      ]);
    } finally {
      client.release();
    }
  }
} 