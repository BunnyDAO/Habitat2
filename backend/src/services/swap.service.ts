import { Connection, PublicKey, Keypair, VersionedTransaction, ParsedAccountData, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Pool } from 'pg';

// Common token decimals
const TOKEN_DECIMALS: { [key: string]: number } = {
    'So11111111111111111111111111111111111111112': 9,  // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,  // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6,  // USDT
};

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const MIN_SOL_AMOUNT = 0.005; // Minimum SOL amount for swaps
const MIN_TOKEN_AMOUNT = 0.1; // Minimum token amount for swaps
const MIN_SOL_THRESHOLD = 0.002; // Minimum SOL threshold for fees
const DUST_THRESHOLD = 98; // Percentage threshold for dust handling

interface JupiterQuoteResponse {
  inAmount: string;
  outAmount: string;
  [key: string]: unknown;
}

interface SwapRequestBody {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
  wrapAndUnwrapSol: boolean;
  dynamicSlippage: { maxBps: number };
  feeAccount?: string;
}

export interface SwapParams {
  inputMint: string;           // Input token mint address
  outputMint: string;          // Output token mint address
  amount: number;              // Amount of input token to swap
  slippageBps?: number;        // Slippage tolerance in basis points
  walletKeypair: Keypair;      // User's keypair for signing
  feeWalletPubkey?: string;    // Public key of the fee wallet
  feeBps?: number;             // Fee in basis points
  percentage?: number;         // Percentage of balance to mirror
  theirPreBalance?: number;    // Their pre-swap balance
  theirAmount?: number;        // Their swap amount
}

export interface SwapResult {
  txid: string;                // Transaction ID
  inputAmount: number;         // Input amount in token's native format
  outputAmount: number;        // Expected output amount in token's native format
  inputDecimals: number;       // Decimals of input token
  outputDecimals: number;      // Decimals of output token
  fee?: number;                // Fee amount in token's native format
}

export class SwapService {
  private pool: Pool;
  private connection: Connection;

  constructor(pool: Pool, connection: Connection) {
    this.pool = pool;
    this.connection = connection;
  }

  async swapTokens(params: SwapParams): Promise<{ signature: string }> {
    try {
      const {
        inputMint,
        outputMint,
        amount,
        slippageBps = 100,
        walletKeypair,
        feeWalletPubkey,
        feeBps = 0,
        percentage = 100,
        theirPreBalance,
        theirAmount
      } = params;

      console.log(`Starting swap: ${amount} from ${inputMint} to ${outputMint}`);

      // Check if amount meets minimum requirements
      if (inputMint === WSOL_MINT) {
        if (amount < MIN_SOL_AMOUNT) {
          throw new Error(`Amount ${amount} SOL is below minimum ${MIN_SOL_AMOUNT} SOL`);
        }
        
        // Check SOL balance for fees
        const solBalance = await this.connection.getBalance(walletKeypair.publicKey);
        if (solBalance / 1e9 < MIN_SOL_THRESHOLD) {
          throw new Error(`Insufficient SOL balance for fees: ${solBalance / 1e9} SOL`);
        }
      } else {
        // For non-SOL tokens, check minimum amount
        if (amount < MIN_TOKEN_AMOUNT) {
          throw new Error(`Amount ${amount} is below minimum ${MIN_TOKEN_AMOUNT}`);
        }
        
        // Check if we have enough SOL for fees
        const solBalance = await this.connection.getBalance(walletKeypair.publicKey);
        if (solBalance / 1e9 < MIN_SOL_THRESHOLD) {
          throw new Error(`Insufficient SOL balance for fees: ${solBalance / 1e9} SOL`);
        }
      }

      // Get token decimals
      const inputDecimals = await this.getTokenDecimals(inputMint);
      const outputDecimals = await this.getTokenDecimals(outputMint);

      // Convert amount to base units
      const baseAmount = Math.floor(amount * Math.pow(10, inputDecimals));

      // Get quote from Jupiter API
      const quoteData = await this.getQuote(inputMint, outputMint, baseAmount, slippageBps);
      
      // Create swap request body
      const swapRequestBody: SwapRequestBody = {
        quoteResponse: quoteData,
        userPublicKey: walletKeypair.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicSlippage: { maxBps: slippageBps },
        ...(feeWalletPubkey && { feeAccount: feeWalletPubkey })
      };

      // Execute swap through Jupiter API
      const response = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(swapRequestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Jupiter API error:', errorText);
        throw new Error(`Failed to execute swap: ${errorText}`);
      }

      const swapResult = await response.json();
      const swapTransactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
      const swapTransaction = VersionedTransaction.deserialize(swapTransactionBuf);

      // Sign and send transaction
      swapTransaction.sign([walletKeypair]);
      const signature = await this.connection.sendTransaction(swapTransaction);

      // Log the swap in the database
      await this.logSwap({
        walletPubkey: walletKeypair.publicKey.toString(),
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount: Number(quoteData.outAmount) / Math.pow(10, outputDecimals),
        txid: signature,
        percentage,
        theirPreBalance,
        theirAmount
      });

      return { signature };
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
      
      if ('parsed' in accountInfo.value.data) {
        const parsedData = accountInfo.value.data as ParsedAccountData;
        const decimals = parsedData.parsed?.info?.decimals;
        if (typeof decimals === 'number') {
          return decimals;
        }
      }
      throw new Error(`Could not parse decimals for token ${mint}`);
    } catch (error) {
      console.error(`Error fetching token info for ${mint}:`, error);
      throw new Error(`Failed to get decimals for token ${mint}`);
    }
  }

  private async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number
  ): Promise<JupiterQuoteResponse> {
    const response = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Jupiter quote error:', errorText);
      throw new Error(`Failed to get quote: ${errorText}`);
    }

    const quoteData = await response.json();
    return {
      inAmount: quoteData.inAmount,
      outAmount: quoteData.outAmount,
      ...quoteData
    };
  }

  private async logSwap(params: {
    walletPubkey: string;
    inputMint: string;
    outputMint: string;
    inputAmount: number;
    outputAmount: number;
    txid: string;
    percentage?: number;
    theirPreBalance?: number;
    theirAmount?: number;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      // First check if the trading wallet exists
      const walletResult = await client.query(
        'SELECT id, main_wallet_pubkey FROM trading_wallets WHERE wallet_pubkey = $1',
        [params.walletPubkey]
      );

      if (walletResult.rows.length === 0) {
        console.warn(`Trading wallet ${params.walletPubkey} not found in database, skipping transaction log`);
        return;
      }

      const { id: tradingWalletId, main_wallet_pubkey: mainWalletPubkey } = walletResult.rows[0];

      // Prepare transaction details
      const details = {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        outputAmount: params.outputAmount,
        percentage: params.percentage,
        theirPreBalance: params.theirPreBalance,
        theirAmount: params.theirAmount
      };

      await client.query(`
        INSERT INTO transactions (
          trading_wallet_id,
          main_wallet_pubkey,
          wallet_pubkey,
          signature,
          type,
          amount,
          token_mint,
          timestamp,
          details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
      `, [
        tradingWalletId,
        mainWalletPubkey,
        params.walletPubkey,
        params.txid,
        'swap',
        params.inputAmount,
        params.inputMint,
        JSON.stringify(details)
      ]);
    } catch (error) {
      console.error('Error logging swap transaction:', error);
      // Don't throw the error as we don't want to fail the swap if logging fails
    } finally {
      client.release();
    }
  }
} 