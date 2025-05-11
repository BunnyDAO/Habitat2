import { Connection, PublicKey, Keypair, VersionedTransaction, ParsedAccountData } from '@solana/web3.js';
import { Pool } from 'pg';
import { createClient } from 'redis';

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

  constructor(pool: Pool, connection: Connection, redisClient: ReturnType<typeof createClient> | null = null) {
    this.pool = pool;
    this.connection = connection;
    this.redisClient = redisClient;
  }

  async getQuote(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: number,
    slippageBps: number = 50
  ): Promise<JupiterQuoteResponse> {
    // TODO: Implement Jupiter quote API call
    throw new Error('Not implemented');
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

      // Get quote from Jupiter API
      const quoteData = await this.getQuote(
        new PublicKey(inputMint),
        new PublicKey(outputMint),
        baseAmount,
        slippageBps
      );

      // TODO: Implement swap execution
      throw new Error('Not implemented');

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