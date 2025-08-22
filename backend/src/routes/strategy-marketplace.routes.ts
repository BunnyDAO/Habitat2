import { Router, Request, Response } from 'express';
import { StrategyMarketplaceService } from '../services/strategy-marketplace.service';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  BrowseStrategiesRequest,
  AdoptStrategyRequest
} from '../types/strategy-publishing';

const router = Router();
const marketplaceService = new StrategyMarketplaceService();

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @route GET /api/shop/strategies
 * @desc Browse strategies in the marketplace
 * @access Private
 */
router.get('/strategies', async (req: Request, res: Response) => {
  try {
    const filters: BrowseStrategiesRequest = {
      category: req.query.category as string,
      tags: req.query.tags ? (req.query.tags as string).split(',') : undefined,
      minRating: req.query.minRating ? parseFloat(req.query.minRating as string) : undefined,
      maxRequiredWallets: req.query.maxRequiredWallets ? parseInt(req.query.maxRequiredWallets as string) : undefined,
      sortBy: req.query.sortBy as any,
      sortOrder: req.query.sortOrder as any,
      page: req.query.page ? parseInt(req.query.page as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined
    };

    const result = await marketplaceService.browseStrategies(filters);
    res.json(result);

  } catch (error) {
    console.error('Error browsing strategies:', error);
    res.status(500).json({ error: 'Failed to browse strategies' });
  }
});

/**
 * @route GET /api/shop/strategies/search
 * @desc Search strategies by text
 * @access Private
 */
router.get('/strategies/search', async (req: Request, res: Response) => {
  try {
    const searchTerm = req.query.q as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

    if (!searchTerm || searchTerm.trim().length === 0) {
      return res.status(400).json({ error: 'Search term is required' });
    }

    const strategies = await marketplaceService.searchStrategies(searchTerm, limit);
    res.json({ strategies });

  } catch (error) {
    console.error('Error searching strategies:', error);
    res.status(500).json({ error: 'Failed to search strategies' });
  }
});

/**
 * @route GET /api/shop/strategies/:id
 * @desc Get detailed strategy information
 * @access Private
 */
router.get('/strategies/:id', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);

    if (isNaN(publishedStrategyId)) {
      return res.status(400).json({ error: 'Invalid strategy ID' });
    }

    const strategyDetails = await marketplaceService.getStrategyDetails(publishedStrategyId);
    res.json(strategyDetails);

  } catch (error) {
    console.error('Error fetching strategy details:', error);
    if (error instanceof Error && error.message === 'Strategy not found') {
      res.status(404).json({ error: 'Strategy not found' });
    } else {
      res.status(500).json({ error: 'Failed to fetch strategy details' });
    }
  }
});

/**
 * @route POST /api/shop/strategies/:id/adopt
 * @desc Adopt a strategy from the marketplace
 * @access Private
 */
router.post('/strategies/:id/adopt', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);
    const adoptionData: AdoptStrategyRequest = req.body;
    const adopterWallet = req.user?.main_wallet_pubkey;

    if (!adopterWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (isNaN(publishedStrategyId)) {
      return res.status(400).json({ error: 'Invalid strategy ID' });
    }

    // Validate adoption data
    const validationErrors = validateAdoptionRequest(adoptionData);
    if (validationErrors.length > 0) {
      return res.status(400).json({ errors: validationErrors });
    }

    // Check if user has already adopted this strategy
    const hasAdopted = await marketplaceService.hasUserAdoptedStrategy(publishedStrategyId, adopterWallet);
    if (hasAdopted) {
      return res.status(400).json({ error: 'You have already adopted this strategy' });
    }

    const result = await marketplaceService.adoptStrategy(
      publishedStrategyId,
      adoptionData,
      adopterWallet
    );

    res.status(201).json(result);

  } catch (error) {
    console.error('Error adopting strategy:', error);
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to adopt strategy' });
    }
  }
});

/**
 * @route GET /api/shop/strategies/:id/check-adoption
 * @desc Check if user has already adopted a strategy
 * @access Private
 */
router.get('/strategies/:id/check-adoption', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);
    const adopterWallet = req.user?.main_wallet_pubkey;

    if (!adopterWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (isNaN(publishedStrategyId)) {
      return res.status(400).json({ error: 'Invalid strategy ID' });
    }

    const hasAdopted = await marketplaceService.hasUserAdoptedStrategy(publishedStrategyId, adopterWallet);
    res.json({ hasAdopted });

  } catch (error) {
    console.error('Error checking adoption status:', error);
    res.status(500).json({ error: 'Failed to check adoption status' });
  }
});

/**
 * @route GET /api/shop/strategies/:id/stats
 * @desc Get adoption statistics for a strategy
 * @access Private
 */
router.get('/strategies/:id/stats', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);

    if (isNaN(publishedStrategyId)) {
      return res.status(400).json({ error: 'Invalid strategy ID' });
    }

    const stats = await marketplaceService.getAdoptionStats(publishedStrategyId);
    res.json(stats);

  } catch (error) {
    console.error('Error fetching adoption stats:', error);
    res.status(500).json({ error: 'Failed to fetch adoption stats' });
  }
});

/**
 * @route GET /api/shop/my-adoptions
 * @desc Get user's adopted strategies
 * @access Private
 */
router.get('/my-adoptions', async (req: Request, res: Response) => {
  try {
    const adopterWallet = req.user?.main_wallet_pubkey;

    if (!adopterWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const adoptedStrategies = await marketplaceService.getUserAdoptedStrategies(adopterWallet);
    res.json(adoptedStrategies);

  } catch (error) {
    console.error('Error fetching adopted strategies:', error);
    res.status(500).json({ error: 'Failed to fetch adopted strategies' });
  }
});

/**
 * @route GET /api/shop/categories
 * @desc Get available strategy categories
 * @access Private
 */
router.get('/categories', async (req: Request, res: Response) => {
  try {
    // Lackey automation strategy categories
    const categories = [
      'Wallet Monitor',
      'Price Monitor',
      'Vault',
      'Levels',
      'Other'
    ];

    res.json({ categories });

  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * @route GET /api/shop/tags
 * @desc Get popular strategy tags
 * @access Private
 */
router.get('/tags', async (req: Request, res: Response) => {
  try {
    const query = `
      SELECT 
        unnest(tags) as tag,
        COUNT(*) as usage_count
      FROM published_strategies 
      WHERE tags IS NOT NULL AND is_active = true
      GROUP BY tag
      ORDER BY usage_count DESC, tag
      LIMIT 50
    `;

    const result = await marketplaceService.db.query(query);
    const tags = result.rows.map(row => ({
      tag: row.tag,
      count: parseInt(row.usage_count)
    }));

    res.json({ tags });

  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

/**
 * @route GET /api/shop/featured
 * @desc Get featured strategies
 * @access Private
 */
router.get('/featured', async (req: Request, res: Response) => {
  try {
    const filters: BrowseStrategiesRequest = {
      sortBy: 'rating',
      sortOrder: 'desc',
      limit: 10
    };

    const result = await marketplaceService.browseStrategies(filters);
    res.json({ strategies: result.strategies });

  } catch (error) {
    console.error('Error fetching featured strategies:', error);
    res.status(500).json({ error: 'Failed to fetch featured strategies' });
  }
});

/**
 * @route GET /api/shop/trending
 * @desc Get trending strategies (most downloads recently)
 * @access Private
 */
router.get('/trending', async (req: Request, res: Response) => {
  try {
    const filters: BrowseStrategiesRequest = {
      sortBy: 'downloads',
      sortOrder: 'desc',
      limit: 10
    };

    const result = await marketplaceService.browseStrategies(filters);
    res.json({ strategies: result.strategies });

  } catch (error) {
    console.error('Error fetching trending strategies:', error);
    res.status(500).json({ error: 'Failed to fetch trending strategies' });
  }
});

/**
 * @route GET /api/shop/recent
 * @desc Get recently published strategies
 * @access Private
 */
router.get('/recent', async (req: Request, res: Response) => {
  try {
    const filters: BrowseStrategiesRequest = {
      sortBy: 'recent',
      sortOrder: 'desc',
      limit: 10
    };

    const result = await marketplaceService.browseStrategies(filters);
    res.json({ strategies: result.strategies });

  } catch (error) {
    console.error('Error fetching recent strategies:', error);
    res.status(500).json({ error: 'Failed to fetch recent strategies' });
  }
});

// Validation helper function
function validateAdoptionRequest(data: AdoptStrategyRequest): string[] {
  const errors: string[] = [];

  if (!data.walletMapping || Object.keys(data.walletMapping).length === 0) {
    errors.push('Wallet mapping is required');
  }

  if (data.walletMapping) {
    for (const [position, walletId] of Object.entries(data.walletMapping)) {
      const pos = parseInt(position);
      const wId = parseInt(walletId.toString());

      if (isNaN(pos) || pos < 1 || pos > 3) {
        errors.push('Wallet position must be between 1 and 3');
      }

      if (isNaN(wId) || wId <= 0) {
        errors.push('Invalid wallet ID in mapping');
      }
    }

    // Check for duplicate wallet mappings
    const walletIds = Object.values(data.walletMapping);
    const uniqueWalletIds = new Set(walletIds);
    if (walletIds.length !== uniqueWalletIds.size) {
      errors.push('Cannot map multiple positions to the same wallet');
    }
  }

  if (data.customizations?.name && data.customizations.name.length > 255) {
    errors.push('Custom name must be less than 255 characters');
  }

  return errors;
}

export default router;