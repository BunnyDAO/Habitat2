# Levels Trading System - Implementation Design

## Overview

The Levels Trading System is an enhanced trading strategy that mimics professional trading platforms by supporting both BUY and SELL modes with multiple order types. This replaces the current simplistic "sell on any level" approach with a sophisticated order management system.

## Core Concepts

### Strategy Modes

Each Levels strategy operates in one of two primary modes:

- **BUY Mode**: Start with USDC, accumulate SOL through limit orders
- **SELL Mode**: Start with SOL, convert to USDC through stop-loss and take-profit orders

### Order Types

#### BUY Mode Orders
- **Limit Buy**: Buy SOL when price drops to or below the specified level
- **DCA (Dollar Cost Average)**: Execute multiple buy orders at different price levels

#### SELL Mode Orders
- **Stop Loss**: Sell SOL when price drops to or below the specified level (protect against losses)
- **Take Profit/Limit Sell**: Sell SOL when price rises to or above the specified level (capture gains)

## Data Structure Design

### Enhanced LevelsStrategy Interface

```typescript
interface LevelsStrategy {
  id: string;
  mode: 'buy' | 'sell';
  tradingWalletPublicKey: string;
  tradingWalletSecretKey: Uint8Array;
  isActive: boolean;
  
  // Strategy settings
  autoRestartAfterComplete: boolean;
  cooldownHours: number; // Per-level cooldown to prevent spam
  maxRetriggers: number; // Max times a level can execute before permanent disable
  
  // Level management
  levels: Level[];
  
  // Execution tracking
  completedLevels: number;
  totalLevels: number;
  lastExecutionTime?: string;
  strategyStartTime: string;
  
  // Performance tracking
  profitTracking: {
    initialUsdcBalance?: number; // For BUY mode
    initialSolBalance?: number;  // For SELL mode
    currentBalance: number;
    totalProfit: number;
    profitHistory: ProfitEntry[];
    trades: TradeEntry[];
  };
}

interface Level {
  id: string;
  type: 'limit_buy' | 'stop_loss' | 'take_profit';
  price: number;
  
  // Buy mode specific
  usdcAmount?: number;        // Fixed USDC amount to spend
  
  // Sell mode specific  
  solPercentage?: number;     // Percentage of current SOL holdings to sell
  
  // Execution state
  executed: boolean;
  executedCount: number;      // How many times this level has triggered
  executedAt?: string;        // Last execution timestamp
  cooldownUntil?: string;     // Timestamp when level can retrigger
  permanentlyDisabled: boolean;
  
  // Execution results
  executionHistory: LevelExecution[];
}

interface LevelExecution {
  timestamp: string;
  triggerPrice: number;
  amountTraded: number;       // SOL amount (positive = bought, negative = sold)
  usdcValue: number;          // USDC value of the trade
  signature: string;
  success: boolean;
  errorMessage?: string;
}

interface ProfitEntry {
  timestamp: string;
  balanceChange: number;
  totalBalance: number;
  triggerLevel?: string;      // Which level caused this change
}

interface TradeEntry {
  timestamp: string;
  type: 'buy' | 'sell';
  amount: number;             // SOL amount
  price: number;              // SOL price at execution
  usdcValue: number;
  levelId: string;
  profit: number;             // Realized profit/loss
}
```

## Trigger Logic Implementation

### Price Crossing Detection

```typescript
class LevelsWorker extends BaseWorker {
  private lastPrice: number = 0;
  
  private checkLevels(currentPrice: number): Level[] {
    const eligibleLevels = this.levels.filter(level => {
      // Skip executed levels still in cooldown
      if (level.executed && !this.isCooldownExpired(level)) {
        return false;
      }
      
      // Skip permanently disabled levels
      if (level.permanentlyDisabled) {
        return false;
      }
      
      // Check trigger conditions based on order type
      return this.shouldTriggerLevel(level, currentPrice);
    });
    
    return eligibleLevels;
  }
  
  private shouldTriggerLevel(level: Level, currentPrice: number): boolean {
    switch (level.type) {
      case 'limit_buy':
      case 'stop_loss':
        // Trigger when price crosses DOWN to/below level
        return this.hasCrossedDown(level.price, currentPrice);
        
      case 'take_profit':
        // Trigger when price crosses UP to/above level
        return this.hasCrossedUp(level.price, currentPrice);
        
      default:
        return false;
    }
  }
  
  private hasCrossedDown(levelPrice: number, currentPrice: number): boolean {
    // Price crossed down through level OR first check and already below
    return (this.lastPrice > levelPrice && currentPrice <= levelPrice) ||
           (currentPrice <= levelPrice && this.lastPrice === 0);
  }
  
  private hasCrossedUp(levelPrice: number, currentPrice: number): boolean {
    // Price crossed up through level OR first check and already above  
    return (this.lastPrice < levelPrice && currentPrice >= levelPrice) ||
           (currentPrice >= levelPrice && this.lastPrice === 0);
  }
  
  private isCooldownExpired(level: Level): boolean {
    if (!level.cooldownUntil) return true;
    return new Date() > new Date(level.cooldownUntil);
  }
}
```

### Trade Execution Logic

```typescript
private async executeLevel(level: Level, currentPrice: number): Promise<void> {
  try {
    let swapResult: SwapResponse;
    
    if (level.type === 'limit_buy') {
      // BUY: USDC → SOL
      swapResult = await this.executeBuyOrder(level, currentPrice);
    } else {
      // SELL: SOL → USDC (stop_loss or take_profit)
      swapResult = await this.executeSellOrder(level, currentPrice);
    }
    
    // Record successful execution
    await this.recordLevelExecution(level, swapResult, currentPrice, true);
    
    // Update level state
    level.executed = true;
    level.executedCount++;
    level.executedAt = new Date().toISOString();
    level.cooldownUntil = this.calculateCooldownEnd();
    
    // Check if level should be permanently disabled
    if (level.executedCount >= this.strategy.maxRetriggers) {
      level.permanentlyDisabled = true;
      console.log(`[Levels] Level ${level.id} permanently disabled after ${level.executedCount} executions`);
    }
    
    // Check if strategy should be paused
    await this.checkStrategyCompletion();
    
  } catch (error) {
    console.error(`[Levels] Failed to execute level ${level.id}:`, error);
    await this.recordLevelExecution(level, null, currentPrice, false, error.message);
  }
}

private async executeBuyOrder(level: Level, currentPrice: number): Promise<SwapResponse> {
  if (!level.usdcAmount) {
    throw new Error('BUY order missing USDC amount');
  }
  
  console.log(`[Levels] 🛒 Executing BUY: $${level.usdcAmount} USDC → SOL at $${currentPrice}`);
  
  return await this.swapService.executeSwap({
    inputMint: USDC_MINT,
    outputMint: SOL_MINT,
    amount: level.usdcAmount,
    slippageBps: 100,
    walletKeypair: {
      publicKey: this.tradingWalletKeypair.publicKey.toString(),
      secretKey: Array.from(this.tradingWalletKeypair.secretKey)
    },
    feeWalletPubkey: JUPITER_FEE_ACCOUNT
  });
}

private async executeSellOrder(level: Level, currentPrice: number): Promise<SwapResponse> {
  if (!level.solPercentage) {
    throw new Error('SELL order missing SOL percentage');
  }
  
  // Get current SOL balance
  const balance = await this.connection.getBalance(this.tradingWalletKeypair.publicKey);
  const solBalance = balance / 1e9;
  const amountToSell = (solBalance * level.solPercentage) / 100;
  
  console.log(`[Levels] 💰 Executing SELL: ${amountToSell} SOL (${level.solPercentage}%) → USDC at $${currentPrice}`);
  
  return await this.swapService.executeSwap({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: amountToSell,
    slippageBps: 100,
    walletKeypair: {
      publicKey: this.tradingWalletKeypair.publicKey.toString(),
      secretKey: Array.from(this.tradingWalletKeypair.secretKey)
    },
    feeWalletPubkey: JUPITER_FEE_ACCOUNT
  });
}
```

## Strategy Lifecycle Management

### Auto-Pause Logic

```typescript
private async checkStrategyCompletion(): Promise<void> {
  const activeLevels = this.levels.filter(level => 
    !level.permanentlyDisabled && 
    (!level.executed || this.isCooldownExpired(level))
  );
  
  if (activeLevels.length === 0) {
    console.log(`[Levels] 🏁 All levels completed or disabled. Pausing strategy.`);
    
    if (this.strategy.autoRestartAfterComplete) {
      // Reset all levels for next cycle
      await this.resetAllLevels();
      console.log(`[Levels] 🔄 Auto-restart enabled. Strategy reset for next cycle.`);
    } else {
      // Pause the strategy
      await this.pauseStrategy();
    }
  }
}

private async resetAllLevels(): Promise<void> {
  this.levels.forEach(level => {
    level.executed = false;
    level.cooldownUntil = undefined;
    level.executedAt = undefined;
    // Keep execution history for performance tracking
  });
  
  // Update database
  await this.updateStrategyInDatabase();
}

private async pauseStrategy(): Promise<void> {
  // Update strategy to inactive in database
  const { error } = await supabase
    .from('strategies')
    .update({ is_active: false })
    .eq('id', this.job.id);
    
  if (error) {
    console.error(`[Levels] Failed to pause strategy ${this.job.id}:`, error);
  } else {
    console.log(`[Levels] ✅ Strategy ${this.job.id} paused successfully`);
  }
  
  // Stop the worker
  await this.stop();
}
```

### Cooldown System

```typescript
private calculateCooldownEnd(): string {
  const cooldownMs = this.strategy.cooldownHours * 60 * 60 * 1000;
  return new Date(Date.now() + cooldownMs).toISOString();
}
```

## Balance Validation

### Pre-Execution Checks

```typescript
private async validateTradeBalance(level: Level): Promise<boolean> {
  if (level.type === 'limit_buy') {
    // Check USDC balance for buy orders
    const usdcBalance = await this.getUsdcBalance();
    if (usdcBalance < level.usdcAmount!) {
      console.warn(`[Levels] Insufficient USDC: need $${level.usdcAmount}, have $${usdcBalance}`);
      return false;
    }
  } else {
    // Check SOL balance for sell orders
    const solBalance = await this.getSolBalance();
    const requiredSol = (solBalance * level.solPercentage!) / 100;
    if (solBalance < requiredSol) {
      console.warn(`[Levels] Insufficient SOL: need ${requiredSol}, have ${solBalance}`);
      return false;
    }
  }
  
  return true;
}

private async getUsdcBalance(): Promise<number> {
  // Implementation to get USDC token balance
  // Returns balance in USDC units (not smallest denomination)
}

private async getSolBalance(): Promise<number> {
  const balance = await this.connection.getBalance(this.tradingWalletKeypair.publicKey);
  return balance / 1e9; // Convert lamports to SOL
}
```

## Database Schema Updates

### New Strategy Configuration Fields

```sql
-- Add new columns to strategies table
ALTER TABLE strategies ADD COLUMN strategy_mode VARCHAR(10) CHECK (strategy_mode IN ('buy', 'sell'));
ALTER TABLE strategies ADD COLUMN auto_restart_after_complete BOOLEAN DEFAULT false;
ALTER TABLE strategies ADD COLUMN cooldown_hours INTEGER DEFAULT 24;
ALTER TABLE strategies ADD COLUMN max_retriggers INTEGER DEFAULT 3;

-- Enhanced levels structure in config JSONB
-- Each level now includes:
-- {
--   "id": "uuid",
--   "type": "limit_buy|stop_loss|take_profit", 
--   "price": 150.0,
--   "usdcAmount": 100.0,           -- for limit_buy
--   "solPercentage": 25.0,         -- for stop_loss/take_profit
--   "executed": false,
--   "executedCount": 0,
--   "executedAt": null,
--   "cooldownUntil": null,
--   "permanentlyDisabled": false,
--   "executionHistory": []
-- }
```

## Frontend Integration

### Strategy Creation UI Flow

1. **Mode Selection**
   - Radio buttons: "BUY Mode" or "SELL Mode"
   - Description of each mode's purpose

2. **Level Configuration**
   - **BUY Mode**: Add limit buy orders
     - Price input
     - USDC amount input
   - **SELL Mode**: Add stop-loss and take-profit orders
     - Price input  
     - SOL percentage slider/input

3. **Strategy Settings**
   - Cooldown hours (default 24)
   - Max retriggers per level (default 3)
   - Auto-restart toggle

4. **Balance Validation**
   - Show current wallet balances
   - Validate sufficient funds for all orders
   - Warning for over-allocation

### Strategy Monitoring UI

- **Level Status Table**
  - Price | Type | Amount | Status | Executions | Next Available
  - Color coding: Pending (blue), Executed (green), Cooling down (yellow), Disabled (red)

- **Performance Metrics**
  - Total P&L
  - Success rate
  - Average execution price vs target price

- **Quick Actions**
  - Pause/Resume strategy
  - Reset all levels
  - Add/Remove individual levels

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Update data structures and types
- [ ] Implement new trigger logic
- [ ] Add balance validation
- [ ] Database schema updates

### Phase 2: Execution Engine  
- [ ] Implement buy/sell order execution
- [ ] Add cooldown system
- [ ] Strategy lifecycle management
- [ ] Performance tracking

### Phase 3: Frontend Integration
- [ ] Strategy creation UI
- [ ] Monitoring dashboard
- [ ] Level management interface
- [ ] Performance analytics

### Phase 4: Advanced Features
- [ ] Portfolio-level allocation limits
- [ ] Advanced order types (trailing stop, etc.)
- [ ] Strategy templates
- [ ] Risk management features

## Risk Management Considerations

1. **Over-Allocation Prevention**
   - Validate total USDC commitment doesn't exceed balance
   - Warn when SOL sell percentages exceed 100% total

2. **Price Slippage Protection**
   - Implement maximum slippage checks
   - Retry logic with increasing slippage tolerance

3. **Failed Transaction Handling**
   - Don't mark level as executed if transaction fails
   - Implement exponential backoff for retries

4. **Strategy Limits**
   - Maximum number of levels per strategy
   - Minimum spacing between price levels
   - Maximum total value at risk

## Testing Strategy

1. **Unit Tests**
   - Trigger logic validation
   - Balance calculation accuracy
   - Cooldown timing

2. **Integration Tests**
   - Full trade execution flow
   - Database state management
   - Error handling scenarios

3. **Simulation Tests**
   - Historical price data replay
   - Performance validation
   - Edge case scenarios

## Future Enhancements

1. **Advanced Order Types**
   - Trailing stop-loss
   - OCO (One-Cancels-Other) orders
   - Time-based orders

2. **Multi-Token Support**
   - Support for other token pairs beyond SOL/USDC
   - Cross-token arbitrage strategies

3. **Portfolio Management**
   - Global allocation limits across all strategies
   - Risk-adjusted position sizing
   - Correlation analysis

4. **Machine Learning Integration**
   - Optimal level placement suggestions
   - Market timing improvements
   - Risk assessment automation 