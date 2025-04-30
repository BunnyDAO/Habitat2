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

      const { trading_wallet_id, strategy_type, config, name } = req.body;
      
      // Verify trading wallet ownership
      const { data: wallet, error: walletError } = await supabase
        .from('trading_wallets')
        .select('*')
        .eq('id', trading_wallet_id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .single();

      if (walletError || !wallet) {
        return res.status(403).json({ error: 'Access denied to trading wallet' });
      }

      // Check for existing strategy of the same type
      const { data: existingStrategy, error: existingError } = await supabase
        .from('strategies')
        .select('*')
        .eq('trading_wallet_id', trading_wallet_id)
        .eq('strategy_type', strategy_type)
        .single();

      // Get the position of this trading wallet
      const { data: walletPosition, error: positionError } = await supabase
        .from('trading_wallets')
        .select('id')
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .order('created_at', { ascending: true });

      if (positionError) {
        console.error('Error getting wallet position:', positionError);
        throw positionError;
      }

      // Calculate position (1-based index)
      const position = walletPosition.findIndex(w => w.id === trading_wallet_id) + 1;

      if (existingStrategy) {
        // Update existing strategy
        const { data: updatedStrategy, error: updateError } = await supabase
          .from('strategies')
          .update({
            config,
            name,
            version: existingStrategy.version + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingStrategy.id)
          .select()
          .single();

        if (updateError) throw updateError;

        // Create version history entry
        await supabase
          .from('strategy_versions')
          .insert({
            strategy_id: existingStrategy.id,
            version: existingStrategy.version,
            config: existingStrategy.config,
            created_by: req.user.main_wallet_pubkey,
            change_reason: 'Strategy updated with new configuration'
          });

        return res.json(updatedStrategy);
      }

      // Create new strategy if no existing one found
      const { data, error } = await supabase
        .from('strategies')
        .insert([{
          trading_wallet_id,
          main_wallet_pubkey: req.user.main_wallet_pubkey,
          strategy_type,
          config,
          name,
          version: 1,
          is_active: true,
          position,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) {
        console.error('Error creating strategy:', error);
        throw error;
      }

      res.json(data);
    } catch (error) {
      console.error('Error in strategy creation:', error);
      res.status(500).json({ error: 'Failed to create/update strategy' });
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

      // Update strategy
      const { data, error } = await supabase
        .from('strategies')
        .update({ 
          config,
          version: newVersion,
          change_reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Create new version record
      const { error: versionError } = await supabase
        .from('strategy_versions')
        .insert([{
          strategy_id: id,
          version: newVersion,
          config,
          change_reason,
          created_at: new Date().toISOString()
        }]);

      if (versionError) {
        console.error('Error creating strategy version:', versionError);
        // Don't throw here, as the strategy was updated successfully
      }

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

      // Increment version
      const newVersion = strategy.version + 1;

      // Restore version
      const { data, error } = await supabase
        .from('strategies')
        .update({ 
          config: versionData.config,
          version: newVersion,
          change_reason: `Restored to version ${version}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Create new version record
      const { error: newVersionError } = await supabase
        .from('strategy_versions')
        .insert([{
          strategy_id: id,
          version: newVersion,
          config: versionData.config,
          change_reason: `Restored to version ${version}`,
          created_at: new Date().toISOString()
        }]);

      if (newVersionError) {
        console.error('Error creating strategy version:', newVersionError);
        // Don't throw here, as the strategy was restored successfully
      }

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

      // Delete strategy versions first
      const { error: versionsError } = await supabase
        .from('strategy_versions')
        .delete()
        .eq('strategy_id', id);

      if (versionsError) {
        console.error('Error deleting strategy versions:', versionsError);
        // Continue with strategy deletion even if version deletion fails
      }

      // Delete strategy
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

// Publish strategy
router.post('/:id/publish',
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
        .select('*, trading_wallets!inner(*)')
        .eq('id', id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .single();

      if (strategyError || !strategy) {
        return res.status(404).json({ error: 'Strategy not found or access denied' });
      }

      // Update strategy to mark it as published
      const { data, error } = await supabase
        .from('strategies')
        .update({ 
          is_lackey: true,
          original_wallet_pubkey: strategy.trading_wallets.wallet_pubkey,
          current_wallet_pubkey: strategy.trading_wallets.wallet_pubkey
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      console.error('Error publishing strategy:', error);
      res.status(500).json({ error: 'Failed to publish strategy' });
    }
  }
);

// Get published strategies
router.get('/published',
  async (req, res) => {
    try {
      // Get all published strategies with their usage count
      const { data, error } = await supabase
        .from('strategies')
        .select(`
          id,
          strategy_type,
          name,
          config,
          position,
          original_wallet_pubkey,
          created_at,
          updated_at,
          count:trading_wallets(count)
        `)
        .eq('is_lackey', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Format the response to include the wallet count
      const formattedData = data.map(strategy => ({
        ...strategy,
        wallet_count: strategy.count[0]?.count || 0
      }));

      res.json(formattedData);
    } catch (error) {
      console.error('Error fetching published strategies:', error);
      res.status(500).json({ error: 'Failed to fetch published strategies' });
    }
  }
);

// Import published strategy
router.post('/import/:id',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { id } = req.params;
      const { trading_wallet_id } = req.body;

      // Get the strategy to import
      const { data: sourceStrategy, error: sourceError } = await supabase
        .from('strategies')
        .select('*')
        .eq('id', id)
        .eq('is_lackey', true)
        .single();

      if (sourceError || !sourceStrategy) {
        return res.status(404).json({ error: 'Published strategy not found' });
      }

      // Verify trading wallet ownership
      const { data: wallet, error: walletError } = await supabase
        .from('trading_wallets')
        .select('*')
        .eq('id', trading_wallet_id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .single();

      if (walletError || !wallet) {
        return res.status(403).json({ error: 'Access denied to trading wallet' });
      }

      // Create new strategy as a copy
      const { data, error } = await supabase
        .from('strategies')
        .insert([{
          trading_wallet_id,
          main_wallet_pubkey: req.user.main_wallet_pubkey,
          strategy_type: sourceStrategy.strategy_type,
          config: sourceStrategy.config,
          name: sourceStrategy.name,
          version: 1,
          is_active: true,
          is_lackey: true,
          position: sourceStrategy.position,
          original_wallet_pubkey: sourceStrategy.original_wallet_pubkey,
          current_wallet_pubkey: wallet.wallet_pubkey,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      console.error('Error importing strategy:', error);
      res.status(500).json({ error: 'Failed to import strategy' });
    }
  }
);

export default router; 