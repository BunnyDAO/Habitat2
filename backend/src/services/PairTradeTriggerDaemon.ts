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
  private intervalId: NodeJS.Timer | null = null;
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
          (current_direction === 'B_TO_A' && job.currentToken === 'B');\n\n        if (shouldSwap) {\n          console.log(`[Daemon] Triggering swap for strategy ${strategy.id} (${strategy.trading_wallet_public_key})`);\n          \n          const swapResult = await this.executeSwapForStrategy(strategy.id, job);\n          \n          triggerResults.push({\n            strategyId: strategy.id,\n            walletAddress: strategy.trading_wallet_public_key,\n            success: swapResult.success,\n            error: swapResult.error,\n            swapSignature: swapResult.signature\n          });\n        } else {\n          console.log(`[Daemon] Strategy ${strategy.id} already in correct position (${job.currentToken})`);\n        }\n      }\n\n      // 3. Log results\n      const successCount = triggerResults.filter(r => r.success).length;\n      const failureCount = triggerResults.filter(r => !r.success).length;\n      \n      console.log(`[Daemon] Trigger ${id} completed: ${successCount} success, ${failureCount} failures`);\n      \n      if (failureCount > 0) {\n        console.log('[Daemon] Failed swaps:', triggerResults.filter(r => !r.success));\n      }\n\n      // 4. Update trigger to false and record execution\n      await this.resetTrigger(id);\n\n    } catch (error) {\n      console.error(`[Daemon] Error processing trigger ${id} (${token_a_symbol}/${token_b_symbol}):`, error);\n      // Still reset the trigger even if there was an error\n      await this.resetTrigger(id);\n    }\n  }\n\n  /**\n   * Execute swap for a specific strategy\n   */\n  private async executeSwapForStrategy(strategyId: string, job: PairTradeJob): Promise<SwapResult> {\n    try {\n      if (!this.getWorkerFn) {\n        throw new Error('Worker getter function not configured');\n      }\n\n      // Get the worker instance\n      const worker = await this.getWorkerFn(strategyId);\n      \n      if (!worker) {\n        throw new Error(`Worker not found for strategy ${strategyId}`);\n      }\n\n      if (typeof worker.executeSwap !== 'function') {\n        throw new Error(`Worker for strategy ${strategyId} does not have executeSwap method`);\n      }\n\n      // Execute the swap with daemon trigger context\n      const result = await worker.executeSwap('daemon-trigger');\n      \n      return {\n        success: result.success,\n        signature: result.signature,\n        error: result.error\n      };\n\n    } catch (error) {\n      console.error(`[Daemon] Error executing swap for strategy ${strategyId}:`, error);\n      return {\n        success: false,\n        error: error instanceof Error ? error.message : 'Unknown error'\n      };\n    }\n  }\n\n  /**\n   * Reset a trigger back to false and update tracking info\n   */\n  private async resetTrigger(triggerId: number): Promise<void> {\n    try {\n      await this.pool.query(`\n        UPDATE pair_trade_triggers \n        SET \n          trigger_swap = false,\n          last_triggered_at = NOW(),\n          trigger_count = trigger_count + 1,\n          updated_at = NOW()\n        WHERE id = $1\n      `, [triggerId]);\n      \n      console.log(`[Daemon] Reset trigger ${triggerId}`);\n    } catch (error) {\n      console.error(`[Daemon] Error resetting trigger ${triggerId}:`, error);\n    }\n  }\n\n  /**\n   * Get daemon status\n   */\n  getStatus(): { isRunning: boolean; checkInterval: number } {\n    return {\n      isRunning: this.isRunning,\n      checkInterval: this.checkInterval\n    };\n  }\n\n  /**\n   * Update check interval\n   */\n  setCheckInterval(intervalMs: number): void {\n    if (intervalMs < 1000) {\n      throw new Error('Check interval must be at least 1000ms');\n    }\n\n    this.checkInterval = intervalMs;\n    \n    // Restart with new interval if currently running\n    if (this.isRunning && this.intervalId) {\n      clearInterval(this.intervalId);\n      this.intervalId = setInterval(async () => {\n        try {\n          await this.checkAndExecuteTriggers();\n        } catch (error) {\n          console.error('[Daemon] Error in periodic check:', error);\n        }\n      }, this.checkInterval);\n      \n      console.log(`[Daemon] Check interval updated to ${intervalMs}ms`);\n    }\n  }\n\n  /**\n   * Manual trigger check (useful for testing)\n   */\n  async checkNow(): Promise<void> {\n    console.log('[Daemon] Manual trigger check requested');\n    await this.checkAndExecuteTriggers();\n  }\n\n  /**\n   * Get all active triggers\n   */\n  async getActiveTriggers(): Promise<TriggerInfo[]> {\n    try {\n      const result = await this.pool.query(`\n        SELECT * FROM pair_trade_triggers \n        WHERE trigger_swap = true\n        ORDER BY updated_at DESC\n      `);\n      \n      return result.rows.map(row => ({\n        id: row.id,\n        token_a_mint: row.token_a_mint,\n        token_b_mint: row.token_b_mint,\n        token_a_symbol: row.token_a_symbol,\n        token_b_symbol: row.token_b_symbol,\n        preferred_initial_token: row.preferred_initial_token,\n        current_direction: row.current_direction,\n        trigger_swap: row.trigger_swap,\n        last_triggered_at: row.last_triggered_at,\n        trigger_count: row.trigger_count\n      }));\n    } catch (error) {\n      console.error('[Daemon] Error getting active triggers:', error);\n      return [];\n    }\n  }\n}