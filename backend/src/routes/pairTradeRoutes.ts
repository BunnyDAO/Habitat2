import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { PairTradeTriggerDaemon } from '../services/PairTradeTriggerDaemon';

export function createPairTradeRoutes(pool: Pool, daemon?: PairTradeTriggerDaemon): Router {
  const router = Router();

  /**
   * GET /api/pair-trades/triggers
   * Get all pair trade triggers and their status
   */
  router.get('/triggers', async (req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT 
          id,
          token_a_mint,
          token_b_mint,
          token_a_symbol,
          token_b_symbol,
          preferred_initial_token,
          current_direction,
          trigger_swap,
          last_triggered_at,
          trigger_count,
          created_at,
          updated_at
        FROM pair_trade_triggers 
        ORDER BY updated_at DESC
      `);
      
      res.json({
        success: true,
        triggers: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching triggers:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch triggers'
      });
    }
  });

  /**
   * GET /api/pair-trades/triggers/active
   * Get only active triggers (trigger_swap = true)
   */
  router.get('/triggers/active', async (req: Request, res: Response) => {
    try {
      if (daemon) {
        const activeTriggers = await daemon.getActiveTriggers();
        res.json({
          success: true,
          triggers: activeTriggers,
          count: activeTriggers.length
        });
      } else {
        const result = await pool.query(`
          SELECT * FROM pair_trade_triggers 
          WHERE trigger_swap = true
          ORDER BY updated_at DESC
        `);
        
        res.json({
          success: true,
          triggers: result.rows,
          count: result.rows.length
        });
      }
    } catch (error) {
      console.error('Error fetching active triggers:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch active triggers'
      });
    }
  });

  /**
   * POST /api/pair-trades/trigger
   * Manually set a trigger to execute swaps
   * 
   * Body:
   * {
   *   "tokenA": "So11111111111111111111111111111111111111112",
   *   "tokenB": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
   *   "direction": "A_TO_B" // or "B_TO_A"
   * }
   */
  router.post('/trigger', async (req: Request, res: Response) => {
    const { tokenA, tokenB, direction } = req.body;

    // Validation
    if (!tokenA || !tokenB || !direction) {
      return res.status(400).json({
        success: false,
        error: 'tokenA, tokenB, and direction are required'
      });
    }

    if (!['A_TO_B', 'B_TO_A'].includes(direction)) {
      return res.status(400).json({
        success: false,
        error: 'direction must be A_TO_B or B_TO_A'
      });
    }

    try {
      // Check if trigger exists for this pair
      const checkResult = await pool.query(`
        SELECT id, token_a_symbol, token_b_symbol FROM pair_trade_triggers
        WHERE 
          (token_a_mint = $1 AND token_b_mint = $2) OR
          (token_a_mint = $2 AND token_b_mint = $1)
      `, [tokenA, tokenB]);

      if (checkResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: `No trigger configuration found for token pair ${tokenA}/${tokenB}`
        });
      }

      const trigger = checkResult.rows[0];
      
      // Update the trigger
      await pool.query(`
        UPDATE pair_trade_triggers
        SET 
          current_direction = $3,
          trigger_swap = true,
          updated_at = NOW()
        WHERE id = $1
      `, [trigger.id, direction]);

      console.log(`[API] Manual trigger set: ${trigger.token_a_symbol}/${trigger.token_b_symbol} - ${direction}`);

      res.json({
        success: true,
        message: `Trigger set for ${trigger.token_a_symbol}/${trigger.token_b_symbol} - ${direction}`,
        trigger: {
          id: trigger.id,
          tokenPair: `${trigger.token_a_symbol}/${trigger.token_b_symbol}`,
          direction,
          status: 'Active - Daemon will execute swaps'
        }
      });
    } catch (error) {
      console.error('Error setting trigger:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to set trigger'
      });
    }
  });

  /**
   * POST /api/pair-trades/trigger/hold
   * Set a pair to HOLD (no swaps)
   */
  router.post('/trigger/hold', async (req: Request, res: Response) => {
    const { tokenA, tokenB } = req.body;

    if (!tokenA || !tokenB) {
      return res.status(400).json({
        success: false,
        error: 'tokenA and tokenB are required'
      });
    }

    try {
      const result = await pool.query(`
        UPDATE pair_trade_triggers
        SET 
          current_direction = 'HOLD',
          trigger_swap = false,
          updated_at = NOW()
        WHERE 
          (token_a_mint = $1 AND token_b_mint = $2) OR
          (token_a_mint = $2 AND token_b_mint = $1)
      `, [tokenA, tokenB]);

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'Token pair not found'
        });
      }

      res.json({
        success: true,
        message: 'Pair set to HOLD - no swaps will be executed'
      });
    } catch (error) {
      console.error('Error setting HOLD:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to set HOLD'
      });
    }
  });

  /**
   * POST /api/pair-trades/trigger/manual-check
   * Manually trigger daemon to check for triggers now
   */
  router.post('/trigger/manual-check', async (req: Request, res: Response) => {
    try {
      if (!daemon) {
        return res.status(503).json({
          success: false,
          error: 'Daemon not available'
        });
      }

      console.log('[API] Manual daemon check requested');
      await daemon.checkNow();

      res.json({
        success: true,
        message: 'Manual trigger check completed'
      });
    } catch (error) {
      console.error('Error in manual check:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to execute manual check'
      });
    }
  });

  /**
   * GET /api/pair-trades/daemon/status
   * Get daemon status
   */
  router.get('/daemon/status', (req: Request, res: Response) => {
    if (!daemon) {
      return res.status(503).json({
        success: false,
        error: 'Daemon not available'
      });
    }

    const status = daemon.getStatus();
    res.json({
      success: true,
      daemon: status
    });
  });

  /**
   * POST /api/pair-trades/daemon/interval
   * Update daemon check interval
   */
  router.post('/daemon/interval', (req: Request, res: Response) => {
    const { intervalMs } = req.body;

    if (!daemon) {
      return res.status(503).json({
        success: false,
        error: 'Daemon not available'
      });
    }

    if (!intervalMs || intervalMs < 1000) {
      return res.status(400).json({
        success: false,
        error: 'intervalMs must be at least 1000'
      });
    }

    try {
      daemon.setCheckInterval(intervalMs);
      res.json({
        success: true,
        message: `Daemon check interval updated to ${intervalMs}ms`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update interval'
      });
    }
  });

  /**
   * GET /api/pair-trades/strategies
   * Get all pair trade strategies and their current positions
   */
  router.get('/strategies', async (req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT 
          j.id,
          j.trading_wallet_public_key,
          j.data->>'tokenASymbol' as token_a_symbol,
          j.data->>'tokenBSymbol' as token_b_symbol,
          j.data->>'currentToken' as current_position,
          j.data->>'allocationPercentage' as allocation_percentage,
          j.data->>'lastSwapTimestamp' as last_swap,
          jsonb_array_length(j.data->'swapHistory') as swap_count,
          j.is_active,
          j.created_at
        FROM jobs j
        WHERE j.type = 'pair-trade'
        ORDER BY j.created_at DESC
      `);
      
      res.json({
        success: true,
        strategies: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching strategies:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch strategies'
      });
    }
  });

  /**
   * POST /api/pair-trades/pair
   * Add a new token pair configuration
   */
  router.post('/pair', async (req: Request, res: Response) => {
    const { 
      tokenAMint, 
      tokenBMint, 
      tokenASymbol, 
      tokenBSymbol, 
      preferredInitialToken 
    } = req.body;

    // Validation
    if (!tokenAMint || !tokenBMint || !tokenASymbol || !tokenBSymbol || !preferredInitialToken) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required: tokenAMint, tokenBMint, tokenASymbol, tokenBSymbol, preferredInitialToken'
      });
    }

    if (!['A', 'B'].includes(preferredInitialToken)) {
      return res.status(400).json({
        success: false,
        error: 'preferredInitialToken must be A or B'
      });
    }

    try {
      const result = await pool.query(`
        INSERT INTO pair_trade_triggers (
          token_a_mint, token_b_mint, token_a_symbol, token_b_symbol, 
          preferred_initial_token, current_direction, trigger_swap
        ) VALUES ($1, $2, $3, $4, $5, 'HOLD', false)
        RETURNING id
      `, [tokenAMint, tokenBMint, tokenASymbol, tokenBSymbol, preferredInitialToken]);

      res.json({
        success: true,
        message: `Token pair ${tokenASymbol}/${tokenBSymbol} added successfully`,
        pairId: result.rows[0].id
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate key')) {
        res.status(409).json({
          success: false,
          error: 'Token pair already exists'
        });
      } else {
        console.error('Error adding pair:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to add token pair'
        });
      }
    }
  });

  return router;
} 