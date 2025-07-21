import { Router } from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware';
import { rateLimitMiddleware } from '../middleware/rate-limit.middleware';
import { validateStrategyRequest } from '../middleware/validation.middleware';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createStrategiesRouter(pool: Pool, redisClient: ReturnType<typeof createClient> | null) {
  const router = Router();
  const supabase = createSupabaseClient(
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
    console.log('🚀 STRATEGY ROUTE HANDLER - ENTERED');
    console.log('🚀 STRATEGY ROUTE HANDLER - Method:', req.method);
    console.log('🚀 STRATEGY ROUTE HANDLER - Body:', req.body);
    
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { trading_wallet_id, strategy_type, config, name } = req.body;
      
      // DEBUG: Log the incoming request
      console.log('🔍 WALLET MONITOR DEBUG - Incoming request:', {
        trading_wallet_id,
        strategy_type,
        config: JSON.stringify(config),
        name,
        configKeys: Object.keys(config || {}),
        walletAddressExists: !!(config && config.walletAddress)
      });
      
      // Verify trading wallet ownership
      const { data: wallet, error: walletError } = await supabase
        .from('trading_wallets')
        .select('id, wallet_pubkey')
        .eq('id', trading_wallet_id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .single();

      if (walletError || !wallet) {
        return res.status(403).json({ error: 'Access denied to trading wallet' });
      }

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

      // Check for existing strategies of the same type to handle duplicates intelligently
      console.log('🔍 Checking for existing strategies...', { trading_wallet_id, strategy_type });
      const { data: existingStrategies, error: existingError } = await supabase
        .from('strategies')
        .select('*')
        .eq('trading_wallet_id', trading_wallet_id)
        .eq('strategy_type', strategy_type);

      if (existingError) {
        console.error('Error checking existing strategies:', existingError);
        // Continue anyway, as this is not critical for strategy creation
      }

      console.log('📊 Found existing strategies:', existingStrategies?.length || 0);
      existingStrategies?.forEach((strategy, index) => {
        console.log(`  Strategy ${index + 1}: ID=${strategy.id}, Config=${JSON.stringify(strategy.config)}`);
      });

      // Special handling for wallet-monitor strategies
      if (strategy_type === 'wallet-monitor' && config.walletAddress) {
        console.log('🔍 WALLET MONITOR DEBUG - Detected wallet monitor strategy');
        console.log('🔍 WALLET MONITOR DEBUG - Looking for existing wallet address:', config.walletAddress);
        console.log('🔍 WALLET MONITOR DEBUG - Existing strategies count:', existingStrategies?.length || 0);
        
        existingStrategies?.forEach((strategy, index) => {
          console.log(`🔍 WALLET MONITOR DEBUG - Strategy ${index + 1}:`, {
            id: strategy.id,
            configWalletAddress: strategy.config?.walletAddress,
            configPercentage: strategy.config?.percentage,
            matchesWallet: strategy.config?.walletAddress === config.walletAddress
          });
        });
        
        // Check if there's already a wallet monitor for the same wallet address
        const existingWalletMonitor = existingStrategies?.find(strategy => 
          strategy.config && strategy.config.walletAddress === config.walletAddress
        );

        console.log('🔍 WALLET MONITOR DEBUG - Existing wallet monitor found:', !!existingWalletMonitor);
        
        if (existingWalletMonitor) {
          console.log('🔄 WALLET MONITOR DEBUG - Found existing wallet monitor for same wallet, updating instead of creating new:', {
            existingId: existingWalletMonitor.id,
            oldPercentage: existingWalletMonitor.config.percentage,
            newPercentage: config.percentage,
            oldName: existingWalletMonitor.name,
            newName: name
          });

          // Update existing strategy instead of creating new one
          const { data: updatedStrategy, error: updateError } = await supabase
            .from('strategies')
            .update({
              config,
              name,
              version: existingWalletMonitor.version + 1,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingWalletMonitor.id)
            .select()
            .single();

          if (updateError) {
            console.error('❌ Error updating existing wallet monitor strategy:', updateError);
            throw updateError;
          }

          console.log('✅ Successfully updated existing wallet monitor strategy');
          return res.json(updatedStrategy);
        }
      }

      // Check if there's an identical strategy (same type + same config) for other strategy types
      console.log('🔍 Looking for identical config:', JSON.stringify(config));
      const identicalStrategy = existingStrategies?.find(strategy => 
        JSON.stringify(strategy.config) === JSON.stringify(config)
      );

      console.log('🎯 Identical strategy found:', identicalStrategy ? `ID=${identicalStrategy.id}` : 'None');

      if (identicalStrategy) {
        // For non-wallet-monitor strategies with identical config, delete the old one and create new
        console.log('🗑️ Found identical strategy, deleting old one and creating new:', identicalStrategy.id);
        
        // Delete the old identical strategy first
        const { error: deleteError } = await supabase
          .from('strategies')
          .delete()
          .eq('id', identicalStrategy.id);

        if (deleteError) {
          console.error('❌ Error deleting old identical strategy:', deleteError);
          // Continue anyway - we'll create the new one
        } else {
          console.log('✅ Successfully deleted old identical strategy');
        }
        
        // Continue to create the new strategy below
        // (Don't return here, let it fall through to the creation logic)
      }

      // Create new strategy - either different type or different config
      console.log('➕ WALLET MONITOR DEBUG - About to create new strategy (no duplicate prevention triggered)');
      console.log('➕ WALLET MONITOR DEBUG - Strategy details:', { 
        trading_wallet_id, 
        strategy_type, 
        config: JSON.stringify(config),
        name,
        isWalletMonitor: strategy_type === 'wallet-monitor',
        hasWalletAddress: !!(config && config.walletAddress)
      });
      
      const insertData = {
        trading_wallet_id,
        main_wallet_pubkey: req.user.main_wallet_pubkey,
        strategy_type,
        config,
        name,
        version: 1,
        is_active: true,
        position,
        current_wallet_pubkey: wallet.wallet_pubkey,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      console.log('📝 Insert data:', JSON.stringify(insertData, null, 2));
      
      const { data, error } = await supabase
        .from('strategies')
        .insert([insertData])
        .select()
        .single();

      if (error) {
        console.error('Supabase error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        
        // Provide more user-friendly error messages
        let userMessage = 'Failed to create strategy';
        if (error.code === '23505') {
          userMessage = 'A strategy with these exact settings already exists. Please modify the configuration or delete the existing strategy first.';
        } else if (error.code === '23503') {
          userMessage = 'Invalid trading wallet or configuration. Please check your settings and try again.';
        } else if (error.message?.includes('permission')) {
          userMessage = 'You do not have permission to create strategies for this wallet.';
        }
        
        const customError = new Error(userMessage);
        (customError as any).originalError = error;
        throw customError;
      }

      console.log('Successfully created strategy with ID:', data.id);

      // Special handling for pair-trade strategies
      if (strategy_type === 'pair-trade') {
        try {
          // Import services for pair-trade initialization
          const { ValuationService } = await import('../services/valuation.service');
          const { HoldingsTracker } = await import('../services/holdings-tracker.service');
          
          const valuationService = new ValuationService();
          const holdingsTracker = new HoldingsTracker(pool);

          // Get initial valuation to determine allocation
          const valuation = await valuationService.getUndervaluedToken(
            config.tokenAMint, 
            config.tokenBMint
          );

          // Initialize holdings based on allocation percentage and valuation
          const allocationAmount = config.allocationPercentage || 100; // Use full allocation if not specified
          const allocationSOL = allocationAmount * 1000000000; // Convert to lamports (assuming 1 SOL base allocation)

          // Determine initial allocation based on valuation
          let tokenAAmount = 0;
          let tokenBAmount = 0;

          if (valuation.recommendedToken === 'A') {
            // Allocate 50% to token A (recommended)
            tokenAAmount = allocationSOL * 0.5;
          } else if (valuation.recommendedToken === 'B') {
            // Allocate 50% to token B (recommended)
            tokenBAmount = allocationSOL * 0.5;
          } else {
            // Equal allocation if no clear recommendation
            tokenAAmount = allocationSOL * 0.5;
            tokenBAmount = allocationSOL * 0.5;
          }

          // Create initial holdings record
          const initialHoldings = {
            tokenA: { mint: config.tokenAMint, amount: tokenAAmount },
            tokenB: { mint: config.tokenBMint, amount: tokenBAmount },
            totalAllocatedSOL: allocationSOL
          };

          await holdingsTracker.updateHoldings(data.id, initialHoldings);

          // Record initial allocation trade
          await holdingsTracker.recordTrade({
            strategyId: data.id,
            tradeType: 'initial_allocation',
            fromMint: 'SOL', // Assuming SOL as base currency
            toMint: valuation.recommendedToken === 'A' ? config.tokenAMint : config.tokenBMint,
            inputAmount: allocationSOL,
            outputAmount: valuation.recommendedToken === 'A' ? tokenAAmount : tokenBAmount,
            percentageTraded: 50,
            executionStatus: 'completed',
            signalData: {
              initialValuation: valuation,
              allocationReason: `Initial allocation based on valuation - ${valuation.recommendedToken} token is recommended`
            }
          });

          console.log('✅ Pair-trade strategy initialized with valuation-based allocation');
        } catch (error) {
          console.error('⚠️ Error initializing pair-trade strategy holdings:', error);
          // Continue anyway - strategy was created successfully, holdings can be initialized later
        }
      }

      res.json(data);
    } catch (error) {
      console.error('Error in strategy creation:', error);
      
      // Send user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Failed to create strategy';
      res.status(500).json({ 
        error: errorMessage,
        details: 'Please try again or contact support if the problem persists'
      });
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
      
      // Join with trading_wallets to get the wallet_pubkey for each strategy
      const query = supabase
        .from('strategies')
        .select(`
          *,
          trading_wallets!inner(
            id,
            wallet_pubkey,
            name
          )
        `)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey);

      if (trading_wallet_id) {
        query.eq('trading_wallet_id', trading_wallet_id);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      // Transform the data to include wallet_pubkey at the top level
      const transformedData = data.map(strategy => ({
        ...strategy,
        wallet_pubkey: strategy.trading_wallets.wallet_pubkey,
        trading_wallet_name: strategy.trading_wallets.name
      }));
      
      res.json(transformedData);
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
        .select(`
          *,
          trading_wallets!inner(
            id,
            wallet_pubkey
          )
        `)
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
          current_wallet_pubkey: strategy.trading_wallets.wallet_pubkey,
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
      console.log('Attempting to delete strategy with ID:', id);
      console.log('User attempting deletion:', req.user.main_wallet_pubkey);

      // Verify strategy ownership
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('*')
        .eq('id', id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .single();

      if (strategyError) {
        console.error('Error finding strategy:', strategyError);
        return res.status(404).json({ error: 'Strategy not found or access denied' });
      }

      if (!strategy) {
        console.log('Strategy not found for ID:', id);
        return res.status(404).json({ error: 'Strategy not found or access denied' });
      }

      console.log('Found strategy to delete:', {
        id: strategy.id,
        name: strategy.name,
        type: strategy.strategy_type,
        trading_wallet_id: strategy.trading_wallet_id
      });

      // Delete strategy versions first
      console.log('Deleting strategy versions for strategy ID:', id);
      const { error: versionsError } = await supabase
        .from('strategy_versions')
        .delete()
        .eq('strategy_id', id);

      if (versionsError) {
        console.error('Error deleting strategy versions:', versionsError);
        // Continue with strategy deletion even if version deletion fails
      } else {
        console.log('Successfully deleted strategy versions');
      }

      // Delete strategy
      console.log('Deleting strategy with ID:', id);
      const { error } = await supabase
        .from('strategies')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting strategy:', error);
        throw error;
      }

      console.log('Successfully deleted strategy with ID:', id);
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

// Get supported tokens for pair trading
router.get('/tokens/supported',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      console.log('🪙 GET /tokens/supported - Starting request');
      if (!req.user) {
        console.log('❌ User not authenticated');
        return res.status(401).json({ error: 'User not authenticated' });
      }

      console.log('✅ User authenticated:', req.user.main_wallet_pubkey);

      // Import TokenService here to avoid circular dependency
      const { TokenService } = await import('../services/TokenService');
      const tokenService = new TokenService(pool, redisClient);

      console.log('🪙 TokenService created, calling getSupportedTokens()');
      const tokens = await tokenService.getSupportedTokens();
      console.log('🪙 Got tokens from service:', tokens.length, 'tokens');
      console.log('🪙 Token details:', tokens.map(t => ({ 
        symbol: t.symbol, 
        isActive: t.isActive, 
        mintAddress: t.mintAddress.slice(0, 10) + '...' 
      })));
      
      const activeTokens = tokens.filter(t => t.isActive);
      console.log('🪙 Active tokens only:', activeTokens.length, 'tokens');
      
      res.json(tokens);
    } catch (error) {
      console.error('❌ Error fetching supported tokens:', error);
      res.status(500).json({ error: 'Failed to fetch supported tokens' });
    }
  }
);

// Get tokens grouped by category
router.get('/tokens/categories',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Import TokenService here to avoid circular dependency
      const { TokenService } = await import('../services/TokenService');
      const tokenService = new TokenService(pool, redisClient);

      const grouped = await tokenService.getTokensGroupedByCategory();
      res.json(grouped);
    } catch (error) {
      console.error('Error fetching token categories:', error);
      res.status(500).json({ error: 'Failed to fetch token categories' });
    }
  }
);

// Execute pair trade swap
router.post('/:id/pair-trade/swap',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { id } = req.params;
      const { trigger = 'manual' } = req.body;

      // Verify strategy ownership
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('*')
        .eq('id', id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .eq('strategy_type', 'pair-trade')
        .single();

      if (strategyError || !strategy) {
        return res.status(404).json({ error: 'Pair trade strategy not found or access denied' });
      }

      // Get the strategy daemon to execute the swap
      // For now, return a placeholder response
      // TODO: Implement actual swap execution through strategy daemon
      res.json({ 
        success: true,
        message: 'Swap triggered successfully',
        trigger,
        strategy_id: id
      });
    } catch (error) {
      console.error('Error executing pair trade swap:', error);
      res.status(500).json({ error: 'Failed to execute pair trade swap' });
    }
  }
);

// Get pair trade status
router.get('/:id/pair-trade/status',
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
        .select(`
          *,
          trading_wallets!inner(
            id,
            wallet_pubkey,
            name
          )
        `)
        .eq('id', id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .eq('strategy_type', 'pair-trade')
        .single();

      if (strategyError || !strategy) {
        return res.status(404).json({ error: 'Pair trade strategy not found or access denied' });
      }

      // Get current status from the strategy daemon
      // For now, return a placeholder response based on strategy config
      // TODO: Implement actual status retrieval from strategy daemon
      const config = strategy.config;
      
      res.json({
        strategy_id: id,
        token_a_symbol: config.tokenASymbol,
        token_b_symbol: config.tokenBSymbol,
        current_token: config.currentToken,
        current_token_symbol: config.currentToken === 'A' ? config.tokenASymbol : config.tokenBSymbol,
        allocation_percentage: config.allocationPercentage,
        max_slippage: config.maxSlippage,
        auto_rebalance: config.autoRebalance,
        is_active: strategy.is_active,
        last_swap_timestamp: null, // TODO: Get from swap history
        swap_count: 0, // TODO: Get from swap history
        current_balance: 0, // TODO: Get from worker
        balance_usd: 0, // TODO: Calculate USD value
        is_processing_swap: false // TODO: Get from worker
      });
    } catch (error) {
      console.error('Error fetching pair trade status:', error);
      res.status(500).json({ error: 'Failed to fetch pair trade status' });
    }
  }
);

// Validate token pair
router.post('/tokens/validate-pair',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { tokenAMint, tokenBMint } = req.body;

      if (!tokenAMint || !tokenBMint) {
        return res.status(400).json({ error: 'Both tokenAMint and tokenBMint are required' });
      }

      // Import TokenService here to avoid circular dependency
      const { TokenService } = await import('../services/TokenService');
      const tokenService = new TokenService(pool, redisClient);

      const validation = tokenService.validateTokenPair(tokenAMint, tokenBMint);
      res.json(validation);
    } catch (error) {
      console.error('Error validating token pair:', error);
      res.status(500).json({ error: 'Failed to validate token pair' });
    }
  }
);

// Get strategy holdings
router.get('/:id/holdings',
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
        .eq('strategy_type', 'pair-trade')
        .single();

      if (strategyError || !strategy) {
        return res.status(404).json({ error: 'Pair trade strategy not found or access denied' });
      }

      // Import HoldingsTracker here to avoid circular dependency
      const { HoldingsTracker } = await import('../services/holdings-tracker.service');
      const holdingsTracker = new HoldingsTracker(pool);

      const holdings = await holdingsTracker.getHoldings(id);
      
      if (!holdings) {
        return res.json({
          success: true,
          data: null,
          message: 'No holdings found for this strategy'
        });
      }

      // Calculate portfolio value
      const portfolioValue = await holdingsTracker.calculatePortfolioValue(holdings);

      res.json({
        success: true,
        data: {
          holdings,
          portfolioValue
        }
      });

    } catch (error) {
      console.error('Error fetching strategy holdings:', error);
      res.status(500).json({ 
        error: 'Failed to fetch strategy holdings',
        message: (error as Error).message
      });
    }
  }
);

// Get strategy trade history
router.get('/:id/trade-history',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      // Verify strategy ownership
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('*')
        .eq('id', id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .eq('strategy_type', 'pair-trade')
        .single();

      if (strategyError || !strategy) {
        return res.status(404).json({ error: 'Pair trade strategy not found or access denied' });
      }

      // Import HoldingsTracker here to avoid circular dependency
      const { HoldingsTracker } = await import('../services/holdings-tracker.service');
      const holdingsTracker = new HoldingsTracker(pool);

      const tradeHistory = await holdingsTracker.getTradeHistory(id, limit, offset);

      res.json({
        success: true,
        data: tradeHistory,
        pagination: {
          limit,
          offset,
          count: tradeHistory.length
        }
      });

    } catch (error) {
      console.error('Error fetching strategy trade history:', error);
      res.status(500).json({ 
        error: 'Failed to fetch strategy trade history',
        message: (error as Error).message
      });
    }
  }
);

  return router;
}

// For backward compatibility, export a default router
// This should be removed once all imports are updated
export default createStrategiesRouter; 