/**
 * Example integration file showing how to wire together:
 * - PairTradeWorker with database integration
 * - PairTradeTriggerDaemon
 * - API routes
 * - WorkerManager
 * 
 * Add this code to your main Express app setup
 */

import express from 'express';
import { Pool } from 'pg';
import { TokenService } from './services/TokenService';
import { PairTradeTriggerDaemon } from './services/PairTradeTriggerDaemon';
import { WorkerManager } from './services/WorkerManager';
import { createPairTradeRoutes } from './routes/pairTradeRoutes';

// Example app setup
export async function setupPairTradeSystem(
  app: express.Application,
  pool: Pool,
  redisClient?: any
): Promise<PairTradeTriggerDaemon> {
  
  console.log('[App] Setting up PairTrade system...');
  
  // 1. Initialize TokenService
  const tokenService = new TokenService(pool, redisClient);
  
  // 2. Initialize WorkerManager
  WorkerManager.initialize(pool, tokenService);
  
  // 3. Create and configure daemon
  const daemon = new PairTradeTriggerDaemon(pool);
  
  // 4. Configure daemon to use WorkerManager
  daemon.setWorkerGetter(async (strategyId: string) => {
    return await WorkerManager.getWorker(strategyId);
  });
  
  // 5. Add API routes
  const pairTradeRoutes = createPairTradeRoutes(pool, daemon);
  app.use('/api/pair-trades', pairTradeRoutes);
  
  // 6. Start daemon
  await daemon.start();
  
  console.log('[App] PairTrade system setup complete');
  
  // 7. Return daemon for external control
  return daemon;
}

// Example usage in your main app.ts:
/*

import { setupPairTradeSystem } from './app-integration-example';

async function startApp() {
  const app = express();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  // Setup pair trade system
  const daemon = await setupPairTradeSystem(app, pool);
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    await daemon.stop();
    await WorkerManager.stopAll();
    process.exit(0);
  });
  
  app.listen(3000, () => {
    console.log('Server running on port 3000');
  });
}

startApp().catch(console.error);

*/

// Example manual trigger usage:
/*

// Set SOL/USDC to swap from SOL to USDC
curl -X POST http://localhost:3000/api/pair-trades/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "tokenA": "So11111111111111111111111111111111111111112",
    "tokenB": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "direction": "A_TO_B"
  }'

// Check trigger status
curl http://localhost:3000/api/pair-trades/triggers

// Check daemon status
curl http://localhost:3000/api/pair-trades/daemon/status

// View all strategies
curl http://localhost:3000/api/pair-trades/strategies

// Manual daemon check (for testing)
curl -X POST http://localhost:3000/api/pair-trades/trigger/manual-check

*/

// Example SQL commands for manual control:
/*

-- Set trigger to swap SOL -> USDC
UPDATE pair_trade_triggers 
SET 
  current_direction = 'A_TO_B',
  trigger_swap = true
WHERE token_a_symbol = 'SOL' AND token_b_symbol = 'USDC';

-- Set trigger to swap USDC -> SOL
UPDATE pair_trade_triggers 
SET 
  current_direction = 'B_TO_A',
  trigger_swap = true
WHERE token_a_symbol = 'SOL' AND token_b_symbol = 'USDC';

-- Set to HOLD (no swaps)
UPDATE pair_trade_triggers 
SET 
  current_direction = 'HOLD',
  trigger_swap = false
WHERE token_a_symbol = 'SOL' AND token_b_symbol = 'USDC';

-- Check trigger status
SELECT 
  token_a_symbol || '/' || token_b_symbol as pair,
  current_direction,
  trigger_swap,
  last_triggered_at,
  trigger_count
FROM pair_trade_triggers
ORDER BY updated_at DESC;

*/

// Example workflow:
/*

1. **Setup**: Run migration to create pair_trade_triggers table
2. **Configure**: Add token pairs via API or SQL
3. **Start**: Initialize app with daemon running
4. **Trade**: Set triggers via API or direct SQL updates
5. **Monitor**: Daemon automatically executes swaps every 5 seconds
6. **Track**: View results via API endpoints

Daily workflow:
- Morning: Check market conditions
- Update triggers: "All SOL/USDC pairs should swap to USDC"
- SQL: UPDATE pair_trade_triggers SET current_direction = 'A_TO_B', trigger_swap = true WHERE ...
- Daemon executes swaps across all strategies
- Evening: Check results and set new triggers

*/ 