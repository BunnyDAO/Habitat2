import { Router, Request, Response } from 'express';
import { StrategyReviewsService } from '../services/strategy-reviews.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { SubmitReviewRequest } from '../types/strategy-publishing';

const router = Router();
const reviewsService = new StrategyReviewsService();

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @route POST /api/shop/strategies/:id/reviews
 * @desc Submit a review for a published strategy
 * @access Private
 */
router.post('/strategies/:id/reviews', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);
    const reviewData: SubmitReviewRequest = req.body;
    const reviewerWallet = req.user?.main_wallet_pubkey;

    if (!reviewerWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (isNaN(publishedStrategyId)) {
      return res.status(400).json({ error: 'Invalid strategy ID' });
    }

    // Validate review data
    const validationErrors = validateReviewRequest(reviewData);
    if (validationErrors.length > 0) {
      return res.status(400).json({ errors: validationErrors });
    }

    // Check if user can review
    const canReviewResult = await reviewsService.canUserReview(publishedStrategyId, reviewerWallet);
    if (!canReviewResult.canReview) {
      return res.status(400).json({ error: canReviewResult.reason });
    }

    const review = await reviewsService.submitReview(
      publishedStrategyId,
      reviewData,
      reviewerWallet
    );

    res.status(201).json(review);

  } catch (error) {
    console.error('Error submitting review:', error);
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to submit review' });
    }
  }
});

/**
 * @route GET /api/shop/strategies/:id/reviews
 * @desc Get reviews for a published strategy
 * @access Private
 */
router.get('/strategies/:id/reviews', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);

    if (isNaN(publishedStrategyId)) {
      return res.status(400).json({ error: 'Invalid strategy ID' });
    }

    const pagination = {
      page: req.query.page ? parseInt(req.query.page as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      sortBy: req.query.sortBy as string,
      sortOrder: req.query.sortOrder as 'asc' | 'desc'
    };

    const result = await reviewsService.getReviews(publishedStrategyId, pagination);
    res.json(result);

  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

/**
 * @route PUT /api/shop/reviews/:id
 * @desc Update a review
 * @access Private
 */
router.put('/reviews/:id', async (req: Request, res: Response) => {
  try {
    const reviewId = parseInt(req.params.id);
    const updateData: Partial<SubmitReviewRequest> = req.body;
    const reviewerWallet = req.user?.main_wallet_pubkey;

    if (!reviewerWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (isNaN(reviewId)) {
      return res.status(400).json({ error: 'Invalid review ID' });
    }

    // Validate update data
    const validationErrors = validatePartialReviewRequest(updateData);
    if (validationErrors.length > 0) {
      return res.status(400).json({ errors: validationErrors });
    }

    const updatedReview = await reviewsService.updateReview(
      reviewId,
      updateData,
      reviewerWallet
    );

    res.json(updatedReview);

  } catch (error) {
    console.error('Error updating review:', error);
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to update review' });
    }
  }
});

/**
 * @route DELETE /api/shop/reviews/:id
 * @desc Delete a review
 * @access Private
 */
router.delete('/reviews/:id', async (req: Request, res: Response) => {
  try {
    const reviewId = parseInt(req.params.id);
    const reviewerWallet = req.user?.main_wallet_pubkey;

    if (!reviewerWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (isNaN(reviewId)) {
      return res.status(400).json({ error: 'Invalid review ID' });
    }

    await reviewsService.deleteReview(reviewId, reviewerWallet);
    res.json({ message: 'Review deleted successfully' });

  } catch (error) {
    console.error('Error deleting review:', error);
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to delete review' });
    }
  }
});

/**
 * @route GET /api/shop/my-reviews
 * @desc Get user's reviews
 * @access Private
 */
router.get('/my-reviews', async (req: Request, res: Response) => {
  try {
    const reviewerWallet = req.user?.main_wallet_pubkey;

    if (!reviewerWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const reviews = await reviewsService.getReviewsByUser(reviewerWallet);
    res.json(reviews);

  } catch (error) {
    console.error('Error fetching user reviews:', error);
    res.status(500).json({ error: 'Failed to fetch user reviews' });
  }
});

/**
 * @route GET /api/shop/strategies/:id/can-review
 * @desc Check if user can review a strategy
 * @access Private
 */
router.get('/strategies/:id/can-review', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);
    const reviewerWallet = req.user?.main_wallet_pubkey;

    if (!reviewerWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (isNaN(publishedStrategyId)) {
      return res.status(400).json({ error: 'Invalid strategy ID' });
    }

    const result = await reviewsService.canUserReview(publishedStrategyId, reviewerWallet);
    res.json(result);

  } catch (error) {
    console.error('Error checking review eligibility:', error);
    res.status(500).json({ error: 'Failed to check review eligibility' });
  }
});

/**
 * @route GET /api/shop/my-review-stats
 * @desc Get user's review statistics
 * @access Private
 */
router.get('/my-review-stats', async (req: Request, res: Response) => {
  try {
    const reviewerWallet = req.user?.main_wallet_pubkey;

    if (!reviewerWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const stats = await reviewsService.getUserReviewStats(reviewerWallet);
    res.json(stats);

  } catch (error) {
    console.error('Error fetching user review stats:', error);
    res.status(500).json({ error: 'Failed to fetch user review stats' });
  }
});

/**
 * @route GET /api/shop/strategies/:id/review-insights
 * @desc Get review insights for a strategy
 * @access Private
 */
router.get('/strategies/:id/review-insights', async (req: Request, res: Response) => {
  try {
    const publishedStrategyId = parseInt(req.params.id);

    if (isNaN(publishedStrategyId)) {
      return res.status(400).json({ error: 'Invalid strategy ID' });
    }

    const insights = await reviewsService.getReviewInsights(publishedStrategyId);
    res.json(insights);

  } catch (error) {
    console.error('Error fetching review insights:', error);
    res.status(500).json({ error: 'Failed to fetch review insights' });
  }
});

/**
 * @route GET /api/shop/top-reviewers
 * @desc Get top reviewers
 * @access Private
 */
router.get('/top-reviewers', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    
    if (limit > 50) {
      return res.status(400).json({ error: 'Limit cannot exceed 50' });
    }

    const topReviewers = await reviewsService.getTopReviewers(limit);
    res.json({ reviewers: topReviewers });

  } catch (error) {
    console.error('Error fetching top reviewers:', error);
    res.status(500).json({ error: 'Failed to fetch top reviewers' });
  }
});

/**
 * @route POST /api/shop/reviews/:id/flag
 * @desc Flag a review for moderation
 * @access Private
 */
router.post('/reviews/:id/flag', async (req: Request, res: Response) => {
  try {
    const reviewId = parseInt(req.params.id);
    const { reason } = req.body;
    const flaggerWallet = req.user?.main_wallet_pubkey;

    if (!flaggerWallet) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (isNaN(reviewId)) {
      return res.status(400).json({ error: 'Invalid review ID' });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Flag reason is required' });
    }

    if (reason.length > 500) {
      return res.status(400).json({ error: 'Flag reason must be less than 500 characters' });
    }

    await reviewsService.flagReview(reviewId, reason, flaggerWallet);
    res.json({ message: 'Review flagged for moderation' });

  } catch (error) {
    console.error('Error flagging review:', error);
    res.status(500).json({ error: 'Failed to flag review' });
  }
});

// Validation helper functions
function validateReviewRequest(data: SubmitReviewRequest): string[] {
  const errors: string[] = [];

  // Rating validation
  if (data.rating === undefined || data.rating === null) {
    errors.push('Rating is required');
  } else if (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5) {
    errors.push('Rating must be an integer between 1 and 5');
  }

  // Review text validation
  if (data.reviewText !== undefined) {
    if (typeof data.reviewText !== 'string') {
      errors.push('Review text must be a string');
    } else if (data.reviewText.length > 2000) {
      errors.push('Review text must be less than 2000 characters');
    }
  }

  // Used duration validation
  if (data.usedDurationDays !== undefined) {
    if (!Number.isInteger(data.usedDurationDays) || data.usedDurationDays < 0) {
      errors.push('Used duration must be a non-negative integer');
    } else if (data.usedDurationDays > 365) {
      errors.push('Used duration cannot exceed 365 days');
    }
  }

  // Actual ROI validation
  if (data.actualROI !== undefined) {
    if (typeof data.actualROI !== 'number') {
      errors.push('Actual ROI must be a number');
    } else if (data.actualROI < -100 || data.actualROI > 10000) {
      errors.push('Actual ROI must be between -100% and 10000%');
    }
  }

  // Recommendation level validation
  if (data.recommendationLevel !== undefined) {
    if (!Number.isInteger(data.recommendationLevel) || data.recommendationLevel < 1 || data.recommendationLevel > 5) {
      errors.push('Recommendation level must be an integer between 1 and 5');
    }
  }

  return errors;
}

function validatePartialReviewRequest(data: Partial<SubmitReviewRequest>): string[] {
  const errors: string[] = [];

  // Only validate fields that are provided
  if (data.rating !== undefined) {
    if (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5) {
      errors.push('Rating must be an integer between 1 and 5');
    }
  }

  if (data.reviewText !== undefined) {
    if (typeof data.reviewText !== 'string') {
      errors.push('Review text must be a string');
    } else if (data.reviewText.length > 2000) {
      errors.push('Review text must be less than 2000 characters');
    }
  }

  if (data.usedDurationDays !== undefined) {
    if (!Number.isInteger(data.usedDurationDays) || data.usedDurationDays < 0) {
      errors.push('Used duration must be a non-negative integer');
    } else if (data.usedDurationDays > 365) {
      errors.push('Used duration cannot exceed 365 days');
    }
  }

  if (data.actualROI !== undefined) {
    if (typeof data.actualROI !== 'number') {
      errors.push('Actual ROI must be a number');
    } else if (data.actualROI < -100 || data.actualROI > 10000) {
      errors.push('Actual ROI must be between -100% and 10000%');
    }
  }

  if (data.recommendationLevel !== undefined) {
    if (!Number.isInteger(data.recommendationLevel) || data.recommendationLevel < 1 || data.recommendationLevel > 5) {
      errors.push('Recommendation level must be an integer between 1 and 5');
    }
  }

  return errors;
}

export default router;