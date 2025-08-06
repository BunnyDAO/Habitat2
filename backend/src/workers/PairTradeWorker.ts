import { BaseWorker } from './BaseWorker';
import { PairTradeJob } from '../types/jobs';
import { TokenService } from '../services/TokenService';
import { createRateLimitedConnection } from '../utils/connection';
import { Pool } from 'pg';
import { SwapService } from '../services/swap.service';
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
import { tradeEventsService } from '../services/trade-events.service';

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
  private pool: Pool;
  private tokenService: TokenService;
  private swapService: SwapService;
  private isProcessingSwap: boolean = false;
  private lastTriggerCheck: number = 0;
  private readonly TRIGGER_CHECK_INTERVAL = 30000; // 30 seconds

  constructor(job: PairTradeJob, endpoint: string, pool: Pool, swapService: SwapService) {
    super(job, endpoint);
    this.tradingWalletKeypair = Keypair.fromSecretKey(job.tradingWalletSecretKey);
    this.pool = pool;
    this.tokenService = new TokenService(pool);
    this.swapService = swapService;
    
    console.log(`[PairTrade] Worker initialized for wallet ${this.tradingWalletKeypair.publicKey.toString()}`);
    console.log(`[PairTrade] Token pair: ${job.tokenASymbol}/${job.tokenBSymbol}`);
    console.log(`[PairTrade] Current token: ${job.currentToken}`);
  }

  /**
   * Check if strategy is currently active in the database
   * This ensures we always have the most up-to-date status
   */
  private async isStrategyActive(): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'SELECT is_active FROM strategies WHERE id = $1',
        [this.job.id]
      );

      if (result.rows.length === 0) {
        console.error(`[PairTrade] Strategy ${this.job.id} not found in database`);
        return false;
      }

      return result.rows[0].is_active === true;
    } catch (error) {
      console.error(`[PairTrade] Error checking strategy ${this.job.id} active status:`, error);
      // If we can't check the database, be conservative and return false
      return false;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      this.isRunning = true;
      await this.monitorTriggers();
    } catch (error) {
      console.error('[PairTrade] Error starting pair trade monitor:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log(`[PairTrade] PairTradeWorker stopped for strategy ${this.job.id}`);
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
      
      // Execute swap using SwapService
      const swapResult = await this.swapService.executeSwap({
        inputMint: fromMint,
        outputMint: toMint,
        amount: amountToSwap,
        slippageBps: Math.floor(job.maxSlippage * 100), // Convert percentage to basis points
        walletKeypair: {
          publicKey: this.tradingWalletKeypair.publicKey.toString(),
          secretKey: Array.from(this.tradingWalletKeypair.secretKey)
        },
        feeWalletPubkey: '5PkZKoYHDoNwThvqdM5U35ACcYdYrT4ZSQdU2bY3iqKV' // Jupiter fee account
      });
      
      // Update job state
      job.currentToken = toToken;
      job.lastSwapTimestamp = new Date().toISOString();
      
      // Calculate swap details from swap result
      const fromAmountUI = parseFloat(swapResult.inputAmount);
      const toAmountUI = parseFloat(swapResult.outputAmount);
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
      
      // Emit trade success event for vault strategies to monitor
      tradeEventsService.emitTradeSuccess({
        strategyId: job.id,
        tradingWalletAddress: this.tradingWalletKeypair.publicKey.toString(),
        strategyType: 'pair-trade',
        signature: swapResult.signature,
        timestamp: new Date().toISOString(),
        amount: fromAmountUI
      });
      
      return {
        success: true,
        signature: swapResult.signature,
        swapDetails
      };
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
    
    return {
      currentToken: job.currentToken,
      currentTokenSymbol: currentSymbol,
      currentBalance: balance,
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

  private async getTokenBalance(mintAddress: string): Promise<number> {
    try {
      const walletAddress = this.tradingWalletKeypair.publicKey;
      
      // Handle SOL (WSOL) specially
      if (mintAddress === 'So11111111111111111111111111111111111111112') {
        const balance = await this.connection.getBalance(walletAddress);
        return balance; // Return in lamports
      }
      
      // For SPL tokens, get token account balance
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(walletAddress, {
        mint: new PublicKey(mintAddress)
      });

      if (tokenAccounts.value.length === 0) {
        return 0;
      }

      const tokenAccount = tokenAccounts.value[0];
      const amount = tokenAccount.account.data.parsed.info.tokenAmount.amount;
      return parseInt(amount);
    } catch (error) {
      console.error(`[PairTrade] Error getting token balance for ${mintAddress}:`, error);
      return 0;
    }
  }

  private async getTokenDecimals(mintAddress: string): Promise<number> {
    try {
      if (mintAddress === 'So11111111111111111111111111111111111111112') {
        return 9; // SOL has 9 decimals
      }

      const mintInfo = await this.connection.getParsedAccountInfo(new PublicKey(mintAddress));
      if (mintInfo.value?.data && 'parsed' in mintInfo.value.data) {
        return mintInfo.value.data.parsed.info.decimals;
      }
      
      return 6; // Default to 6 decimals for unknown tokens
    } catch (error) {
      console.error(`[PairTrade] Error getting decimals for ${mintAddress}:`, error);
      return 6;
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
      const swapResult = await this.swapService.executeSwap({
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: targetMint,
        amount: solToSell,
        slippageBps: Math.floor(job.maxSlippage * 100), // Convert percentage to basis points
        walletKeypair: {
          publicKey: this.tradingWalletKeypair.publicKey.toString(),
          secretKey: Array.from(this.tradingWalletKeypair.secretKey)
        },
        feeWalletPubkey: '5PkZKoYHDoNwThvqdM5U35ACcYdYrT4ZSQdU2bY3iqKV' // Jupiter fee account
      });
      
      // Update job state
      job.currentToken = triggerInfo.preferred_initial_token;
      job.lastSwapTimestamp = new Date().toISOString();
      
      // Calculate amounts for history
      const fromAmountUI = parseFloat(swapResult.inputAmount);
      const toAmountUI = parseFloat(swapResult.outputAmount);
      
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

  private async monitorTriggers(): Promise<void> {
    while (this.isRunning) {
      try {
        const now = Date.now();
        if (now - this.lastTriggerCheck >= this.TRIGGER_CHECK_INTERVAL) {
          await this.checkTriggers();
          this.lastTriggerCheck = now;
        }

        // Wait 10 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 10000));
      } catch (error) {
        console.error('[PairTrade] Error in trigger monitoring loop:', error);
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds on error
      }
    }
  }

  private async checkTriggers(): Promise<void> {
    try {
      const job = this.job as PairTradeJob;
      const client = await this.pool.connect();
      
      try {
        // Get trigger info for this token pair
        const result = await client.query(`
          SELECT * FROM pair_trade_triggers 
          WHERE token_a_mint = $1 AND token_b_mint = $2 
          AND trigger_swap = true
        `, [job.tokenAMint, job.tokenBMint]);

        if (result.rows.length > 0) {
          console.log(`[PairTrade] Found ${result.rows.length} active triggers for ${job.tokenASymbol}/${job.tokenBSymbol}`);
          
          for (const trigger of result.rows) {
            await this.processTrigger(trigger);
          }
        }
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[PairTrade] Error checking triggers:', error);
      throw error;
    }
  }

  private async processTrigger(trigger: TriggerInfo): Promise<void> {
    const job = this.job as PairTradeJob;
    
    // Check if strategy is active before processing any triggers
    // Query the database to get the current status (not the stale in-memory value)
    const isActive = await this.isStrategyActive();
    if (!isActive) {
      console.log(`[PairTrade] Trigger found but strategy is not active (database is_active=false). Skipping trade.`);
      return;
    }
    
    // Check if swap is needed based on current position and desired direction
    const shouldSwap = 
      (trigger.current_direction === 'A_TO_B' && job.currentToken === 'A') ||
      (trigger.current_direction === 'B_TO_A' && job.currentToken === 'B');

    if (shouldSwap) {
      console.log(`[PairTrade] Trigger indicates swap needed: ${trigger.current_direction}`);
      await this.executeSwap('trigger');
    } else {
      console.log(`[PairTrade] Already in correct position for trigger direction: ${trigger.current_direction}`);
    }
  }
}