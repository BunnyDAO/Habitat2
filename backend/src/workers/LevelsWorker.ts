import { BaseWorker } from './BaseWorker';
import { LevelsStrategy, Level, LevelExecution, TradeEntry, ProfitEntry } from '../types/jobs';
import { PublicKey, Keypair } from '@solana/web3.js';
import { SwapService, SwapResponse } from '../services/swap.service';
import { tradeEventsService } from '../services/trade-events.service';
import { PriceFeedService } from '../api/v1/services/price-feed.service';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const MIN_TRADE_AMOUNT = 0.01; // Minimum 0.01 SOL for trades
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUPITER_FEE_ACCOUNT = '5PkZKoYHDoNwThvqdM5U35ACcYdYrT4ZSQdU2bY3iqKV';

// Initialize Supabase client for database queries
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export class LevelsWorker extends BaseWorker {
  private strategy: LevelsStrategy;
  private tradingWalletKeypair: Keypair;
  private lastCheck: number = 0;
  private checkInterval: number = 60000; // 1 minute
  private swapService: SwapService;
  private priceFeedService: PriceFeedService;
  private lastPrice: number = 0; // Track last price to detect crossings

  constructor(job: LevelsStrategy, endpoint: string, swapService: SwapService, priceFeedService: PriceFeedService) {
    super(job, endpoint);
    this.strategy = job;
    this.tradingWalletKeypair = Keypair.fromSecretKey(job.tradingWalletSecretKey);
    this.swapService = swapService;
    this.priceFeedService = priceFeedService;
    
    console.log(`[Levels] Worker initialized in ${job.mode.toUpperCase()} mode with ${job.levels.length} levels for wallet ${job.tradingWalletPublicKey}`);
    this.logStrategyLevels();
  }

  private logStrategyLevels(): void {
    this.strategy.levels.forEach(level => {
      const details = level.type === 'limit_buy' 
        ? `Buy $${level.usdcAmount} USDC worth of SOL`
        : `Sell ${level.solPercentage}% of SOL`;
      console.log(`[Levels] Level ${level.id}: ${level.type} at $${level.price} - ${details}`);
    });
  }

  /**
   * Check if strategy is currently active in the database
   */
  private async isStrategyActive(): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('strategies')
        .select('is_active')
        .eq('id', this.job.id)
        .single();

      if (error) {
        console.error(`[Levels] Error checking strategy ${this.job.id} active status:`, error);
        return false;
      }

      return data?.is_active === true;
    } catch (error) {
      console.error(`[Levels] Exception checking strategy ${this.job.id} active status:`, error);
      return false;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      this.isRunning = true;
      console.log(`[Levels] Starting ${this.strategy.mode} mode monitoring for wallet ${this.strategy.tradingWalletPublicKey}`);
      this.monitorLevels();
    } catch (error) {
      console.error('[Levels] Error starting levels monitor:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log(`[Levels] Stopped levels monitoring for wallet ${this.strategy.tradingWalletPublicKey}`);
  }

  private async monitorLevels(): Promise<void> {
    while (this.isRunning) {
      try {
        const now = Date.now();
        if (now - this.lastCheck >= this.checkInterval) {
          await this.checkLevels();
          this.lastCheck = now;
        }

        // Wait 30 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 30000));
      } catch (error) {
        console.error('[Levels] Error monitoring levels:', error);
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute on error
      }
    }
  }

  private async checkLevels(): Promise<void> {
    try {
      // Get current SOL price
      const currentPrice = await this.priceFeedService.getPrice('SOL');
      
      if (!currentPrice || currentPrice <= 0) {
        throw new Error(`Invalid SOL price received: ${currentPrice}`);
      }

      console.log(`[Levels] Current SOL price: $${currentPrice} (Previous: $${this.lastPrice})`);

      // Find eligible levels that should trigger
      const eligibleLevels = this.findEligibleLevels(currentPrice);

      if (eligibleLevels.length > 0) {
        // Check if strategy is active before executing any trades
        const isActive = await this.isStrategyActive();
        if (!isActive) {
          console.log(`[Levels] Found ${eligibleLevels.length} eligible levels but strategy is not active. Skipping trades.`);
          return;
        }

        console.log(`[Levels] 🎯 Found ${eligibleLevels.length} eligible levels at price $${currentPrice}`);
        
        for (const level of eligibleLevels) {
          await this.executeLevel(level, currentPrice);
        }

        // Check if strategy should be paused after executions
        await this.checkStrategyCompletion();
      }

      // Update last price for next comparison
      this.lastPrice = currentPrice;

    } catch (error) {
      console.error('[Levels] Error checking levels:', error);
      throw error;
    }
  }

  private findEligibleLevels(currentPrice: number): Level[] {
    return this.strategy.levels.filter(level => {
      // Skip executed levels still in cooldown
      if (level.executed && !this.isCooldownExpired(level)) {
        return false;
      }
      
      // Skip permanently disabled levels
      if (level.permanentlyDisabled) {
        return false;
      }
      
      // Check trigger conditions based on order type
      return this.shouldTriggerLevel(level, currentPrice);
    });
  }

  private shouldTriggerLevel(level: Level, currentPrice: number): boolean {
    switch (level.type) {
      case 'limit_buy':
      case 'stop_loss':
        // Trigger when price crosses DOWN to/below level
        return this.hasCrossedDown(level.price, currentPrice);
        
      case 'take_profit':
        // Trigger when price crosses UP to/above level
        return this.hasCrossedUp(level.price, currentPrice);
        
      default:
        return false;
    }
  }

  private hasCrossedDown(levelPrice: number, currentPrice: number): boolean {
    // Price crossed down through level OR first check and already below
    return (this.lastPrice > levelPrice && currentPrice <= levelPrice) ||
           (currentPrice <= levelPrice && this.lastPrice === 0);
  }

  private hasCrossedUp(levelPrice: number, currentPrice: number): boolean {
    // Price crossed up through level OR first check and already above  
    return (this.lastPrice < levelPrice && currentPrice >= levelPrice) ||
           (currentPrice >= levelPrice && this.lastPrice === 0);
  }

  private isCooldownExpired(level: Level): boolean {
    if (!level.cooldownUntil) return true;
    return new Date() > new Date(level.cooldownUntil);
  }

  private async executeLevel(level: Level, currentPrice: number): Promise<void> {
    try {
      let swapResult: SwapResponse;
      
      if (level.type === 'limit_buy') {
        // BUY: USDC → SOL
        swapResult = await this.executeBuyOrder(level, currentPrice);
      } else {
        // SELL: SOL → USDC (stop_loss or take_profit)
        swapResult = await this.executeSellOrder(level, currentPrice);
      }
      
      // Record successful execution
      await this.recordLevelExecution(level, swapResult, currentPrice, true);
      
      // Update level state
      level.executed = true;
      level.executedCount++;
      level.executedAt = new Date().toISOString();
      level.cooldownUntil = this.calculateCooldownEnd();
      
      // Check if level should be permanently disabled
      if (level.executedCount >= this.strategy.maxRetriggers) {
        level.permanentlyDisabled = true;
        console.log(`[Levels] Level ${level.id} permanently disabled after ${level.executedCount} executions`);
      }
      
      // Update strategy in database
      await this.updateStrategyInDatabase();
      
    } catch (error) {
      console.error(`[Levels] Failed to execute level ${level.id}:`, error);
      await this.recordLevelExecution(level, null, currentPrice, false, (error as Error).message);
    }
  }

  private async executeBuyOrder(level: Level, currentPrice: number): Promise<SwapResponse> {
    if (!level.usdcAmount) {
      throw new Error('BUY order missing USDC amount');
    }

    // Validate USDC balance
    const usdcBalance = await this.getUsdcBalance();
    if (usdcBalance < level.usdcAmount) {
      throw new Error(`Insufficient USDC: need $${level.usdcAmount}, have $${usdcBalance}`);
    }
    
    console.log(`[Levels] 🛒 Executing BUY: $${level.usdcAmount} USDC → SOL at $${currentPrice}`);
    
    return await this.swapService.executeSwap({
      inputMint: USDC_MINT,
      outputMint: SOL_MINT,
      amount: level.usdcAmount,
      slippageBps: 100,
      walletKeypair: {
        publicKey: this.tradingWalletKeypair.publicKey.toString(),
        secretKey: Array.from(this.tradingWalletKeypair.secretKey)
      },
      feeWalletPubkey: JUPITER_FEE_ACCOUNT
    });
  }

  private async executeSellOrder(level: Level, currentPrice: number): Promise<SwapResponse> {
    if (!level.solPercentage) {
      throw new Error('SELL order missing SOL percentage');
    }
    
    // Get current SOL balance
    const solBalance = await this.getSolBalance();
    const amountToSell = (solBalance * level.solPercentage) / 100;
    
    if (amountToSell < MIN_TRADE_AMOUNT) {
      throw new Error(`Amount ${amountToSell} SOL below minimum threshold ${MIN_TRADE_AMOUNT} SOL`);
    }

    // Ensure we leave enough SOL for transaction fees
    const maxSellAmount = Math.max(0, solBalance - 0.01);
    const finalAmount = Math.min(amountToSell, maxSellAmount);
    
    if (finalAmount <= 0) {
      throw new Error('Insufficient SOL balance for trade after fee buffer');
    }
    
    console.log(`[Levels] 💰 Executing SELL: ${finalAmount} SOL (${level.solPercentage}%) → USDC at $${currentPrice}`);
    
    return await this.swapService.executeSwap({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: finalAmount,
      slippageBps: 100,
      walletKeypair: {
        publicKey: this.tradingWalletKeypair.publicKey.toString(),
        secretKey: Array.from(this.tradingWalletKeypair.secretKey)
      },
      feeWalletPubkey: JUPITER_FEE_ACCOUNT
    });
  }

  private async recordLevelExecution(
    level: Level, 
    swapResult: SwapResponse | null, 
    triggerPrice: number, 
    success: boolean, 
    errorMessage?: string
  ): Promise<void> {
    const execution: LevelExecution = {
      timestamp: new Date().toISOString(),
      triggerPrice,
      amountTraded: swapResult ? (level.type === 'limit_buy' ? swapResult.outputAmount : -swapResult.inputAmount) : 0,
      usdcValue: swapResult ? (level.type === 'limit_buy' ? swapResult.inputAmount : swapResult.outputAmount) : 0,
      signature: swapResult?.signature || '',
      success,
      errorMessage
    };

    level.executionHistory.push(execution);

    if (success && swapResult) {
      // Update profit tracking
      const tradeEntry: TradeEntry = {
        timestamp: new Date().toISOString(),
        type: level.type === 'limit_buy' ? 'buy' : 'sell',
        amount: Math.abs(execution.amountTraded),
        price: triggerPrice,
        usdcValue: execution.usdcValue,
        levelId: level.id,
        profit: 0 // Will be calculated based on historical data
      };

      this.strategy.profitTracking.trades.push(tradeEntry);

      // Update strategy activity
      this.strategy.lastActivity = new Date().toISOString();
      this.strategy.lastExecutionTime = new Date().toISOString();

      // Emit trade success event for vault strategies to monitor
      tradeEventsService.emitTradeSuccess({
        strategyId: this.job.id,
        tradingWalletAddress: this.tradingWalletKeypair.publicKey.toString(),
        strategyType: 'levels',
        signature: swapResult.signature,
        timestamp: new Date().toISOString(),
        amount: Math.abs(execution.amountTraded)
      });

      console.log(`[Levels] ✅ Level ${level.id} executed successfully: ${swapResult.signature}`);
    }
  }

  private calculateCooldownEnd(): string {
    const cooldownMs = this.strategy.cooldownHours * 60 * 60 * 1000;
    return new Date(Date.now() + cooldownMs).toISOString();
  }

  private async checkStrategyCompletion(): Promise<void> {
    const activeLevels = this.strategy.levels.filter(level => 
      !level.permanentlyDisabled && 
      (!level.executed || this.isCooldownExpired(level))
    );
    
    if (activeLevels.length === 0) {
      console.log(`[Levels] 🏁 All levels completed or disabled. Checking auto-restart setting.`);
      
      if (this.strategy.autoRestartAfterComplete) {
        // Reset all levels for next cycle
        await this.resetAllLevels();
        console.log(`[Levels] 🔄 Auto-restart enabled. Strategy reset for next cycle.`);
      } else {
        // Pause the strategy
        await this.pauseStrategy();
      }
    }
  }

  private async resetAllLevels(): Promise<void> {
    this.strategy.levels.forEach(level => {
      level.executed = false;
      level.cooldownUntil = undefined;
      level.executedAt = undefined;
      // Keep execution history for performance tracking
    });
    
    // Update database
    await this.updateStrategyInDatabase();
  }

  private async pauseStrategy(): Promise<void> {
    // Update strategy to inactive in database
    const { error } = await supabase
      .from('strategies')
      .update({ is_active: false })
      .eq('id', this.job.id);
      
    if (error) {
      console.error(`[Levels] Failed to pause strategy ${this.job.id}:`, error);
    } else {
      console.log(`[Levels] ✅ Strategy ${this.job.id} paused successfully`);
    }
    
    // Stop the worker
    await this.stop();
  }

  private async updateStrategyInDatabase(): Promise<void> {
    try {
      const { error } = await supabase
        .from('strategies')
        .update({ 
          config: this.strategy,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.job.id);

      if (error) {
        console.error(`[Levels] Failed to update strategy ${this.job.id} in database:`, error);
      }
    } catch (error) {
      console.error(`[Levels] Exception updating strategy ${this.job.id} in database:`, error);
    }
  }

  private async getUsdcBalance(): Promise<number> {
    try {
      // Get USDC token account for the wallet
      const response = await this.connection.getParsedTokenAccountsByOwner(
        this.tradingWalletKeypair.publicKey,
        { mint: new PublicKey(USDC_MINT) }
      );

      if (response.value.length === 0) {
        return 0;
      }

      const usdcAccount = response.value[0];
      const balance = usdcAccount.account.data.parsed.info.tokenAmount.uiAmount;
      return balance || 0;
    } catch (error) {
      console.error('[Levels] Error getting USDC balance:', error);
      return 0;
    }
  }

  private async getSolBalance(): Promise<number> {
    try {
      const balance = await this.connection.getBalance(this.tradingWalletKeypair.publicKey);
      return balance / 1e9; // Convert lamports to SOL
    } catch (error) {
      console.error('[Levels] Error getting SOL balance:', error);
      return 0;
    }
  }
}