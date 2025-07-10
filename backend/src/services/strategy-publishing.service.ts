import { Pool } from 'pg';
import pool from '../database/pool';
import {
  PublishedStrategy,
  PublishedStrategyWithMetrics,
  StrategyPerformanceHistory,
  PerformanceMetrics,
  ValidationResult,
  PublishStrategyRequest,
  UpdatePublishedStrategyRequest,
  StrategyWalletRequirement
} from '../types/strategy-publishing';
import { Strategy } from '../types/strategy';

export class StrategyPublishingService {
  private db: Pool;

  constructor() {
    this.db = pool;
  }

  /**
   * Calculate performance metrics for a strategy
   */
  async calculatePerformanceMetrics(strategyId: number): Promise<PerformanceMetrics> {
    const query = `
      SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN daily_return_percentage > 0 THEN 1 ELSE 0 END) as successful_trades,
        AVG(daily_return_percentage) as avg_daily_return,
        MIN(daily_return_percentage) as max_drawdown,
        STDDEV(daily_return_percentage) as volatility,
        (
          SELECT 
            ((ending_balance_sol - starting_balance_sol) / starting_balance_sol) * 100
          FROM strategy_performance_history 
          WHERE strategy_id = $1 
          ORDER BY date DESC 
          LIMIT 1
        ) as total_roi
      FROM strategy_performance_history 
      WHERE strategy_id = $1
    `;

    const result = await this.db.query(query, [strategyId]);
    const data = result.rows[0];

    const totalTrades = parseInt(data.total_trades) || 0;
    const successfulTrades = parseInt(data.successful_trades) || 0;
    const winRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;
    
    return {
      totalROI: parseFloat(data.total_roi) || 0,
      avgDailyReturn: parseFloat(data.avg_daily_return) || 0,
      maxDrawdown: Math.abs(parseFloat(data.max_drawdown)) || 0,
      totalTrades,
      winRate,
      volatility: parseFloat(data.volatility) || 0,
      sharpeRatio: this.calculateSharpeRatio(
        parseFloat(data.avg_daily_return) || 0,
        parseFloat(data.volatility) || 0
      ),
      profitFactor: await this.calculateProfitFactor(strategyId)
    };
  }

  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(avgReturn: number, volatility: number): number {
    if (volatility === 0) return 0;
    // Assuming risk-free rate of 0.05% daily (rough estimate)
    const riskFreeRate = 0.0005;
    return (avgReturn - riskFreeRate) / volatility;
  }

  /**
   * Calculate profit factor
   */
  private async calculateProfitFactor(strategyId: number): Promise<number> {
    const query = `
      SELECT 
        SUM(CASE WHEN daily_return_sol > 0 THEN daily_return_sol ELSE 0 END) as gross_profit,
        SUM(CASE WHEN daily_return_sol < 0 THEN ABS(daily_return_sol) ELSE 0 END) as gross_loss
      FROM strategy_performance_history 
      WHERE strategy_id = $1
    `;

    const result = await this.db.query(query, [strategyId]);
    const data = result.rows[0];
    
    const grossProfit = parseFloat(data.gross_profit) || 0;
    const grossLoss = parseFloat(data.gross_loss) || 0;
    
    return grossLoss > 0 ? grossProfit / grossLoss : 0;
  }

  /**
   * Validate strategy for publishing
   */
  async validateForPublishing(strategyId: number): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check if strategy exists and is active
      const strategyQuery = `
        SELECT s.*, tw.main_wallet_pubkey
        FROM strategies s
        JOIN trading_wallets tw ON s.trading_wallet_id = tw.id
        WHERE s.id = $1
      `;
      const strategyResult = await this.db.query(strategyQuery, [strategyId]);
      
      if (strategyResult.rows.length === 0) {
        errors.push('Strategy not found');
        return { isValid: false, errors, warnings };
      }

      const strategy = strategyResult.rows[0];

      // Check if strategy is active
      if (!strategy.is_active) {
        errors.push('Strategy must be active to publish');
      }

      // Check if strategy has sufficient performance history
      const performanceQuery = `
        SELECT COUNT(*) as history_count
        FROM strategy_performance_history
        WHERE strategy_id = $1
      `;
      const performanceResult = await this.db.query(performanceQuery, [strategyId]);
      const historyCount = parseInt(performanceResult.rows[0].history_count);

      if (historyCount < 7) {
        warnings.push('Strategy has less than 7 days of performance history');
      }

      if (historyCount === 0) {
        errors.push('Strategy must have performance history to publish');
      }

      // Check if strategy is already published
      const publishedQuery = `
        SELECT id FROM published_strategies
        WHERE strategy_id = $1 AND is_active = true
      `;
      const publishedResult = await this.db.query(publishedQuery, [strategyId]);
      
      if (publishedResult.rows.length > 0) {
        errors.push('Strategy is already published');
      }

      // Calculate performance metrics for validation
      if (historyCount > 0) {
        const metrics = await this.calculatePerformanceMetrics(strategyId);
        
        if (metrics.totalROI < -50) {
          warnings.push('Strategy has significant negative ROI');
        }
        
        if (metrics.maxDrawdown > 30) {
          warnings.push('Strategy has high maximum drawdown');
        }
        
        if (metrics.totalTrades < 10) {
          warnings.push('Strategy has limited trading history');
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };

    } catch (error) {
      console.error('Error validating strategy for publishing:', error);
      return {
        isValid: false,
        errors: ['Failed to validate strategy'],
        warnings
      };
    }
  }

  /**
   * Publish a strategy
   */
  async publishStrategy(
    strategyId: number,
    publishData: PublishStrategyRequest,
    publisherWallet: string
  ): Promise<PublishedStrategy> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // Validate strategy ownership
      const ownershipQuery = `
        SELECT s.*, tw.main_wallet_pubkey
        FROM strategies s
        JOIN trading_wallets tw ON s.trading_wallet_id = tw.id
        WHERE s.id = $1 AND tw.main_wallet_pubkey = $2
      `;
      const ownershipResult = await client.query(ownershipQuery, [strategyId, publisherWallet]);
      
      if (ownershipResult.rows.length === 0) {
        throw new Error('Strategy not found or not owned by user');
      }

      // Calculate performance metrics
      const metrics = await this.calculatePerformanceMetrics(strategyId);

      // Insert published strategy
      const publishQuery = `
        INSERT INTO published_strategies (
          strategy_id, publisher_wallet, title, description, category, tags,
          required_wallets, min_balance_sol, price_sol, is_free,
          total_roi_percentage, avg_daily_return, max_drawdown, total_trades, win_rate
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `;

      const publishResult = await client.query(publishQuery, [
        strategyId,
        publisherWallet,
        publishData.title,
        publishData.description,
        publishData.category,
        publishData.tags,
        publishData.requiredWallets,
        publishData.minBalanceSol,
        publishData.priceSol || 0,
        publishData.isFree,
        metrics.totalROI,
        metrics.avgDailyReturn,
        metrics.maxDrawdown,
        metrics.totalTrades,
        metrics.winRate
      ]);

      const publishedStrategy = publishResult.rows[0];

      // Insert wallet requirements
      for (const requirement of publishData.walletRequirements) {
        const requirementQuery = `
          INSERT INTO strategy_wallet_requirements (
            published_strategy_id, wallet_position, wallet_role, min_balance_sol,
            description, required_tokens, permissions
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        await client.query(requirementQuery, [
          publishedStrategy.id,
          requirement.position,
          requirement.role,
          requirement.minBalance,
          requirement.description,
          requirement.requiredTokens,
          requirement.permissions
        ]);
      }

      await client.query('COMMIT');
      return publishedStrategy;

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error publishing strategy:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update published strategy
   */
  async updatePublishedStrategy(
    publishedStrategyId: number,
    updateData: UpdatePublishedStrategyRequest,
    publisherWallet: string
  ): Promise<PublishedStrategy> {
    // Validate ownership
    const ownershipQuery = `
      SELECT * FROM published_strategies
      WHERE id = $1 AND publisher_wallet = $2
    `;
    const ownershipResult = await this.db.query(ownershipQuery, [publishedStrategyId, publisherWallet]);
    
    if (ownershipResult.rows.length === 0) {
      throw new Error('Published strategy not found or not owned by user');
    }

    // Build update query dynamically
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updateData.title !== undefined) {
      updateFields.push(`title = $${paramIndex++}`);
      values.push(updateData.title);
    }

    if (updateData.description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      values.push(updateData.description);
    }

    if (updateData.category !== undefined) {
      updateFields.push(`category = $${paramIndex++}`);
      values.push(updateData.category);
    }

    if (updateData.tags !== undefined) {
      updateFields.push(`tags = $${paramIndex++}`);
      values.push(updateData.tags);
    }

    if (updateData.isActive !== undefined) {
      updateFields.push(`is_active = $${paramIndex++}`);
      values.push(updateData.isActive);
    }

    if (updateData.priceSol !== undefined) {
      updateFields.push(`price_sol = $${paramIndex++}`);
      values.push(updateData.priceSol);
    }

    if (updateFields.length === 0) {
      throw new Error('No fields to update');
    }

    values.push(publishedStrategyId);

    const updateQuery = `
      UPDATE published_strategies 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.db.query(updateQuery, values);
    return result.rows[0];
  }

  /**
   * Unpublish strategy
   */
  async unpublishStrategy(publishedStrategyId: number, publisherWallet: string): Promise<void> {
    const query = `
      UPDATE published_strategies 
      SET is_active = false
      WHERE id = $1 AND publisher_wallet = $2
    `;

    const result = await this.db.query(query, [publishedStrategyId, publisherWallet]);
    
    if (result.rowCount === 0) {
      throw new Error('Published strategy not found or not owned by user');
    }
  }

  /**
   * Get published strategy by ID
   */
  async getPublishedStrategy(publishedStrategyId: number): Promise<PublishedStrategy | null> {
    const query = `
      SELECT * FROM published_strategies
      WHERE id = $1
    `;

    const result = await this.db.query(query, [publishedStrategyId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get published strategies by user
   */
  async getPublishedStrategiesByUser(publisherWallet: string): Promise<PublishedStrategy[]> {
    const query = `
      SELECT * FROM published_strategies
      WHERE publisher_wallet = $1
      ORDER BY published_at DESC
    `;

    const result = await this.db.query(query, [publisherWallet]);
    return result.rows;
  }

  /**
   * Get unpublished strategies by user (strategies that haven't been published to marketplace)
   */
  async getUnpublishedStrategiesByUser(publisherWallet: string): Promise<Strategy[]> {
    const query = `
      SELECT s.*, tw.wallet_pubkey, tw.name as trading_wallet_name
      FROM strategies s
      INNER JOIN trading_wallets tw ON s.trading_wallet_id = tw.id
      LEFT JOIN published_strategies ps ON s.id = ps.strategy_id AND ps.is_active = true
      WHERE s.main_wallet_pubkey = $1 
        AND ps.id IS NULL
        AND s.is_active = true
      ORDER BY s.created_at DESC
    `;

    const result = await this.db.query(query, [publisherWallet]);
    return result.rows;
  }

  /**
   * Get wallet requirements for published strategy
   */
  async getWalletRequirements(publishedStrategyId: number): Promise<StrategyWalletRequirement[]> {
    const query = `
      SELECT * FROM strategy_wallet_requirements
      WHERE published_strategy_id = $1
      ORDER BY wallet_position
    `;

    const result = await this.db.query(query, [publishedStrategyId]);
    return result.rows;
  }

  /**
   * Record performance history for a strategy
   */
  async recordPerformanceHistory(
    strategyId: number,
    performanceData: Omit<StrategyPerformanceHistory, 'id' | 'created_at'>
  ): Promise<StrategyPerformanceHistory> {
    const query = `
      INSERT INTO strategy_performance_history (
        strategy_id, date, starting_balance_sol, ending_balance_sol, daily_return_sol,
        daily_return_percentage, starting_balance_usd, ending_balance_usd, daily_return_usd,
        trades_executed, successful_trades, failed_trades, max_drawdown, volatility
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (strategy_id, date) 
      DO UPDATE SET 
        ending_balance_sol = EXCLUDED.ending_balance_sol,
        daily_return_sol = EXCLUDED.daily_return_sol,
        daily_return_percentage = EXCLUDED.daily_return_percentage,
        ending_balance_usd = EXCLUDED.ending_balance_usd,
        daily_return_usd = EXCLUDED.daily_return_usd,
        trades_executed = EXCLUDED.trades_executed,
        successful_trades = EXCLUDED.successful_trades,
        failed_trades = EXCLUDED.failed_trades,
        max_drawdown = EXCLUDED.max_drawdown,
        volatility = EXCLUDED.volatility
      RETURNING *
    `;

    const result = await this.db.query(query, [
      strategyId,
      performanceData.date,
      performanceData.starting_balance_sol,
      performanceData.ending_balance_sol,
      performanceData.daily_return_sol,
      performanceData.daily_return_percentage,
      performanceData.starting_balance_usd,
      performanceData.ending_balance_usd,
      performanceData.daily_return_usd,
      performanceData.trades_executed,
      performanceData.successful_trades,
      performanceData.failed_trades,
      performanceData.max_drawdown,
      performanceData.volatility
    ]);

    return result.rows[0];
  }

  /**
   * Get performance history for a strategy
   */
  async getPerformanceHistory(
    strategyId: number,
    startDate?: string,
    endDate?: string
  ): Promise<StrategyPerformanceHistory[]> {
    let query = `
      SELECT * FROM strategy_performance_history
      WHERE strategy_id = $1
    `;
    const params: any[] = [strategyId];

    if (startDate) {
      query += ` AND date >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND date <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ` ORDER BY date DESC`;

    const result = await this.db.query(query, params);
    return result.rows;
  }

  /**
   * Update published strategy metrics
   */
  async updatePublishedStrategyMetrics(publishedStrategyId: number): Promise<void> {
    const query = `
      UPDATE published_strategies 
      SET 
        downloads = (
          SELECT COUNT(*) FROM strategy_adoptions 
          WHERE published_strategy_id = $1
        ),
        rating = (
          SELECT AVG(rating) FROM strategy_reviews 
          WHERE published_strategy_id = $1 AND is_visible = true
        ),
        review_count = (
          SELECT COUNT(*) FROM strategy_reviews 
          WHERE published_strategy_id = $1 AND is_visible = true
        )
      WHERE id = $1
    `;

    await this.db.query(query, [publishedStrategyId]);
  }
}