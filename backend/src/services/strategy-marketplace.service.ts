import { Pool } from 'pg';
import pool from '../database/pool';
import {
  BrowseStrategiesRequest,
  BrowseStrategiesResponse,
  StrategyDetailsResponse,
  AdoptStrategyRequest,
  AdoptStrategyResponse,
  PublishedStrategyWithMetrics,
  StrategyAdoption,
  WalletMapping
} from '../types/strategy-publishing';

export class StrategyMarketplaceService {
  public db: Pool; // Made public for route access

  constructor() {
    this.db = pool;
  }

  /**
   * Browse strategies with filtering and pagination
   */
  async browseStrategies(filters: BrowseStrategiesRequest): Promise<BrowseStrategiesResponse> {
    const {
      category,
      tags,
      minRating = 0,
      maxRequiredWallets = 3,
      sortBy = 'rating',
      sortOrder = 'desc',
      page = 1,
      limit = 20
    } = filters;

    // Build WHERE clause
    const whereConditions: string[] = ['ps.is_active = true'];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (category) {
      whereConditions.push(`ps.category = $${paramIndex++}`);
      queryParams.push(category);
    }

    if (tags && tags.length > 0) {
      whereConditions.push(`ps.tags && $${paramIndex++}`);
      queryParams.push(tags);
    }

    if (minRating > 0) {
      whereConditions.push(`ps.rating >= $${paramIndex++}`);
      queryParams.push(minRating);
    }

    whereConditions.push(`ps.required_wallets <= $${paramIndex++}`);
    queryParams.push(maxRequiredWallets);

    const whereClause = whereConditions.join(' AND ');

    // Build ORDER BY clause
    let orderByClause = '';
    switch (sortBy) {
      case 'rating':
        orderByClause = `ps.rating ${sortOrder.toUpperCase()}`;
        break;
      case 'downloads':
        orderByClause = `ps.downloads ${sortOrder.toUpperCase()}`;
        break;
      case 'roi':
        orderByClause = `ps.total_roi_percentage ${sortOrder.toUpperCase()}`;
        break;
      case 'recent':
        orderByClause = `ps.published_at ${sortOrder.toUpperCase()}`;
        break;
      default:
        orderByClause = `ps.rating DESC`;
    }

    // Calculate offset
    const offset = (page - 1) * limit;

    // Main query
    const mainQuery = `
      SELECT 
        ps.*,
        s.strategy_type,
        s.config,
        ps.publisher_wallet as publisher_name,
        COUNT(DISTINCT sa.id) as total_adoptions,
        COALESCE(AVG(sr.rating), 0) as avg_rating,
        COUNT(DISTINCT sr.id) as total_reviews
      FROM published_strategies ps
      LEFT JOIN strategies s ON ps.strategy_id = s.id
      LEFT JOIN strategy_adoptions sa ON ps.id = sa.published_strategy_id
      LEFT JOIN strategy_reviews sr ON ps.id = sr.published_strategy_id AND sr.is_visible = true
      WHERE ${whereClause}
      GROUP BY ps.id, s.strategy_type, s.config, ps.publisher_wallet
      ORDER BY ${orderByClause}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    queryParams.push(limit, offset);

    // Count query for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT ps.id) as total
      FROM published_strategies ps
      WHERE ${whereClause}
    `;

    const [strategiesResult, countResult] = await Promise.all([
      this.db.query(mainQuery, queryParams),
      this.db.query(countQuery, queryParams.slice(0, -2)) // Remove limit and offset
    ]);

    const strategies: PublishedStrategyWithMetrics[] = strategiesResult.rows;
    const totalItems = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalItems / limit);

    // Get filter metadata
    const filtersData = await this.getFilterMetadata();

    return {
      strategies,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      filters: filtersData
    };
  }

  /**
   * Get filter metadata for the marketplace
   */
  private async getFilterMetadata() {
    const queries = [
      // Categories
      `SELECT DISTINCT category FROM published_strategies WHERE category IS NOT NULL AND is_active = true`,
      // Tags (flattened)
      `SELECT DISTINCT unnest(tags) as tag FROM published_strategies WHERE tags IS NOT NULL AND is_active = true`,
      // Rating range
      `SELECT MIN(rating) as min_rating, MAX(rating) as max_rating FROM published_strategies WHERE is_active = true`,
      // ROI range
      `SELECT MIN(total_roi_percentage) as min_roi, MAX(total_roi_percentage) as max_roi FROM published_strategies WHERE is_active = true`
    ];

    const [categoriesResult, tagsResult, ratingResult, roiResult] = await Promise.all(
      queries.map(query => this.db.query(query))
    );

    return {
      categories: categoriesResult.rows.map(row => row.category).filter(Boolean),
      tags: tagsResult.rows.map(row => row.tag).filter(Boolean),
      ratingRange: [
        ratingResult.rows[0]?.min_rating || 0,
        ratingResult.rows[0]?.max_rating || 5
      ] as [number, number],
      roiRange: [
        roiResult.rows[0]?.min_roi || -100,
        roiResult.rows[0]?.max_roi || 100
      ] as [number, number]
    };
  }

  /**
   * Get detailed strategy information
   */
  async getStrategyDetails(publishedStrategyId: number): Promise<StrategyDetailsResponse> {
    // Get strategy basic info
    const strategyQuery = `
      SELECT 
        ps.*,
        s.strategy_type,
        s.config,
        ps.publisher_wallet as publisher_name,
        COUNT(DISTINCT sa.id) as total_adoptions,
        COALESCE(AVG(sr.rating), 0) as avg_rating,
        COUNT(DISTINCT sr.id) as total_reviews
      FROM published_strategies ps
      LEFT JOIN strategies s ON ps.strategy_id = s.id
      LEFT JOIN strategy_adoptions sa ON ps.id = sa.published_strategy_id
      LEFT JOIN strategy_reviews sr ON ps.id = sr.published_strategy_id AND sr.is_visible = true
      WHERE ps.id = $1 AND ps.is_active = true
      GROUP BY ps.id, s.strategy_type, s.config, ps.publisher_wallet
    `;

    const strategyResult = await this.db.query(strategyQuery, [publishedStrategyId]);
    
    if (strategyResult.rows.length === 0) {
      throw new Error('Strategy not found');
    }

    const strategy: PublishedStrategyWithMetrics = strategyResult.rows[0];

    // Get performance chart data
    const performanceQuery = `
      SELECT 
        date,
        daily_return_percentage as roi,
        ending_balance_sol as balance
      FROM strategy_performance_history
      WHERE strategy_id = $1
      ORDER BY date DESC
      LIMIT 30
    `;

    const performanceResult = await this.db.query(performanceQuery, [strategy.strategy_id]);

    // Get wallet requirements
    const requirementsQuery = `
      SELECT * FROM strategy_wallet_requirements
      WHERE published_strategy_id = $1
      ORDER BY wallet_position
    `;

    const requirementsResult = await this.db.query(requirementsQuery, [publishedStrategyId]);

    // Get review summary and recent reviews
    const reviewSummaryQuery = `
      SELECT 
        rating,
        COUNT(*) as count
      FROM strategy_reviews
      WHERE published_strategy_id = $1 AND is_visible = true
      GROUP BY rating
      ORDER BY rating DESC
    `;

    const recentReviewsQuery = `
      SELECT sr.*, u.main_wallet_pubkey as reviewer_name
      FROM strategy_reviews sr
      LEFT JOIN users u ON sr.reviewer_wallet = u.main_wallet_pubkey
      WHERE sr.published_strategy_id = $1 AND sr.is_visible = true
      ORDER BY sr.created_at DESC
      LIMIT 5
    `;

    const [reviewSummaryResult, recentReviewsResult] = await Promise.all([
      this.db.query(reviewSummaryQuery, [publishedStrategyId]),
      this.db.query(recentReviewsQuery, [publishedStrategyId])
    ]);

    // Calculate rating distribution
    const ratingDistribution: { [key: number]: number } = {};
    let totalReviews = 0;
    let weightedSum = 0;

    for (let i = 1; i <= 5; i++) {
      ratingDistribution[i] = 0;
    }

    reviewSummaryResult.rows.forEach(row => {
      const rating = parseInt(row.rating);
      const count = parseInt(row.count);
      ratingDistribution[rating] = count;
      totalReviews += count;
      weightedSum += rating * count;
    });

    const averageRating = totalReviews > 0 ? weightedSum / totalReviews : 0;

    // Get publisher info
    const publisherQuery = `
      SELECT 
        ps.publisher_wallet,
        COUNT(DISTINCT ps.id) as published_strategies,
        SUM(ps.downloads) as total_downloads,
        AVG(ps.rating) as average_rating
      FROM published_strategies ps
      WHERE ps.publisher_wallet = $1 AND ps.is_active = true
      GROUP BY ps.publisher_wallet
    `;

    const publisherResult = await this.db.query(publisherQuery, [strategy.publisher_wallet]);
    const publisherInfo = publisherResult.rows[0] || {
      publisher_wallet: strategy.publisher_wallet,
      published_strategies: 0,
      total_downloads: 0,
      average_rating: 0
    };

    return {
      strategy,
      performance: {
        totalROI: strategy.total_roi_percentage || 0,
        avgDailyReturn: strategy.avg_daily_return || 0,
        maxDrawdown: strategy.max_drawdown || 0,
        totalTrades: strategy.total_trades || 0,
        winRate: strategy.win_rate || 0,
        performanceChart: performanceResult.rows.map(row => ({
          date: row.date,
          roi: parseFloat(row.roi) || 0,
          balance: parseFloat(row.balance) || 0
        }))
      },
      walletRequirements: requirementsResult.rows,
      reviews: {
        summary: {
          averageRating,
          totalReviews,
          ratingDistribution
        },
        recent: recentReviewsResult.rows
      },
      publisher: {
        wallet: publisherInfo.publisher_wallet,
        publishedStrategies: parseInt(publisherInfo.published_strategies) || 0,
        totalDownloads: parseInt(publisherInfo.total_downloads) || 0,
        averageRating: parseFloat(publisherInfo.average_rating) || 0
      }
    };
  }

  /**
   * Adopt a strategy
   */
  async adoptStrategy(
    publishedStrategyId: number,
    adoptionData: AdoptStrategyRequest,
    adopterWallet: string
  ): Promise<AdoptStrategyResponse> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // Get published strategy details
      const strategyQuery = `
        SELECT ps.*, s.config, s.strategy_type
        FROM published_strategies ps
        JOIN strategies s ON ps.strategy_id = s.id
        WHERE ps.id = $1 AND ps.is_active = true
      `;

      const strategyResult = await client.query(strategyQuery, [publishedStrategyId]);
      
      if (strategyResult.rows.length === 0) {
        throw new Error('Published strategy not found or inactive');
      }

      const publishedStrategy = strategyResult.rows[0];

      // Validate wallet mapping
      const validationError = await this.validateWalletMapping(
        publishedStrategyId,
        adoptionData.walletMapping,
        adopterWallet,
        client
      );

      if (validationError) {
        throw new Error(validationError);
      }

      // Create strategy instances for each mapped wallet
      const createdStrategies = [];

      for (const [originalPosition, userWalletId] of Object.entries(adoptionData.walletMapping)) {
        // Get wallet info
        const walletQuery = `
          SELECT * FROM trading_wallets
          WHERE id = $1 AND main_wallet_pubkey = $2
        `;

        const walletResult = await client.query(walletQuery, [userWalletId, adopterWallet]);
        
        if (walletResult.rows.length === 0) {
          throw new Error(`Trading wallet ${userWalletId} not found or not owned by user`);
        }

        const wallet = walletResult.rows[0];

        // Prepare strategy config (merge original with customizations)
        let finalConfig = publishedStrategy.config;
        if (adoptionData.customizations?.config) {
          finalConfig = { ...finalConfig, ...adoptionData.customizations.config };
        }

        // Create new strategy instance
        const createStrategyQuery = `
          INSERT INTO strategies (
            trading_wallet_id, main_wallet_pubkey, strategy_type, config, is_active, name
          ) VALUES ($1, $2, $3, $4, false, $5)
          RETURNING *
        `;

        const strategyName = adoptionData.customizations?.name || 
          `${publishedStrategy.title} (Adopted)`;

        const newStrategyResult = await client.query(createStrategyQuery, [
          userWalletId,
          adopterWallet,
          publishedStrategy.strategy_type,
          finalConfig,
          strategyName
        ]);

        const newStrategy = newStrategyResult.rows[0];

        createdStrategies.push({
          strategyId: newStrategy.id,
          walletId: userWalletId,
          walletName: wallet.name || `Wallet ${userWalletId}`
        });
      }

      // Record the adoption
      const adoptionQuery = `
        INSERT INTO strategy_adoptions (
          published_strategy_id, adopter_wallet, adopted_strategy_id, 
          wallet_mapping, custom_config, is_modified
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;

      // Use the first created strategy as the primary adopted strategy
      const primaryStrategyId = createdStrategies[0]?.strategyId;

      const adoptionResult = await client.query(adoptionQuery, [
        publishedStrategyId,
        adopterWallet,
        primaryStrategyId,
        JSON.stringify(adoptionData.walletMapping),
        adoptionData.customizations?.config ? JSON.stringify(adoptionData.customizations.config) : null,
        !!adoptionData.customizations?.config
      ]);

      const adoption = adoptionResult.rows[0];

      // Update download count
      await client.query(
        'UPDATE published_strategies SET downloads = downloads + 1 WHERE id = $1',
        [publishedStrategyId]
      );

      await client.query('COMMIT');

      return {
        adoptionId: adoption.id,
        createdStrategies,
        message: `Successfully adopted strategy with ${createdStrategies.length} trading wallet(s)`
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error adopting strategy:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Validate wallet mapping for adoption
   */
  private async validateWalletMapping(
    publishedStrategyId: number,
    walletMapping: WalletMapping,
    adopterWallet: string,
    client: any
  ): Promise<string | null> {
    // Get wallet requirements
    const requirementsQuery = `
      SELECT * FROM strategy_wallet_requirements
      WHERE published_strategy_id = $1
      ORDER BY wallet_position
    `;

    const requirementsResult = await client.query(requirementsQuery, [publishedStrategyId]);
    const requirements = requirementsResult.rows;

    // Check if all required positions are mapped
    for (const requirement of requirements) {
      const position = requirement.wallet_position;
      const mappedWalletId = walletMapping[position];

      if (!mappedWalletId) {
        return `Wallet position ${position} is required but not mapped`;
      }

      // Validate user owns the wallet
      const walletQuery = `
        SELECT * FROM trading_wallets
        WHERE id = $1 AND main_wallet_pubkey = $2
      `;

      const walletResult = await client.query(walletQuery, [mappedWalletId, adopterWallet]);
      
      if (walletResult.rows.length === 0) {
        return `Trading wallet ${mappedWalletId} not found or not owned by user`;
      }

      // TODO: Validate minimum balance requirements
      // TODO: Validate required tokens
      // TODO: Validate permissions
    }

    // Check for duplicate mappings
    const mappedWallets = Object.values(walletMapping);
    const uniqueWallets = new Set(mappedWallets);
    
    if (mappedWallets.length !== uniqueWallets.size) {
      return 'Cannot map multiple positions to the same wallet';
    }

    return null; // No validation errors
  }

  /**
   * Get user's adopted strategies
   */
  async getUserAdoptedStrategies(adopterWallet: string): Promise<StrategyAdoption[]> {
    const query = `
      SELECT 
        sa.*,
        ps.title as strategy_title,
        ps.publisher_wallet
      FROM strategy_adoptions sa
      JOIN published_strategies ps ON sa.published_strategy_id = ps.id
      WHERE sa.adopter_wallet = $1
      ORDER BY sa.adopted_at DESC
    `;

    const result = await this.db.query(query, [adopterWallet]);
    return result.rows;
  }

  /**
   * Check if user has already adopted a strategy
   */
  async hasUserAdoptedStrategy(publishedStrategyId: number, adopterWallet: string): Promise<boolean> {
    const query = `
      SELECT id FROM strategy_adoptions
      WHERE published_strategy_id = $1 AND adopter_wallet = $2 AND is_active = true
    `;

    const result = await this.db.query(query, [publishedStrategyId, adopterWallet]);
    return result.rows.length > 0;
  }

  /**
   * Get adoption statistics for a published strategy
   */
  async getAdoptionStats(publishedStrategyId: number) {
    const query = `
      SELECT 
        COUNT(*) as total_adoptions,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_adoptions,
        COUNT(CASE WHEN is_modified = true THEN 1 END) as modified_adoptions,
        MAX(adopted_at) as last_adopted_at
      FROM strategy_adoptions
      WHERE published_strategy_id = $1
    `;

    const result = await this.db.query(query, [publishedStrategyId]);
    return result.rows[0];
  }

  /**
   * Search strategies by text
   */
  async searchStrategies(searchTerm: string, limit: number = 20): Promise<PublishedStrategyWithMetrics[]> {
    const query = `
      SELECT 
        ps.*,
        s.strategy_type,
        s.config,
        ps.publisher_wallet as publisher_name,
        COUNT(DISTINCT sa.id) as total_adoptions,
        COALESCE(AVG(sr.rating), 0) as avg_rating,
        COUNT(DISTINCT sr.id) as total_reviews,
        ts_rank(
          to_tsvector('english', ps.title || ' ' || COALESCE(ps.description, '') || ' ' || array_to_string(ps.tags, ' ')),
          plainto_tsquery('english', $1)
        ) as relevance
      FROM published_strategies ps
      LEFT JOIN strategies s ON ps.strategy_id = s.id
      LEFT JOIN strategy_adoptions sa ON ps.id = sa.published_strategy_id
      LEFT JOIN strategy_reviews sr ON ps.id = sr.published_strategy_id AND sr.is_visible = true
      WHERE ps.is_active = true
      AND (
        ps.title ILIKE $2 OR
        ps.description ILIKE $2 OR
        ps.category ILIKE $2 OR
        ps.tags::text ILIKE $2 OR
        to_tsvector('english', ps.title || ' ' || COALESCE(ps.description, '') || ' ' || array_to_string(ps.tags, ' ')) 
        @@ plainto_tsquery('english', $1)
      )
      GROUP BY ps.id, s.strategy_type, s.config, ps.publisher_wallet
      ORDER BY relevance DESC, ps.rating DESC
      LIMIT $3
    `;

    const searchPattern = `%${searchTerm}%`;
    const result = await this.db.query(query, [searchTerm, searchPattern, limit]);
    return result.rows;
  }
}