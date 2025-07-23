import { BaseWorker } from './BaseWorker';
import { PairTradeJob } from '../types/jobs';
import { TokenService } from '../services/TokenService';
import { createRateLimitedConnection } from '../utils/connection';
import { Pool } from 'pg';
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

// Trigger info interface
interface TriggerInfo {
  id: number;
  token_a_mint: string;
  token_b_mint: string;
  token_a_symbol: string;
  token_b_symbol: string;
  preferred_initial_token: 'A' | 'B';
  current_direction: 'A_TO_B' | 'B_TO_A' | 'HOLD';
  trigger_swap: boolean;
  last_triggered_at?: Date;
  trigger_count: number;
}

export class PairTradeWorker extends BaseWorker {
  private tradingWalletKeypair: Keypair;
  private tokenService: TokenService;
  private pool: Pool;
  private isProcessingSwap: boolean = false;

  constructor(job: PairTradeJob, endpoint: string, tokenService: TokenService, pool: Pool) {
    super(job, endpoint);
    this.tokenService = tokenService;
    this.pool = pool;
    
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
      const validation = await this.tokenService.validateTokenPair(
        (this.job as PairTradeJob).tokenAMint,
        (this.job as PairTradeJob).tokenBMint
      );
      
      if (!validation.isValid) {
        throw new Error(`Invalid token pair: ${validation.error}`);
      }

      // Ensure token accounts exist
      await this.ensureTokenAccounts();
      
      // NEW: Setup initial position if needed
      if (!this.hasInitialPositionSetup()) {
        await this.setupInitialPosition();
      }
      
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

  /**
   * Setup initial position based on database configuration
   */
  private async setupInitialPosition(): Promise<void> {
    const job = this.job as PairTradeJob;
    
    console.log('[PairTrade] Setting up initial position...');
    
    try {
      // 1. Get preferred initial token from database
      const triggerInfo = await this.getTriggerInfo(job.tokenAMint, job.tokenBMint);
      
      if (!triggerInfo) {
        console.warn('[PairTrade] No trigger info found, defaulting to token A');
        job.currentToken = 'A';
        return;
      }

      // 2. Get SOL balance
      const solBalance = await this.connection.getBalance(this.tradingWalletKeypair.publicKey);
      const solToSell = Math.floor(solBalance * (job.allocationPercentage / 100));
      
      if (solToSell <= 0) {
        console.warn('[PairTrade] Insufficient SOL balance for initial setup');
        job.currentToken = triggerInfo.preferred_initial_token;
        return;
      }
      
      // 3. Determine target token based on preference
      const targetMint = triggerInfo.preferred_initial_token === 'A' ? job.tokenAMint : job.tokenBMint;
      const targetSymbol = triggerInfo.preferred_initial_token === 'A' ? job.tokenASymbol : job.tokenBSymbol;
      
      console.log(`[PairTrade] Initial setup: ${solToSell / 1e9} SOL → ${targetSymbol}`);
      
      // 4. Execute SOL → preferred token swap
      const quote = await this.getJupiterQuote(
        'So11111111111111111111111111111111111111112', // SOL
        targetMint,
        solToSell,
        job.maxSlippage
      );
      
      const swapResult = await this.executeJupiterSwap(quote);
      
      if (swapResult.success) {
        // Update job state
        job.currentToken = triggerInfo.preferred_initial_token;
        job.lastSwapTimestamp = new Date().toISOString();
        
        // Calculate amounts for history
        const toAmount = parseFloat(quote.outAmount);
        const toDecimals = await this.getTokenDecimals(targetMint);
        const fromAmountUI = solToSell / 1e9;
        const toAmountUI = toAmount / Math.pow(10, toDecimals);
        
        // Add to swap history
        job.swapHistory.push({
          timestamp: new Date().toISOString(),
          fromToken: 'SOL' as any, // Initial setup from SOL
          toToken: triggerInfo.preferred_initial_token,
          fromAmount: fromAmountUI,
          toAmount: toAmountUI,
          price: fromAmountUI / toAmountUI,
          profit: 0 // Initial setup has no profit calculation
        });
        
        console.log(`[PairTrade] Initial position established: Now holding ${targetSymbol}`);
        console.log(`[PairTrade] Swapped ${fromAmountUI} SOL → ${toAmountUI} ${targetSymbol}`);
      } else {
        console.error('[PairTrade] Failed to execute initial swap:', swapResult.error);
        // Still set the preferred token even if swap failed
        job.currentToken = triggerInfo.preferred_initial_token;
      }
      
    } catch (error) {
      console.error('[PairTrade] Error in initial position setup:', error);
      // Fallback to token A if setup fails
      job.currentToken = 'A';
    }
  }

  /**
   * Get trigger information from database for this token pair
   */
  private async getTriggerInfo(tokenAMint: string, tokenBMint: string): Promise<TriggerInfo | null> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM pair_trade_triggers
        WHERE 
          (token_a_mint = $1 AND token_b_mint = $2) OR 
          (token_a_mint = $2 AND token_b_mint = $1)
        LIMIT 1
      `, [tokenAMint, tokenBMint]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        token_a_mint: row.token_a_mint,
        token_b_mint: row.token_b_mint,
        token_a_symbol: row.token_a_symbol,
        token_b_symbol: row.token_b_symbol,
        preferred_initial_token: row.preferred_initial_token,
        current_direction: row.current_direction,
        trigger_swap: row.trigger_swap,
        last_triggered_at: row.last_triggered_at,
        trigger_count: row.trigger_count
      };
    } catch (error) {
      console.error('[PairTrade] Error fetching trigger info:', error);
      return null;
    }
  }

  /**
   * Check if initial position has been setup
   */
  private hasInitialPositionSetup(): boolean {
    const job = this.job as PairTradeJob;
    // Consider setup complete if currentToken is set and we have some activity
    return job.currentToken !== null && 
           job.currentToken !== undefined && 
           (job.swapHistory.length > 0 || job.lastSwapTimestamp !== undefined);
  }

  /**
   * Get current trigger status for this pair
   */
  async getTriggerStatus(): Promise<TriggerInfo | null> {
    const job = this.job as PairTradeJob;
    return await this.getTriggerInfo(job.tokenAMint, job.tokenBMint);
  }
}