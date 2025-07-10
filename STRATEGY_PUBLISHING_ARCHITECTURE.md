# Strategy Publishing & Marketplace Architecture Design

> **Generated**: 2025-01-07  
> **Feature**: Strategy Publishing and Shop/Marketplace  
> **Target**: Enable users to publish and share trading strategies  

## 🎯 Feature Overview

This architecture enables users to:
1. **Publish** their successful trading strategies with performance metrics
2. **Browse** a marketplace of community-created strategies
3. **Adopt** strategies from other users into their own trading wallets
4. **Share ROI** performance data to build credibility
5. **Manage** wallet requirements (1-3 trading wallets) for each strategy

## 🏗️ Database Schema Design

### New Tables Required

#### **1. Published Strategies Table**
```sql
CREATE TABLE published_strategies (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    publisher_wallet VARCHAR(44) REFERENCES users(main_wallet_pubkey),
    
    -- Publishing Details
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    tags VARCHAR(255)[], -- Array of searchable tags
    
    -- Requirements
    required_wallets INTEGER NOT NULL CHECK (required_wallets >= 1 AND required_wallets <= 3),
    min_balance_sol DECIMAL(10,4) DEFAULT 0, -- Minimum SOL required to run
    
    -- Pricing (Future: could enable paid strategies)
    price_sol DECIMAL(10,4) DEFAULT 0,
    is_free BOOLEAN DEFAULT true,
    
    -- Performance Metrics
    total_roi_percentage DECIMAL(10,4),
    avg_daily_return DECIMAL(10,4),
    max_drawdown DECIMAL(10,4),
    total_trades INTEGER DEFAULT 0,
    win_rate DECIMAL(5,2), -- Percentage of winning trades
    
    -- Marketplace Stats
    downloads INTEGER DEFAULT 0,
    rating DECIMAL(3,2) DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false, -- Admin verification
    
    -- Timestamps
    published_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_published_strategies_active ON published_strategies(is_active, rating DESC);
CREATE INDEX idx_published_strategies_category ON published_strategies(category, is_active);
CREATE INDEX idx_published_strategies_publisher ON published_strategies(publisher_wallet);
CREATE INDEX idx_published_strategies_downloads ON published_strategies(downloads DESC);
```

#### **2. Strategy Adoptions Table**
```sql
CREATE TABLE strategy_adoptions (
    id SERIAL PRIMARY KEY,
    published_strategy_id INTEGER REFERENCES published_strategies(id) ON DELETE CASCADE,
    adopter_wallet VARCHAR(44) REFERENCES users(main_wallet_pubkey),
    
    -- Adoption Details
    adopted_strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    wallet_mapping JSONB NOT NULL, -- Maps original wallet positions to user's wallets
    
    -- Customization
    custom_config JSONB, -- User modifications to original config
    is_modified BOOLEAN DEFAULT false,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    adopted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_modified TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_strategy_adoptions_adopter ON strategy_adoptions(adopter_wallet);
CREATE INDEX idx_strategy_adoptions_published ON strategy_adoptions(published_strategy_id);
```

#### **3. Strategy Reviews Table**
```sql
CREATE TABLE strategy_reviews (
    id SERIAL PRIMARY KEY,
    published_strategy_id INTEGER REFERENCES published_strategies(id) ON DELETE CASCADE,
    reviewer_wallet VARCHAR(44) REFERENCES users(main_wallet_pubkey),
    adoption_id INTEGER REFERENCES strategy_adoptions(id) ON DELETE CASCADE,
    
    -- Review Content
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    
    -- Review Metrics (from actual usage)
    used_duration_days INTEGER,
    actual_roi_percentage DECIMAL(10,4),
    recommendation_level INTEGER CHECK (recommendation_level >= 1 AND recommendation_level <= 5),
    
    -- Status
    is_verified BOOLEAN DEFAULT false, -- Verified actual usage
    is_visible BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Prevent duplicate reviews
    UNIQUE(published_strategy_id, reviewer_wallet)
);

-- Indexes
CREATE INDEX idx_strategy_reviews_published ON strategy_reviews(published_strategy_id, rating DESC);
CREATE INDEX idx_strategy_reviews_reviewer ON strategy_reviews(reviewer_wallet);
```

#### **4. Strategy Performance History Table**
```sql
CREATE TABLE strategy_performance_history (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    
    -- Daily Performance Metrics
    starting_balance_sol DECIMAL(20,8),
    ending_balance_sol DECIMAL(20,8),
    daily_return_sol DECIMAL(20,8),
    daily_return_percentage DECIMAL(10,4),
    
    -- USD Equivalent
    starting_balance_usd DECIMAL(20,8),
    ending_balance_usd DECIMAL(20,8),
    daily_return_usd DECIMAL(20,8),
    
    -- Trading Activity
    trades_executed INTEGER DEFAULT 0,
    successful_trades INTEGER DEFAULT 0,
    failed_trades INTEGER DEFAULT 0,
    
    -- Metrics
    max_drawdown DECIMAL(10,4),
    volatility DECIMAL(10,4),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(strategy_id, date)
);

-- Partition by date for performance (optional)
CREATE INDEX idx_strategy_performance_date ON strategy_performance_history(date DESC);
CREATE INDEX idx_strategy_performance_strategy ON strategy_performance_history(strategy_id, date DESC);
```

#### **5. Wallet Requirements Mapping**
```sql
CREATE TABLE strategy_wallet_requirements (
    id SERIAL PRIMARY KEY,
    published_strategy_id INTEGER REFERENCES published_strategies(id) ON DELETE CASCADE,
    
    -- Wallet Configuration
    wallet_position INTEGER NOT NULL CHECK (wallet_position >= 1 AND wallet_position <= 3),
    wallet_role VARCHAR(100) NOT NULL, -- 'primary', 'secondary', 'vault', etc.
    min_balance_sol DECIMAL(10,4) DEFAULT 0,
    description TEXT,
    
    -- Configuration Requirements
    required_tokens VARCHAR(44)[], -- Array of token mints required
    permissions VARCHAR(100)[], -- Array of required permissions
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(published_strategy_id, wallet_position)
);

-- Indexes
CREATE INDEX idx_wallet_requirements_published ON strategy_wallet_requirements(published_strategy_id);
```

## 🔧 Backend API Design

### **Strategy Publishing Endpoints**

#### **1. Publish Strategy**
```typescript
// POST /api/strategies/:id/publish
interface PublishStrategyRequest {
  title: string;
  description: string;
  category: string;
  tags: string[];
  requiredWallets: number; // 1-3
  walletRequirements: {
    position: number;
    role: string;
    minBalance: number;
    description: string;
    requiredTokens?: string[];
  }[];
  minBalanceSol: number;
  isFree: boolean;
  priceSol?: number;
}

interface PublishStrategyResponse {
  publishedStrategyId: number;
  status: 'published' | 'pending_review';
  message: string;
}
```

#### **2. Update Published Strategy**
```typescript
// PUT /api/strategies/published/:id
interface UpdatePublishedStrategyRequest {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  isActive?: boolean;
  priceSol?: number;
}
```

#### **3. Unpublish Strategy**
```typescript
// DELETE /api/strategies/published/:id
interface UnpublishStrategyResponse {
  success: boolean;
  message: string;
}
```

### **Strategy Marketplace Endpoints**

#### **1. Browse Strategies**
```typescript
// GET /api/shop/strategies
interface BrowseStrategiesRequest {
  category?: string;
  tags?: string[];
  minRating?: number;
  maxRequiredWallets?: number;
  sortBy?: 'rating' | 'downloads' | 'roi' | 'recent';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

interface BrowseStrategiesResponse {
  strategies: PublishedStrategy[];
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
```

#### **2. Get Strategy Details**
```typescript
// GET /api/shop/strategies/:id
interface StrategyDetailsResponse {
  strategy: PublishedStrategy;
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
  walletRequirements: WalletRequirement[];
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
```

#### **3. Adopt Strategy**
```typescript
// POST /api/shop/strategies/:id/adopt
interface AdoptStrategyRequest {
  walletMapping: {
    [originalPosition: number]: number; // Maps to user's trading_wallet_id
  };
  customizations?: {
    config?: any;
    name?: string;
  };
}

interface AdoptStrategyResponse {
  adoptionId: number;
  createdStrategies: {
    strategyId: number;
    walletId: number;
    walletName: string;
  }[];
  message: string;
}
```

### **Review System Endpoints**

#### **1. Submit Review**
```typescript
// POST /api/shop/strategies/:id/reviews
interface SubmitReviewRequest {
  rating: number; // 1-5
  reviewText: string;
  usedDurationDays: number;
  actualROI: number;
  recommendationLevel: number; // 1-5
}
```

#### **2. Get Reviews**
```typescript
// GET /api/shop/strategies/:id/reviews
interface GetReviewsResponse {
  reviews: StrategyReview[];
  pagination: PaginationInfo;
  summary: ReviewSummary;
}
```

## 🎨 Frontend Components Design

### **1. Strategy Publishing Interface**

#### **PublishStrategyModal Component**
```typescript
interface PublishStrategyModalProps {
  strategy: Strategy;
  onPublish: (data: PublishStrategyRequest) => void;
  onCancel: () => void;
  isOpen: boolean;
}

// Features:
// - Strategy title and description input
// - Category selection dropdown
// - Tags input with autocomplete
// - Wallet requirements configurator
// - Performance metrics display
// - Preview of published listing
```

#### **WalletRequirementsBuilder Component**
```typescript
interface WalletRequirementsBuilderProps {
  maxWallets: number; // 1-3
  requirements: WalletRequirement[];
  onChange: (requirements: WalletRequirement[]) => void;
}

// Features:
// - Visual wallet configuration
// - Role assignment (Primary, Secondary, Vault)
// - Minimum balance requirements
// - Token requirements selector
// - Drag-and-drop reordering
```

### **2. Strategy Marketplace Interface**

#### **StrategyShop Component**
```typescript
interface StrategyShopProps {
  initialFilters?: SearchFilters;
  onStrategySelect: (strategy: PublishedStrategy) => void;
}

// Features:
// - Search and filter controls
// - Category navigation
// - Strategy grid/list view
// - Sort options
// - Pagination
// - Performance metrics display
```

#### **StrategyCard Component**
```typescript
interface StrategyCardProps {
  strategy: PublishedStrategy;
  onAdopt: () => void;
  onViewDetails: () => void;
  showPerformance?: boolean;
}

// Features:
// - Strategy title and description
// - Performance metrics (ROI, win rate)
// - Rating and reviews count
// - Required wallets indicator
// - Publisher information
// - Adopt button
```

#### **StrategyDetailsModal Component**
```typescript
interface StrategyDetailsModalProps {
  strategyId: number;
  onAdopt: (adoptionData: AdoptStrategyRequest) => void;
  onClose: () => void;
  isOpen: boolean;
}

// Features:
// - Detailed strategy information
// - Performance charts
// - Wallet requirements breakdown
// - Review system
// - Publisher profile
// - Adoption flow
```

### **3. Strategy Adoption Interface**

#### **StrategyAdoptionWizard Component**
```typescript
interface StrategyAdoptionWizardProps {
  publishedStrategy: PublishedStrategy;
  userWallets: TradingWallet[];
  onComplete: (adoption: AdoptStrategyRequest) => void;
  onCancel: () => void;
}

// Steps:
// 1. Review strategy requirements
// 2. Map wallets to requirements
// 3. Customize configuration (optional)
// 4. Confirm adoption
// 5. Success/Error handling
```

#### **WalletMappingInterface Component**
```typescript
interface WalletMappingInterfaceProps {
  requirements: WalletRequirement[];
  userWallets: TradingWallet[];
  onMappingChange: (mapping: WalletMapping) => void;
}

// Features:
// - Visual wallet mapping
// - Balance validation
// - Requirements checking
// - Create new wallet option
// - Mapping validation
```

## 🔄 Business Logic Services

### **1. Strategy Publishing Service**

```typescript
class StrategyPublishingService {
  // Calculate performance metrics for publishing
  async calculatePerformanceMetrics(strategyId: number): Promise<PerformanceMetrics> {
    // Analyze historical performance
    // Calculate ROI, win rate, drawdown
    // Generate performance charts
  }
  
  // Validate strategy for publishing
  async validateForPublishing(strategyId: number): Promise<ValidationResult> {
    // Check minimum performance requirements
    // Validate configuration completeness
    // Check for security issues
  }
  
  // Publish strategy
  async publishStrategy(strategyId: number, publishData: PublishStrategyRequest): Promise<PublishedStrategy> {
    // Create published strategy record
    // Generate wallet requirements
    // Update performance metrics
    // Send notifications
  }
  
  // Update published strategy
  async updatePublishedStrategy(publishedStrategyId: number, updateData: UpdatePublishedStrategyRequest): Promise<PublishedStrategy> {
    // Validate ownership
    // Update metadata
    // Recalculate metrics if needed
  }
}
```

### **2. Strategy Marketplace Service**

```typescript
class StrategyMarketplaceService {
  // Browse strategies with filtering
  async browseStrategies(filters: BrowseStrategiesRequest): Promise<BrowseStrategiesResponse> {
    // Apply filters and sorting
    // Paginate results
    // Include performance metrics
    // Return metadata for filters
  }
  
  // Get detailed strategy information
  async getStrategyDetails(publishedStrategyId: number): Promise<StrategyDetailsResponse> {
    // Fetch strategy data
    // Calculate performance metrics
    // Get reviews and ratings
    // Get publisher information
  }
  
  // Adopt strategy
  async adoptStrategy(publishedStrategyId: number, adoptionData: AdoptStrategyRequest, userWallet: string): Promise<AdoptStrategyResponse> {
    // Validate wallet mapping
    // Create strategy instances
    // Update adoption statistics
    // Send notifications
  }
}
```

### **3. Review System Service**

```typescript
class ReviewSystemService {
  // Submit review
  async submitReview(publishedStrategyId: number, reviewData: SubmitReviewRequest, reviewerWallet: string): Promise<StrategyReview> {
    // Validate reviewer has adopted strategy
    // Create review record
    // Update aggregate ratings
    // Send notifications
  }
  
  // Get reviews for strategy
  async getReviews(publishedStrategyId: number, pagination: PaginationRequest): Promise<GetReviewsResponse> {
    // Fetch reviews with pagination
    // Calculate summary statistics
    // Include reviewer information
  }
  
  // Update aggregate ratings
  async updateAggregateRatings(publishedStrategyId: number): Promise<void> {
    // Calculate average rating
    // Update review count
    // Update rating distribution
  }
}
```

## 🔐 Security Considerations

### **1. Access Control**
- **Publishing**: Only strategy owners can publish their strategies
- **Adoption**: Users can only adopt strategies to their own wallets
- **Reviews**: Only users who have adopted a strategy can review it
- **Modification**: Publishers can update their published strategies

### **2. Data Validation**
- **Wallet Mapping**: Validate user owns mapped wallets
- **Performance Metrics**: Verify calculated metrics are accurate
- **Review Authenticity**: Ensure reviews are from actual users
- **Strategy Configuration**: Validate configurations are safe

### **3. Rate Limiting**
- **Publishing**: Limit strategy publishing frequency
- **Adoption**: Prevent bulk adoption abuse
- **Reviews**: Limit review submission frequency
- **Browse**: Rate limit marketplace browsing

### **4. Content Moderation**
- **Strategy Titles**: Filter inappropriate content
- **Descriptions**: Moderate strategy descriptions
- **Reviews**: Moderate review content
- **Reporting**: Allow users to report inappropriate content

## 📊 Performance Considerations

### **1. Database Optimization**
- **Indexing**: Proper indexes for filtering and sorting
- **Caching**: Cache popular strategies and reviews
- **Partitioning**: Partition performance history by date
- **Archiving**: Archive old performance data

### **2. API Performance**
- **Pagination**: Implement efficient pagination
- **Caching**: Cache marketplace data
- **Compression**: Compress API responses
- **CDN**: Use CDN for static assets

### **3. Frontend Performance**
- **Virtual Scrolling**: For large strategy lists
- **Lazy Loading**: Load strategy details on demand
- **Image Optimization**: Optimize strategy thumbnails
- **Code Splitting**: Split marketplace code

## 🧪 Testing Strategy

### **1. Unit Tests**
- **Publishing Service**: Test strategy publishing logic
- **Marketplace Service**: Test browsing and adoption
- **Review Service**: Test review submission and aggregation
- **Performance Calculations**: Test metric calculations

### **2. Integration Tests**
- **Publishing Flow**: End-to-end publishing process
- **Adoption Flow**: Complete strategy adoption process
- **Review System**: Review submission and display
- **Performance Tracking**: Historical data collection

### **3. E2E Tests**
- **User Journey**: Complete user adoption journey
- **Marketplace Navigation**: Browse and filter strategies
- **Multi-wallet Setup**: Test wallet mapping interface
- **Review Process**: Submit and view reviews

## 📈 Analytics and Monitoring

### **1. Strategy Analytics**
- **Performance Tracking**: Monitor published strategy performance
- **Adoption Metrics**: Track adoption rates and success
- **User Engagement**: Monitor marketplace usage
- **Revenue Metrics**: Track transaction fees and payments

### **2. Quality Metrics**
- **Review Quality**: Monitor review authenticity
- **Strategy Success**: Track adopted strategy performance
- **User Satisfaction**: Monitor user feedback
- **Platform Growth**: Track marketplace growth

### **3. Business Intelligence**
- **Popular Strategies**: Identify trending strategies
- **User Behavior**: Analyze user preferences
- **Performance Correlation**: Correlate strategy types with performance
- **Market Trends**: Identify market opportunities

## 🚀 Implementation Phases

### **Phase 1: Core Infrastructure (Weeks 1-2)**
- Database schema implementation
- Basic API endpoints
- Authentication and authorization
- Performance calculation services

### **Phase 2: Publishing System (Weeks 3-4)**
- Strategy publishing interface
- Wallet requirements builder
- Performance metrics calculation
- Publishing validation

### **Phase 3: Marketplace (Weeks 5-6)**
- Strategy browsing interface
- Search and filtering
- Strategy details view
- Basic adoption flow

### **Phase 4: Advanced Features (Weeks 7-8)**
- Review system
- Advanced analytics
- Performance optimization
- Security enhancements

### **Phase 5: Polish and Testing (Weeks 9-10)**
- Comprehensive testing
- UI/UX improvements
- Performance optimization
- Security audit

## 🎯 Success Metrics

### **1. Engagement Metrics**
- **Strategies Published**: Number of strategies published daily
- **Adoption Rate**: Percentage of browsed strategies adopted
- **User Retention**: Users returning to marketplace
- **Review Engagement**: Reviews per adopted strategy

### **2. Quality Metrics**
- **Strategy Performance**: Average ROI of published strategies
- **Review Quality**: Average review rating and length
- **User Satisfaction**: Overall platform rating
- **Support Issues**: Number of support tickets

### **3. Business Metrics**
- **Revenue**: Transaction fees and premium features
- **Market Share**: Strategies vs. competitors
- **Growth Rate**: New users and strategies monthly
- **User Lifetime Value**: Revenue per user

---

This comprehensive architecture provides a robust foundation for implementing strategy publishing and marketplace functionality in Habitat2, enabling users to share successful trading strategies while maintaining security and performance standards.