// Re-export types from backend for frontend use
export interface PublishedStrategy {
  id: number;
  strategy_id: number;
  publisher_wallet: string;
  
  // Publishing Details
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  
  // Requirements
  required_wallets: number;
  min_balance_sol: number;
  
  // Pricing
  price_sol: number;
  is_free: boolean;
  
  // Performance Metrics
  total_roi_percentage?: number;
  avg_daily_return?: number;
  max_drawdown?: number;
  total_trades: number;
  win_rate?: number;
  
  // Marketplace Stats
  downloads: number;
  rating: number;
  review_count: number;
  
  // Status
  is_active: boolean;
  is_verified: boolean;
  
  // Timestamps
  published_at: string;
  last_updated: string;
}

export interface PublishedStrategyWithMetrics extends PublishedStrategy {
  strategy_type: string;
  config: any;
  publisher_name: string;
  total_adoptions: number;
  avg_rating: number;
  total_reviews: number;
}

export interface StrategyAdoption {
  id: number;
  published_strategy_id: number;
  adopter_wallet: string;
  adopted_strategy_id: number;
  wallet_mapping: WalletMapping;
  custom_config?: any;
  is_modified: boolean;
  is_active: boolean;
  adopted_at: string;
  last_modified: string;
}

export interface StrategyReview {
  id: number;
  published_strategy_id: number;
  reviewer_wallet: string;
  adoption_id: number;
  rating: number;
  review_text?: string;
  used_duration_days?: number;
  actual_roi_percentage?: number;
  recommendation_level?: number;
  is_verified: boolean;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface StrategyPerformanceHistory {
  id: number;
  strategy_id: number;
  date: string;
  starting_balance_sol: number;
  ending_balance_sol: number;
  daily_return_sol: number;
  daily_return_percentage: number;
  starting_balance_usd: number;
  ending_balance_usd: number;
  daily_return_usd: number;
  trades_executed: number;
  successful_trades: number;
  failed_trades: number;
  max_drawdown: number;
  volatility: number;
  created_at: string;
}

export interface StrategyWalletRequirement {
  id: number;
  published_strategy_id: number;
  wallet_position: number;
  wallet_role: string;
  min_balance_sol: number;
  description?: string;
  required_tokens?: string[];
  permissions?: string[];
  created_at: string;
}

export interface WalletMapping {
  [originalPosition: number]: number; // Maps to user's trading_wallet_id
}

// Request/Response types for API

export interface PublishStrategyRequest {
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  requiredWallets: number;
  walletRequirements: {
    position: number;
    role: string;
    minBalance: number;
    description?: string;
    requiredTokens?: string[];
    permissions?: string[];
  }[];
  minBalanceSol: number;
  isFree: boolean;
  priceSol?: number;
}

export interface PublishStrategyResponse {
  publishedStrategyId: number;
  status: 'published' | 'pending_review';
  message: string;
}

export interface UpdatePublishedStrategyRequest {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  isActive?: boolean;
  priceSol?: number;
}

export interface UnpublishStrategyResponse {
  success: boolean;
  message: string;
}

export interface BrowseStrategiesRequest {
  category?: string;
  tags?: string[];
  minRating?: number;
  maxRequiredWallets?: number;
  sortBy?: 'rating' | 'downloads' | 'roi' | 'recent';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface BrowseStrategiesResponse {
  strategies: PublishedStrategyWithMetrics[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  filters: {
    categories: string[];
    tags: string[];
    ratingRange: [number, number];
    roiRange: [number, number];
  };
}

export interface StrategyDetailsResponse {
  strategy: PublishedStrategyWithMetrics;
  performance: {
    totalROI: number;
    avgDailyReturn: number;
    maxDrawdown: number;
    totalTrades: number;
    winRate: number;
    performanceChart: {
      date: string;
      roi: number;
      balance: number;
    }[];
  };
  walletRequirements: StrategyWalletRequirement[];
  reviews: {
    summary: {
      averageRating: number;
      totalReviews: number;
      ratingDistribution: { [key: number]: number };
    };
    recent: StrategyReview[];
  };
  publisher: {
    wallet: string;
    publishedStrategies: number;
    totalDownloads: number;
    averageRating: number;
  };
}

export interface AdoptStrategyRequest {
  walletMapping: WalletMapping;
  customizations?: {
    config?: any;
    name?: string;
  };
}

export interface AdoptStrategyResponse {
  adoptionId: number;
  createdStrategies: {
    strategyId: number;
    walletId: number;
    walletName: string;
  }[];
  message: string;
}

export interface SubmitReviewRequest {
  rating: number;
  reviewText?: string;
  usedDurationDays?: number;
  actualROI?: number;
  recommendationLevel?: number;
}

export interface GetReviewsResponse {
  reviews: StrategyReview[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  summary: {
    averageRating: number;
    totalReviews: number;
    ratingDistribution: { [key: number]: number };
  };
}

export interface PerformanceMetrics {
  totalROI: number;
  avgDailyReturn: number;
  maxDrawdown: number;
  totalTrades: number;
  winRate: number;
  sharpeRatio?: number;
  volatility: number;
  profitFactor?: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SearchFilters {
  category?: string;
  tags?: string[];
  minRating?: number;
  maxRequiredWallets?: number;
  priceRange?: [number, number];
  roiRange?: [number, number];
}

export interface PaginationRequest {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ReviewSummary {
  averageRating: number;
  totalReviews: number;
  ratingDistribution: { [key: number]: number };
}

// Strategy categories - Habitat2 automation strategies
export const STRATEGY_CATEGORIES = [
  'Wallet Monitor',
  'Price Monitor', 
  'Vault',
  'Levels',
  'Other'
] as const;

export type StrategyCategory = typeof STRATEGY_CATEGORIES[number];

// Common tags for Habitat2 automation strategies
export const STRATEGY_TAGS = [
  'wallet-mirroring',
  'whale-tracking',
  'price-alerts',
  'automated',
  'manual-trigger',
  'low-risk',
  'high-frequency',
  'beginner-friendly',
  'advanced',
  'multi-wallet',
  'single-wallet',
  'percentage-based',
  'fixed-amount',
  'stop-loss',
  'take-profit',
  'vault-allocation',
  'level-trading',
  'monitored-wallet',
  'real-time',
  'configurable'
] as const;

export type StrategyTag = typeof STRATEGY_TAGS[number];

// Wallet roles
export const WALLET_ROLES = [
  'primary',
  'secondary',
  'vault',
  'backup',
  'feeder',
  'monitor'
] as const;

export type WalletRole = typeof WALLET_ROLES[number];

// Sort options
export const SORT_OPTIONS = [
  { value: 'rating', label: 'Rating' },
  { value: 'downloads', label: 'Downloads' },
  { value: 'roi', label: 'ROI' },
  { value: 'recent', label: 'Recently Published' }
] as const;