# Project Context for Claude - Habitat (Lackey Backpack)

## Project Overview
- **Project Name**: Habitat (also referred to as "Lackey Backpack")
- **Type**: Full-stack Solana trading bot platform with automated strategies
- **Location**: C:\Personal\Cry\Habitat\Habitat2
- **Tech Stack**: TypeScript, React, Node.js, PostgreSQL, Redis, Solana Web3.js
- **Purpose**: Automated trading platform for Solana tokens with multi-wallet management, strategy marketplace, and whale tracking

## Architecture Overview
```
├── src/                    # Frontend (React/TypeScript)
│   ├── components/        # UI components and strategy components
│   ├── services/          # API clients and external integrations
│   ├── contexts/          # React Context (PortfolioContext)
│   └── pages/             # Main application pages
├── backend/               # Backend (Node.js/Express)
│   ├── src/
│   │   ├── routes/        # API endpoints
│   │   ├── services/      # Business logic
│   │   ├── workers/       # Background job processors
│   │   └── db/           # Database queries and migrations
│   └── migrations/        # PostgreSQL migrations
└── shared/                # Shared types and utilities
```

## Key Features
1. **Multi-Wallet Trading**: Support for up to 3 trading wallets per strategy
2. **Automated Strategies**: 6 strategy types (Wallet Monitor, Price Monitor, Vault, Levels, Pair Trade, Drift Perp)
3. **Strategy Marketplace**: Publish, share, and adopt successful strategies
4. **Whale Tracking**: Monitor large wallet movements via Helius API
5. **Portfolio Analytics**: ROI tracking, performance metrics, transaction history

## Database Schema (PostgreSQL)

### Core Tables
- `users` - Main wallet public keys for authentication
- `trading_wallets` - Multiple trading wallets per user (encrypted private keys)
- `strategies` - Strategy configurations with JSON parameters
- `tokens` - Token metadata cache
- `token_prices` - Real-time price data
- `wallet_balances` - Current token holdings
- `transactions` - Partitioned transaction history
- `pair_trade_triggers` - Manual trigger system for pair trade execution

### Strategy Marketplace Tables
- `published_strategies` - Strategies shared in marketplace
- `strategy_adoptions` - Users adopting published strategies
- `strategy_reviews` - Ratings and feedback
- `strategy_performance_history` - Historical performance tracking

## API Endpoints Structure

### Authentication & User
- `POST /api/auth/login` - Wallet authentication
- `GET/POST /api/saved-wallets/*` - Manage saved wallets

### Trading Operations
- `/api/trading-wallets/*` - CRUD operations for trading wallets
- `/api/wallet-balances/*` - Fetch token balances
- `/api/wallet-transactions/*` - Transaction history
- `/api/rpc/*` - Direct Solana RPC calls

### Strategy Management
- `/api/strategies/*` - Create, update, delete strategies
- `/api/shop/*` - Strategy marketplace endpoints
- `/api/triggers/*` - Trading trigger management
- `/api/valuation/*` - Portfolio valuation

### Market Data
- `/api/v1/price-feed/*` - Real-time price feeds
- `/api/v1/jupiter/*` - DEX swap integration
- `/api/v1/tokens/*` - Token metadata and search
- `/api/v1/whale-tracking/*` - Whale wallet monitoring

## Strategy Types & Parameters

### 1. Wallet Monitor
- **Purpose**: Mirror trades from target wallets
- **Key Params**: targetWallet, percentage, maxAmount, includeTokens[], excludeTokens[]
- **Worker**: `backend/src/workers/walletMonitorWorker.ts`

### 2. Price Monitor
- **Purpose**: Execute trades at price thresholds
- **Key Params**: tokenMint, buyPrice, sellPrice, amount, stopLoss, takeProfit
- **Worker**: `backend/src/workers/priceMonitorWorker.ts`

### 3. Vault Strategy
- **Purpose**: Secure fund allocation with auto-rebalancing
- **Key Params**: percentage, minBalance, rebalanceFrequency, securityLevel
- **Worker**: `backend/src/workers/vaultWorker.ts`

### 4. Levels Strategy
- **Purpose**: Trade at specific price levels
- **Key Params**: tokenMint, levels[{price, amount, action}], resetOnComplete
- **Worker**: `backend/src/workers/levelsWorker.ts`

### 5. Pair Trade
- **Purpose**: Trade between two tokens maintaining ratio
- **Key Params**: tokenAMint, tokenBMint, allocationPercentage, maxSlippage
- **Worker**: `backend/src/workers/pairTradeWorker.ts`
- **Manual Trigger System**: `pair_trade_triggers` table for manual swap execution
- **Trigger Daemon**: `backend/src/services/PairTradeTriggerDaemon.ts`

### 6. Drift Perp Strategy
- **Purpose**: Automated perpetual futures trading on Drift Protocol
- **Key Params**: marketSymbol, marketIndex, direction (long/short), entryPrice, exitPrice, leverage, allocationPercentage, stopLoss, takeProfit
- **Worker**: `backend/src/workers/DriftPerpWorker.ts`
- **Service**: `backend/src/services/DriftService.ts`
- **Features**:
  - Perpetual futures trading with leverage
  - Automatic position management
  - Stop loss and take profit orders
  - Real-time price monitoring
  - Position history tracking
  - Margin ratio and liquidation monitoring

## External Integrations

### Blockchain & DEX
- **Solana Web3.js**: Direct blockchain interaction
- **Jupiter Aggregator**: Token swap routing (`/backend/src/services/jupiterService.ts`)
- **SPL Token Program**: Token operations
- **Drift Protocol**: Perpetual futures trading (`/backend/src/services/DriftService.ts`)

### Data Providers
- **Helius API**: 
  - Wallet balances and token accounts
  - Whale tracking and monitoring
  - Config: `HELIUS_API_KEY` in env
- **Birdeye API**: Token prices and market data
- **Pyth Network**: Price feed data

### Infrastructure
- **Supabase**: PostgreSQL database and authentication
- **Redis**: Caching layer for API responses
- **WebSocket**: Real-time updates to frontend

## Security Considerations
- **Wallet Encryption**: AES-256-GCM encryption for private keys
- **Authentication**: JWT-based with secure middleware
- **Local Storage**: Sensitive data stored client-side only
- **Password Protection**: User passwords for wallet operations
- **Rate Limiting**: API endpoint protection

## Development Workflow

### Environment Setup
```bash
# Frontend
cd /mnt/c/Personal/Cry/Habitat/Habitat2
npm install
npm run dev

# Backend
cd backend
npm install
npm run dev
```

### Testing
- **Backend Tests**: Jest (`npm test` in backend/)
- **Frontend Tests**: Vitest (`npm test` in root)
- **E2E Tests**: Playwright

### Key Environment Variables
- `HELIUS_API_KEY` - Helius API access
- `SUPABASE_URL` - Database URL
- `SUPABASE_ANON_KEY` - Supabase public key
- `JWT_SECRET` - JWT signing secret
- `REDIS_URL` - Redis connection

## Common Development Tasks

### Adding a New Strategy Type
1. Create strategy component in `src/components/strategies/`
2. Add backend worker in `backend/src/workers/`
3. Update strategy types in `shared/types/`
4. Add API routes in `backend/src/routes/`
5. Update database schema if needed

### Integrating New DEX/API
1. Create service in `backend/src/services/`
2. Add API client in `src/services/`
3. Update Jupiter service if swap-related
4. Add caching logic in Redis service

### Database Migrations
```bash
cd backend
npm run migrate:create -- migration-name
npm run migrate:up
```

## Performance Optimizations
- **Database**: Partitioned tables for transactions
- **Caching**: Redis for price feeds and balances
- **WebSocket**: Real-time updates instead of polling
- **Batch Operations**: Bulk inserts for transaction history

## Debugging Tips
- **API Logs**: Check `backend/logs/` for detailed logs
- **Worker Status**: Monitor background jobs in database
- **Price Feeds**: Verify external API responses in Redis
- **Wallet Operations**: Check encryption/decryption in wallet service

## Important Code Locations
- **Strategy Execution**: `backend/src/workers/*Worker.ts`
- **Swap Logic**: `backend/src/services/jupiterService.ts`
- **Wallet Management**: `backend/src/services/walletService.ts`
- **Authentication**: `backend/src/middleware/auth.ts`
- **Price Monitoring**: `backend/src/services/priceService.ts`
- **Frontend State**: `src/contexts/PortfolioContext.tsx`

## Testing Strategies Locally
1. Use Solana devnet for testing
2. Get test SOL from faucet
3. Use test tokens (USDC-Dev, etc.)
4. Monitor logs in `backend/logs/`

## Common Issues & Solutions
- **Wallet Balance Mismatch**: Clear Redis cache
- **Strategy Not Executing**: Check worker logs and strategy status
- **Price Feed Issues**: Verify external API keys
- **Transaction Failures**: Check slippage settings and wallet balance