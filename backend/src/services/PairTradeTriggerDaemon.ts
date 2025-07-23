import { Pool } from 'pg';
import { PairTradeJob, JobType } from '../types/jobs';

// Trigger info interface (matches the database schema)
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

interface SwapResult {
  success: boolean;
  signature?: string;
  error?: string;
}

interface TriggerResult {
  strategyId: string;
  walletAddress: string;
  success: boolean;
  error?: string;
  swapSignature?: string;
}

export class PairTradeTriggerDaemon {
  private pool: Pool;
  private checkInterval: number = 5000; // Check every 5 seconds
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  // Function to get worker instance - will be injected
  private getWorkerFn: ((strategyId: string) => Promise<any>) | null = null;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Inject the function to get worker instances
   * This allows the daemon to trigger swaps on workers
   */
  setWorkerGetter(getWorkerFn: (strategyId: string) => Promise<any>): void {
    this.getWorkerFn = getWorkerFn;
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[Daemon] PairTrade trigger daemon already running');
      return;
    }

    console.log('[Daemon] Starting PairTrade trigger daemon...');
    this.isRunning = true;
    
    // Initial check
    await this.checkAndExecuteTriggers();
    
    // Set up periodic checks
    this.intervalId = setInterval(async () => {
      try {
        await this.checkAndExecuteTriggers();
      } catch (error) {
        console.error('[Daemon] Error in periodic check:', error);
      }
    }, this.checkInterval);

    console.log(`[Daemon] PairTrade daemon started with ${this.checkInterval}ms interval`);
  }

  /**
   * Stop the daemon
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[Daemon] Stopping PairTrade trigger daemon...');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    console.log('[Daemon] PairTrade trigger daemon stopped');
  }

  /**
   * Check for active triggers and execute swaps
   */
  private async checkAndExecuteTriggers(): Promise<void> {
    try {
      // 1. Get all triggers that are set to true
      const triggersResult = await this.pool.query(`
        SELECT * FROM pair_trade_triggers 
        WHERE trigger_swap = true 
        AND current_direction != 'HOLD'
        ORDER BY updated_at ASC
      `);

      if (triggersResult.rows.length === 0) {
        return; // Nothing to do
      }

      console.log(`[Daemon] Found ${triggersResult.rows.length} active triggers`);

      for (const trigger of triggersResult.rows) {
        await this.processTrigger(trigger);
      }

    } catch (error) {
      console.error('[Daemon] Error checking triggers:', error);
    }
  }

  /**
   * Process a single trigger
   */
  private async processTrigger(trigger: any): Promise<void> {
    const { 
      id,
      token_a_mint, 
      token_b_mint, 
      token_a_symbol,
      token_b_symbol,
      current_direction 
    } = trigger;

    console.log(`[Daemon] Processing trigger ${id}: ${token_a_symbol}/${token_b_symbol} - ${current_direction}`);

    try {
      // 1. Find all active strategies with this pair
      const strategiesResult = await this.pool.query(`
        SELECT id, data, trading_wallet_public_key
        FROM jobs 
        WHERE 
          type = $1
          AND is_active = true
          AND (
            (data->>'tokenAMint' = $2 AND data->>'tokenBMint' = $3) OR
            (data->>'tokenAMint' = $3 AND data->>'tokenBMint' = $2)
          )
      `, [JobType.PAIR_TRADE, token_a_mint, token_b_mint]);

      if (strategiesResult.rows.length === 0) {
        console.log(`[Daemon] No active strategies found for ${token_a_symbol}/${token_b_symbol}`);
        await this.resetTrigger(id);
        return;
      }

      console.log(`[Daemon] Found ${strategiesResult.rows.length} strategies to process`);

      const triggerResults: TriggerResult[] = [];

      // 2. Execute swaps for each strategy that needs it
      for (const strategy of strategiesResult.rows) {
        const job = strategy.data as PairTradeJob;
        
        // Check if swap is needed based on current position and desired direction
        const shouldSwap = 
          (current_direction === 'A_TO_B' && job.currentToken === 'A') ||
          (current_direction === 'B_TO_A' && job.currentToken === 'B');

        if (shouldSwap) {
          console.log(`[Daemon] Triggering swap for strategy ${strategy.id} (${strategy.trading_wallet_public_key})`);
          
          const swapResult = await this.executeSwapForStrategy(strategy.id, job);
          
          triggerResults.push({
            strategyId: strategy.id,
            walletAddress: strategy.trading_wallet_public_key,
            success: swapResult.success,
            error: swapResult.error,
            swapSignature: swapResult.signature
          });
        } else {
          console.log(`[Daemon] Strategy ${strategy.id} already in correct position (${job.currentToken})`);
        }
      }

      // 3. Log results
      const successCount = triggerResults.filter(r => r.success).length;
      const failureCount = triggerResults.filter(r => !r.success).length;
      
      console.log(`[Daemon] Trigger ${id} completed: ${successCount} success, ${failureCount} failures`);
      
      if (failureCount > 0) {
        console.log('[Daemon] Failed swaps:', triggerResults.filter(r => !r.success));
      }

      // 4. Update trigger to false and record execution
      await this.resetTrigger(id);

    } catch (error) {
      console.error(`[Daemon] Error processing trigger ${id} (${token_a_symbol}/${token_b_symbol}):`, error);
      // Still reset the trigger even if there was an error
      await this.resetTrigger(id);
    }
  }

  /**
   * Execute swap for a specific strategy
   */
  private async executeSwapForStrategy(strategyId: string, job: PairTradeJob): Promise<SwapResult> {
    try {
      if (!this.getWorkerFn) {
        throw new Error('Worker getter function not configured');
      }

      // Get the worker instance
      const worker = await this.getWorkerFn(strategyId);
      
      if (!worker) {
        throw new Error(`Worker not found for strategy ${strategyId}`);
      }

      if (typeof worker.executeSwap !== 'function') {
        throw new Error(`Worker for strategy ${strategyId} does not have executeSwap method`);
      }

      // Execute the swap with daemon trigger context
      const result = await worker.executeSwap('daemon-trigger');
      
      return {
        success: result.success,
        signature: result.signature,
        error: result.error
      };

    } catch (error) {
      console.error(`[Daemon] Error executing swap for strategy ${strategyId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Reset a trigger back to false and update tracking info
   */
  private async resetTrigger(triggerId: number): Promise<void> {
    try {
      await this.pool.query(`
        UPDATE pair_trade_triggers 
        SET 
          trigger_swap = false,
          last_triggered_at = NOW(),
          trigger_count = trigger_count + 1,
          updated_at = NOW()
        WHERE id = $1
      `, [triggerId]);
      
      console.log(`[Daemon] Reset trigger ${triggerId}`);
    } catch (error) {
      console.error(`[Daemon] Error resetting trigger ${triggerId}:`, error);
    }
  }

  /**
   * Get daemon status
   */
  getStatus(): { isRunning: boolean; checkInterval: number } {
    return {
      isRunning: this.isRunning,
      checkInterval: this.checkInterval
    };
  }

  /**
   * Update check interval
   */
  setCheckInterval(intervalMs: number): void {
    if (intervalMs < 1000) {
      throw new Error('Check interval must be at least 1000ms');
    }

    this.checkInterval = intervalMs;
    
    // Restart with new interval if currently running
    if (this.isRunning && this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(async () => {
        try {
          await this.checkAndExecuteTriggers();
        } catch (error) {
          console.error('[Daemon] Error in periodic check:', error);
        }
      }, this.checkInterval);
      
      console.log(`[Daemon] Check interval updated to ${intervalMs}ms`);
    }
  }

  /**
   * Manual trigger check (useful for testing)
   */
  async checkNow(): Promise<void> {
    console.log('[Daemon] Manual trigger check requested');
    await this.checkAndExecuteTriggers();
  }

  /**
   * Get all active triggers
   */
  async getActiveTriggers(): Promise<TriggerInfo[]> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM pair_trade_triggers 
        WHERE trigger_swap = true
        ORDER BY updated_at DESC
      `);
      
      return result.rows.map(row => ({
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
      }));
    } catch (error) {
      console.error('[Daemon] Error getting active triggers:', error);
      return [];
    }
  }
}