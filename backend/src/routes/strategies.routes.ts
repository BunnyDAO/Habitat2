import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware';
import { rateLimitMiddleware } from '../middleware/rate-limit.middleware';
import { validateStrategyRequest } from '../middleware/validation.middleware';
import { createClient } from '@supabase/supabase-js';

const router = Router();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Apply rate limiting to all strategy routes
router.use(rateLimitMiddleware);

// Create strategy
router.post('/',
  authMiddleware,
  validateStrategyRequest,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { trading_wallet_id, strategy_type, config } = req.body;
      
      // Verify trading wallet ownership
      if (trading_wallet_id !== req.user.trading_wallet_id) {
        return res.status(403).json({ error: 'Access denied to trading wallet' });
      }

      const { data, error } = await supabase
        .from('strategies')
        .insert([{
          trading_wallet_id,
          main_wallet_pubkey: req.user.main_wallet_pubkey,
          strategy_type,
          config,
          version: 1
        }])
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      console.error('Error creating strategy:', error);
      res.status(500).json({ error: 'Failed to create strategy' });
    }
  }
);

// Get strategies
router.get('/',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { trading_wallet_id } = req.query;
      
      const query = supabase
        .from('strategies')
        .select('*')
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey);

      if (trading_wallet_id) {
        query.eq('trading_wallet_id', trading_wallet_id);
      }

      const { data, error } = await query;

      if (error) throw error;
      res.json(data);
    } catch (error) {
      console.error('Error fetching strategies:', error);
      res.status(500).json({ error: 'Failed to fetch strategies' });
    }
  }
);

// Update strategy
router.put('/:id',
  authMiddleware,
  validateStrategyRequest,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { id } = req.params;
      const { config, change_reason } = req.body;

      // Verify strategy ownership
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('*')
        .eq('id', id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .single();

      if (strategyError || !strategy) {
        return res.status(404).json({ error: 'Strategy not found or access denied' });
      }

      // Increment version
      const newVersion = strategy.version + 1;

      const { data, error } = await supabase
        .from('strategies')
        .update({ 
          config,
          version: newVersion,
          change_reason
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      console.error('Error updating strategy:', error);
      res.status(500).json({ error: 'Failed to update strategy' });
    }
  }
);

// Get strategy versions
router.get('/:id/versions',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { id } = req.params;

      // Verify strategy ownership
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('*')
        .eq('id', id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .single();

      if (strategyError || !strategy) {
        return res.status(404).json({ error: 'Strategy not found or access denied' });
      }

      // Get version history
      const { data, error } = await supabase
        .from('strategy_versions')
        .select('*')
        .eq('strategy_id', id)
        .order('version', { ascending: false });

      if (error) throw error;
      res.json(data);
    } catch (error) {
      console.error('Error fetching strategy versions:', error);
      res.status(500).json({ error: 'Failed to fetch strategy versions' });
    }
  }
);

// Restore strategy version
router.post('/:id/restore/:version',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { id, version } = req.params;

      // Verify strategy ownership
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('*')
        .eq('id', id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .single();

      if (strategyError || !strategy) {
        return res.status(404).json({ error: 'Strategy not found or access denied' });
      }

      // Get version to restore
      const { data: versionData, error: versionError } = await supabase
        .from('strategy_versions')
        .select('*')
        .eq('strategy_id', id)
        .eq('version', version)
        .single();

      if (versionError || !versionData) {
        return res.status(404).json({ error: 'Version not found' });
      }

      // Restore version
      const { data, error } = await supabase
        .from('strategies')
        .update({ 
          config: versionData.config,
          version: strategy.version + 1,
          change_reason: `Restored to version ${version}`
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      console.error('Error restoring strategy version:', error);
      res.status(500).json({ error: 'Failed to restore strategy version' });
    }
  }
);

// Delete strategy
router.delete('/:id',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { id } = req.params;

      // Verify strategy ownership
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('*')
        .eq('id', id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .single();

      if (strategyError || !strategy) {
        return res.status(404).json({ error: 'Strategy not found or access denied' });
      }

      const { error } = await supabase
        .from('strategies')
        .delete()
        .eq('id', id);

      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting strategy:', error);
      res.status(500).json({ error: 'Failed to delete strategy' });
    }
  }
);

export default router; 