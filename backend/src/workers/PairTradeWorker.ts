import { BaseWorker } from './BaseWorker';
import { PairTradeJob } from '../types/jobs';
import { TokenService } from '../services/TokenService';
import { createRateLimitedConnection } from '../utils/connection';
import { 
  PublicKey, 
  Keypair, 
  Transaction, 
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction
} from '@solana/spl-token';

// Jupiter Lite API Configuration
const JUPITER_PLATFORM_FEE_BPS = 20; // 0.2% platform fee
const JUPITER_FEE_ACCOUNT = '2yrLVmLcMyZyKaV8cZKkk79zuvMPqhVjLMWkQFQtj4g6';

export class PairTradeWorker extends BaseWorker {
  private tradingWalletKeypair: Keypair;
  private tokenService: TokenService;
  private isProcessingSwap: boolean = false;

  constructor(job: PairTradeJob, endpoint: string, tokenService: TokenService) {
    super(job, endpoint);
    this.tokenService = tokenService;
    
    // Initialize trading wallet keypair
    this.tradingWalletKeypair = Keypair.fromSecretKey(job.tradingWalletSecretKey);
    
    console.log(`PairTradeWorker initialized for ${job.tokenASymbol}/${job.tokenBSymbol} pair`);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      // Create connection
      this.connection = createRateLimitedConnection('https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a');
      
      // Validate token pair
      const validation = this.tokenService.validateTokenPair(
        (this.job as PairTradeJob).tokenAMint,
        (this.job as PairTradeJob).tokenBMint
      );
      
      if (!validation.isValid) {
        throw new Error(`Invalid token pair: ${validation.error}`);
      }

      // Ensure token accounts exist
      await this.ensureTokenAccounts();
      
      this.isRunning = true;
      console.log(`PairTradeWorker started for strategy ${this.job.id}`);
    } catch (error) {
      console.error('Error starting PairTradeWorker:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log(`PairTradeWorker stopped for strategy ${this.job.id}`);
  }

  /**
   * Execute a swap from current token to the other token
   */
  async executeSwap(trigger: string = 'manual'): Promise<{
    success: boolean;
    signature?: string;
    error?: string;
    swapDetails?: {
      fromToken: 'A' | 'B';
      toToken: 'A' | 'B';
      fromAmount: number;
      toAmount: number;
      price: number;
    };
  }> {
    if (this.isProcessingSwap) {
      return { success: false, error: 'Swap already in progress' };
    }

    this.isProcessingSwap = true;
    
    try {
      const job = this.job as PairTradeJob;
      const currentToken = job.currentToken;
      const fromToken = currentToken;
      const toToken = currentToken === 'A' ? 'B' : 'A';
      
      const fromMint = currentToken === 'A' ? job.tokenAMint : job.tokenBMint;
      const toMint = currentToken === 'A' ? job.tokenBMint : job.tokenAMint;
      const fromSymbol = currentToken === 'A' ? job.tokenASymbol : job.tokenBSymbol;
      const toSymbol = currentToken === 'A' ? job.tokenBSymbol : job.tokenASymbol;
      
      console.log(`[PairTrade] Executing swap: ${fromSymbol} -> ${toSymbol}`);
      
      // Get current balance of the token we're swapping from
      const currentBalance = await this.getTokenBalance(fromMint);
      if (currentBalance <= 0) {
        return { success: false, error: `No ${fromSymbol} balance to swap` };
      }
      
      // Calculate amount to swap based on allocation percentage
      const amountToSwap = Math.floor(currentBalance * (job.allocationPercentage / 100));
      if (amountToSwap <= 0) {
        return { success: false, error: 'Calculated swap amount is zero' };
      }
      
      console.log(`[PairTrade] Swapping ${amountToSwap} ${fromSymbol} to ${toSymbol}`);
      
      // Get quote from Jupiter Lite API
      const quote = await this.getJupiterQuote(fromMint, toMint, amountToSwap, job.maxSlippage);
      
      // Execute the swap
      const swapResult = await this.executeJupiterSwap(quote);
      
      if (swapResult.success && swapResult.signature) {
        // Update job state
        job.currentToken = toToken;
        job.lastSwapTimestamp = new Date().toISOString();
        
        // Calculate swap details
        const toAmount = parseFloat(quote.outAmount);
        const fromAmountUI = amountToSwap / Math.pow(10, await this.getTokenDecimals(fromMint));
        const toAmountUI = toAmount / Math.pow(10, await this.getTokenDecimals(toMint));
        const price = fromAmountUI / toAmountUI;
        
        const swapDetails = {
          fromToken,
          toToken: toToken as 'A' | 'B',
          fromAmount: fromAmountUI,
          toAmount: toAmountUI,
          price
        };
        
        // Add to swap history
        job.swapHistory.push({
          timestamp: new Date().toISOString(),
          fromToken,
          toToken: toToken as 'A' | 'B',
          fromAmount: fromAmountUI,
          toAmount: toAmountUI,
          price,
          profit: 0 // Calculate profit later when we have historical data
        });
        
        // Update job activity
        this.updateJobActivity();
        
        console.log(`[PairTrade] Swap completed successfully: ${swapResult.signature}`);
        
        return {
          success: true,
          signature: swapResult.signature,
          swapDetails
        };
      } else {
        return { success: false, error: swapResult.error || 'Swap failed' };
      }
    } catch (error) {
      console.error('[PairTrade] Error executing swap:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    } finally {
      this.isProcessingSwap = false;
    }
  }

  /**
   * Get current status of the pair trade
   */
  async getStatus(): Promise<{
    currentToken: 'A' | 'B';
    currentTokenSymbol: string;
    currentBalance: number;
    balanceUSD: number;
    lastSwapTimestamp?: string;
    swapCount: number;
    allocationPercentage: number;
    isProcessingSwap: boolean;
  }> {
    const job = this.job as PairTradeJob;
    const currentMint = job.currentToken === 'A' ? job.tokenAMint : job.tokenBMint;
    const currentSymbol = job.currentToken === 'A' ? job.tokenASymbol : job.tokenBSymbol;
    
    const balance = await this.getTokenBalance(currentMint);
    const decimals = await this.getTokenDecimals(currentMint);
    const balanceUI = balance / Math.pow(10, decimals);
    
    return {
      currentToken: job.currentToken,
      currentTokenSymbol: currentSymbol,
      currentBalance: balanceUI,
      balanceUSD: 0, // TODO: Calculate USD value
      lastSwapTimestamp: job.lastSwapTimestamp,
      swapCount: job.swapHistory.length,
      allocationPercentage: job.allocationPercentage,
      isProcessingSwap: this.isProcessingSwap
    };
  }

  /**
   * Ensure token accounts exist for both tokens
   */
  private async ensureTokenAccounts(): Promise<void> {
    const job = this.job as PairTradeJob;
    const walletPubkey = this.tradingWalletKeypair.publicKey;
    
    await this.ensureTokenAccount(job.tokenAMint, walletPubkey);
    await this.ensureTokenAccount(job.tokenBMint, walletPubkey);
  }

  /**
   * Ensure a token account exists for the given mint
   */
  private async ensureTokenAccount(mintAddress: string, walletPubkey: PublicKey): Promise<void> {
    try {
      // Skip for SOL (native token)
      if (mintAddress === 'So11111111111111111111111111111111111111112') {
        return;
      }

      const mint = new PublicKey(mintAddress);
      const associatedTokenAddress = await getAssociatedTokenAddress(
        mint,
        walletPubkey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Check if account exists
      const accountInfo = await this.connection.getAccountInfo(associatedTokenAddress);
      
      if (!accountInfo) {
        console.log(`[PairTrade] Creating token account for ${mintAddress}`);
        
        const createAccountInstruction = createAssociatedTokenAccountInstruction(
          walletPubkey, // payer
          associatedTokenAddress, // associated token account
          walletPubkey, // owner
          mint, // mint
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const transaction = new Transaction().add(createAccountInstruction);
        const { blockhash } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = walletPubkey;

        transaction.sign(this.tradingWalletKeypair);
        const signature = await this.connection.sendTransaction(transaction, [this.tradingWalletKeypair]);
        await this.connection.confirmTransaction(signature);
        
        console.log(`[PairTrade] Token account created: ${signature}`);
      }
    } catch (error) {
      console.error(`[PairTrade] Error ensuring token account for ${mintAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get token balance for a specific mint
   */
  private async getTokenBalance(mintAddress: string): Promise<number> {
    try {
      const walletPubkey = this.tradingWalletKeypair.publicKey;
      
      // Handle SOL differently
      if (mintAddress === 'So11111111111111111111111111111111111111112') {
        const balance = await this.connection.getBalance(walletPubkey);
        return balance; // Returns lamports
      }
      
      // Get SPL token balance
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(walletPubkey, {
        mint: new PublicKey(mintAddress)
      });
      
      if (tokenAccounts.value.length === 0) {
        return 0;
      }
      
      const tokenAccount = tokenAccounts.value[0];
      const balance = tokenAccount.account.data.parsed.info.tokenAmount.amount;
      return parseInt(balance);
    } catch (error) {
      console.error(`[PairTrade] Error getting token balance for ${mintAddress}:`, error);
      return 0;
    }
  }

  /**
   * Get token decimals
   */
  private async getTokenDecimals(mintAddress: string): Promise<number> {
    try {
      const tokenInfo = await this.tokenService.getTokenInfo(mintAddress);
      return tokenInfo?.decimals || 6;
    } catch (error) {
      console.error(`[PairTrade] Error getting token decimals for ${mintAddress}:`, error);
      return 6;
    }
  }

  /**
   * Get Jupiter quote for token swap
   */
  private async getJupiterQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    maxSlippage: number
  ): Promise<any> {
    try {
      const slippageBps = Math.floor(maxSlippage * 100); // Convert percentage to basis points
      const platformFeeBps = JUPITER_PLATFORM_FEE_BPS;
      
      const queryString = `inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&platformFeeBps=${platformFeeBps}`;
      const response = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${queryString}`);
      
      if (!response.ok) {
        throw new Error(`Failed to get Jupiter quote: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('[PairTrade] Error getting Jupiter quote:', error);
      throw error;
    }
  }

  /**
   * Execute Jupiter swap
   */
  private async executeJupiterSwap(quote: any): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      const feeAccount = JUPITER_FEE_ACCOUNT;
      const response = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: this.tradingWalletKeypair.publicKey.toString(),
          wrapAndUnwrapSol: true,
          feeAccount: feeAccount
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Jupiter swap failed: ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      
      // The result should contain the transaction that we need to sign and send
      if (result.swapTransaction) {
        // Deserialize and sign the transaction
        const swapTransactionBuf = Buffer.from(result.swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
        
        // Sign the transaction
        transaction.sign([this.tradingWalletKeypair]);
        
        // Send the transaction
        const signature = await this.connection.sendTransaction(transaction);
        
        // Wait for confirmation
        const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
        
        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }
        
        return { success: true, signature };
      } else {
        throw new Error('No swap transaction returned from Jupiter API');
      }
    } catch (error) {
      console.error('[PairTrade] Error executing Jupiter swap:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Update job activity timestamp
   */
  private updateJobActivity(): void {
    if (this.job) {
      this.job.lastActivity = new Date().toISOString();
    }
  }
}