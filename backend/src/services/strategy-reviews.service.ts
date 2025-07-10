import { Pool } from 'pg';
import pool from '../database/pool';
import {
  StrategyReview,
  SubmitReviewRequest,
  GetReviewsResponse,
  PaginationRequest
} from '../types/strategy-publishing';

export class StrategyReviewsService {
  private db: Pool;

  constructor() {
    this.db = pool;
  }

  /**
   * Submit a review for a published strategy
   */
  async submitReview(
    publishedStrategyId: number,
    reviewData: SubmitReviewRequest,
    reviewerWallet: string
  ): Promise<StrategyReview> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // Check if user has adopted the strategy
      const adoptionQuery = `
        SELECT id FROM strategy_adoptions
        WHERE published_strategy_id = $1 AND adopter_wallet = $2 AND is_active = true
      `;

      const adoptionResult = await client.query(adoptionQuery, [publishedStrategyId, reviewerWallet]);
      
      if (adoptionResult.rows.length === 0) {
        throw new Error('You must adopt a strategy before reviewing it');
      }

      const adoptionId = adoptionResult.rows[0].id;

      // Check if user has already reviewed this strategy
      const existingReviewQuery = `
        SELECT id FROM strategy_reviews
        WHERE published_strategy_id = $1 AND reviewer_wallet = $2
      `;

      const existingReviewResult = await client.query(existingReviewQuery, [publishedStrategyId, reviewerWallet]);
      
      if (existingReviewResult.rows.length > 0) {
        throw new Error('You have already reviewed this strategy');
      }

      // Validate published strategy exists
      const strategyQuery = `
        SELECT id FROM published_strategies
        WHERE id = $1 AND is_active = true
      `;

      const strategyResult = await client.query(strategyQuery, [publishedStrategyId]);
      
      if (strategyResult.rows.length === 0) {
        throw new Error('Published strategy not found or inactive');
      }

      // Insert review
      const insertQuery = `
        INSERT INTO strategy_reviews (
          published_strategy_id, reviewer_wallet, adoption_id, rating, review_text,
          used_duration_days, actual_roi_percentage, recommendation_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;

      const reviewResult = await client.query(insertQuery, [
        publishedStrategyId,
        reviewerWallet,
        adoptionId,
        reviewData.rating,
        reviewData.reviewText,
        reviewData.usedDurationDays,
        reviewData.actualROI,
        reviewData.recommendationLevel
      ]);

      const review = reviewResult.rows[0];

      // Update aggregate ratings for the published strategy
      await this.updateAggregateRatings(publishedStrategyId, client);

      await client.query('COMMIT');
      return review;

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error submitting review:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get reviews for a published strategy
   */
  async getReviews(
    publishedStrategyId: number,
    pagination: PaginationRequest = {}
  ): Promise<GetReviewsResponse> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = pagination;

    const offset = (page - 1) * limit;

    // Validate sort options
    const validSortColumns = ['created_at', 'rating', 'actual_roi_percentage', 'recommendation_level'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Get reviews with pagination
    const reviewsQuery = `
      SELECT 
        sr.*,
        SUBSTRING(sr.reviewer_wallet, 1, 8) || '...' || SUBSTRING(sr.reviewer_wallet, -4) as reviewer_display
      FROM strategy_reviews sr
      WHERE sr.published_strategy_id = $1 AND sr.is_visible = true
      ORDER BY ${sortColumn} ${order}
      LIMIT $2 OFFSET $3
    `;

    // Count total reviews
    const countQuery = `
      SELECT COUNT(*) as total
      FROM strategy_reviews
      WHERE published_strategy_id = $1 AND is_visible = true
    `;

    // Get review summary
    const summaryQuery = `
      SELECT 
        AVG(rating) as average_rating,
        COUNT(*) as total_reviews,
        rating,
        COUNT(*) as count
      FROM strategy_reviews
      WHERE published_strategy_id = $1 AND is_visible = true
      GROUP BY rating
      ORDER BY rating DESC
    `;

    const [reviewsResult, countResult, summaryResult] = await Promise.all([
      this.db.query(reviewsQuery, [publishedStrategyId, limit, offset]),
      this.db.query(countQuery, [publishedStrategyId]),
      this.db.query(summaryQuery, [publishedStrategyId])
    ]);

    const reviews = reviewsResult.rows;
    const totalItems = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalItems / limit);

    // Calculate rating distribution
    const ratingDistribution: { [key: number]: number } = {};
    let totalReviews = 0;
    let weightedSum = 0;

    // Initialize all ratings to 0
    for (let i = 1; i <= 5; i++) {
      ratingDistribution[i] = 0;
    }

    summaryResult.rows.forEach(row => {
      if (row.rating) {
        const rating = parseInt(row.rating);
        const count = parseInt(row.count);
        ratingDistribution[rating] = count;
        totalReviews += count;
        weightedSum += rating * count;
      }
    });

    const averageRating = totalReviews > 0 ? weightedSum / totalReviews : 0;

    return {
      reviews,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      summary: {
        averageRating,
        totalReviews,
        ratingDistribution
      }
    };
  }

  /**
   * Update a review
   */
  async updateReview(
    reviewId: number,
    updateData: Partial<SubmitReviewRequest>,
    reviewerWallet: string
  ): Promise<StrategyReview> {
    // Validate ownership
    const ownershipQuery = `
      SELECT * FROM strategy_reviews
      WHERE id = $1 AND reviewer_wallet = $2
    `;

    const ownershipResult = await this.db.query(ownershipQuery, [reviewId, reviewerWallet]);
    
    if (ownershipResult.rows.length === 0) {
      throw new Error('Review not found or not owned by user');
    }

    const currentReview = ownershipResult.rows[0];

    // Build update query dynamically
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updateData.rating !== undefined) {
      updateFields.push(`rating = $${paramIndex++}`);
      values.push(updateData.rating);
    }

    if (updateData.reviewText !== undefined) {
      updateFields.push(`review_text = $${paramIndex++}`);
      values.push(updateData.reviewText);
    }

    if (updateData.usedDurationDays !== undefined) {
      updateFields.push(`used_duration_days = $${paramIndex++}`);
      values.push(updateData.usedDurationDays);
    }

    if (updateData.actualROI !== undefined) {
      updateFields.push(`actual_roi_percentage = $${paramIndex++}`);
      values.push(updateData.actualROI);
    }

    if (updateData.recommendationLevel !== undefined) {
      updateFields.push(`recommendation_level = $${paramIndex++}`);
      values.push(updateData.recommendationLevel);
    }

    if (updateFields.length === 0) {
      throw new Error('No fields to update');
    }

    values.push(reviewId);

    const updateQuery = `
      UPDATE strategy_reviews 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.db.query(updateQuery, values);
    const updatedReview = result.rows[0];

    // Update aggregate ratings if rating changed
    if (updateData.rating !== undefined && updateData.rating !== currentReview.rating) {
      await this.updateAggregateRatings(currentReview.published_strategy_id);
    }

    return updatedReview;
  }

  /**
   * Delete a review
   */
  async deleteReview(reviewId: number, reviewerWallet: string): Promise<void> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // Get review details for aggregate update
      const reviewQuery = `
        SELECT published_strategy_id FROM strategy_reviews
        WHERE id = $1 AND reviewer_wallet = $2
      `;

      const reviewResult = await client.query(reviewQuery, [reviewId, reviewerWallet]);
      
      if (reviewResult.rows.length === 0) {
        throw new Error('Review not found or not owned by user');
      }

      const publishedStrategyId = reviewResult.rows[0].published_strategy_id;

      // Delete review
      await client.query('DELETE FROM strategy_reviews WHERE id = $1', [reviewId]);

      // Update aggregate ratings
      await this.updateAggregateRatings(publishedStrategyId, client);

      await client.query('COMMIT');

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting review:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get reviews by user
   */
  async getReviewsByUser(reviewerWallet: string): Promise<StrategyReview[]> {
    const query = `
      SELECT 
        sr.*,
        ps.title as strategy_title,
        ps.publisher_wallet
      FROM strategy_reviews sr
      JOIN published_strategies ps ON sr.published_strategy_id = ps.id
      WHERE sr.reviewer_wallet = $1
      ORDER BY sr.created_at DESC
    `;

    const result = await this.db.query(query, [reviewerWallet]);
    return result.rows;
  }

  /**
   * Check if user can review a strategy
   */
  async canUserReview(publishedStrategyId: number, reviewerWallet: string): Promise<{
    canReview: boolean;
    reason?: string;
  }> {
    // Check if user has adopted the strategy
    const adoptionQuery = `
      SELECT id FROM strategy_adoptions
      WHERE published_strategy_id = $1 AND adopter_wallet = $2 AND is_active = true
    `;

    const adoptionResult = await this.db.query(adoptionQuery, [publishedStrategyId, reviewerWallet]);
    
    if (adoptionResult.rows.length === 0) {
      return {
        canReview: false,
        reason: 'You must adopt the strategy before reviewing it'
      };
    }

    // Check if user has already reviewed
    const existingReviewQuery = `
      SELECT id FROM strategy_reviews
      WHERE published_strategy_id = $1 AND reviewer_wallet = $2
    `;

    const existingReviewResult = await this.db.query(existingReviewQuery, [publishedStrategyId, reviewerWallet]);
    
    if (existingReviewResult.rows.length > 0) {
      return {
        canReview: false,
        reason: 'You have already reviewed this strategy'
      };
    }

    // Check if strategy is still active
    const strategyQuery = `
      SELECT is_active FROM published_strategies
      WHERE id = $1
    `;

    const strategyResult = await this.db.query(strategyQuery, [publishedStrategyId]);
    
    if (strategyResult.rows.length === 0 || !strategyResult.rows[0].is_active) {
      return {
        canReview: false,
        reason: 'Strategy is not available for review'
      };
    }

    return { canReview: true };
  }

  /**
   * Get review statistics for a user
   */
  async getUserReviewStats(reviewerWallet: string) {
    const query = `
      SELECT 
        COUNT(*) as total_reviews,
        AVG(rating) as average_rating_given,
        COUNT(CASE WHEN rating >= 4 THEN 1 END) as positive_reviews,
        COUNT(CASE WHEN rating <= 2 THEN 1 END) as negative_reviews,
        MAX(created_at) as last_review_date
      FROM strategy_reviews
      WHERE reviewer_wallet = $1 AND is_visible = true
    `;

    const result = await this.db.query(query, [reviewerWallet]);
    return result.rows[0];
  }

  /**
   * Update aggregate ratings for a published strategy
   */
  private async updateAggregateRatings(publishedStrategyId: number, client?: any): Promise<void> {
    const db = client || this.db;

    const query = `
      UPDATE published_strategies 
      SET 
        rating = COALESCE((
          SELECT AVG(rating) FROM strategy_reviews 
          WHERE published_strategy_id = $1 AND is_visible = true
        ), 0),
        review_count = (
          SELECT COUNT(*) FROM strategy_reviews 
          WHERE published_strategy_id = $1 AND is_visible = true
        )
      WHERE id = $1
    `;

    await db.query(query, [publishedStrategyId]);
  }

  /**
   * Get top reviewers (most helpful reviews)
   */
  async getTopReviewers(limit: number = 10) {
    const query = `
      SELECT 
        reviewer_wallet,
        SUBSTRING(reviewer_wallet, 1, 8) || '...' || SUBSTRING(reviewer_wallet, -4) as reviewer_display,
        COUNT(*) as total_reviews,
        AVG(rating) as average_rating,
        AVG(CASE WHEN actual_roi_percentage IS NOT NULL THEN actual_roi_percentage END) as avg_actual_roi
      FROM strategy_reviews
      WHERE is_visible = true
      GROUP BY reviewer_wallet
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC, AVG(rating) DESC
      LIMIT $1
    `;

    const result = await this.db.query(query, [limit]);
    return result.rows;
  }

  /**
   * Flag a review for moderation
   */
  async flagReview(reviewId: number, reason: string, flaggerWallet: string): Promise<void> {
    // This would create a moderation record - simplified for now
    const query = `
      INSERT INTO review_flags (review_id, flagger_wallet, reason, created_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (review_id, flagger_wallet) DO NOTHING
    `;

    // Note: You would need to create the review_flags table in the migration
    // await this.db.query(query, [reviewId, flaggerWallet, reason]);
    
    // For now, just log the flag
    console.log(`Review ${reviewId} flagged by ${flaggerWallet} for: ${reason}`);
  }

  /**
   * Get review insights for a published strategy
   */
  async getReviewInsights(publishedStrategyId: number) {
    const query = `
      SELECT 
        COUNT(*) as total_reviews,
        AVG(rating) as average_rating,
        AVG(CASE WHEN actual_roi_percentage IS NOT NULL THEN actual_roi_percentage END) as avg_actual_roi,
        AVG(used_duration_days) as avg_usage_duration,
        AVG(recommendation_level) as avg_recommendation,
        COUNT(CASE WHEN rating >= 4 THEN 1 END) as positive_reviews,
        COUNT(CASE WHEN rating <= 2 THEN 1 END) as negative_reviews,
        COUNT(CASE WHEN actual_roi_percentage > 0 THEN 1 END) as profitable_adoptions,
        COUNT(CASE WHEN actual_roi_percentage IS NOT NULL THEN 1 END) as adoptions_with_roi_data
      FROM strategy_reviews
      WHERE published_strategy_id = $1 AND is_visible = true
    `;

    const result = await this.db.query(query, [publishedStrategyId]);
    return result.rows[0];
  }
}