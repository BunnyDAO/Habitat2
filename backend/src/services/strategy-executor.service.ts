import { Pool } from 'pg';
import { createClient } from 'redis';
import { HeliusService } from './helius.service';
import { Strategy, DCAConfig, GridConfig } from '../types/strategy';

export class StrategyExecutorService {
  private pool: Pool;
  private redisClient: ReturnType<typeof createClient> | null;
  private heliusService: HeliusService;
  private isRunning: boolean = false;
  private updateInterval: number = 60000; // 1 minute

  constructor(pool: Pool, redisClient: ReturnType<typeof createClient> | null, heliusService: HeliusService) {
    this.pool = pool;
    this.redisClient = redisClient;
    this.heliusService = heliusService;
  }

  async start() {
    if (this.isRunning) {
      console.log('Strategy executor service is already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting strategy executor service...');

    while (this.isRunning) {
      try {
        // Get all active strategies from the database
        const strategies = await this.getActiveStrategies();
        
        // Execute each strategy
        for (const strategy of strategies) {
          await this.executeStrategy(strategy);
        }

        // Wait for next update interval
        await new Promise(resolve => setTimeout(resolve, this.updateInterval));
      } catch (error) {
        console.error('Error in strategy executor service:', error);
        // Wait before retrying on error
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  stop() {
    this.isRunning = false;
    console.log('Stopping strategy executor service...');
  }

  private async getActiveStrategies() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT s.*, tw.wallet_pubkey
        FROM strategies s
        JOIN trading_wallets tw ON s.trading_wallet_id = tw.id
        WHERE s.is_active = true
      `);
      return result.rows;
    } finally {
      client.release();
    }
  }

  private async executeStrategy(strategy: Strategy & { wallet_pubkey: string }) {
    try {
      // Parse strategy configuration
      const config = JSON.parse(strategy.config);
      
      // Execute strategy based on type
      switch (strategy.strategyType) {
        case 'DCA':
          await this.executeDCAStrategy(strategy, config as DCAConfig);
          break;
        case 'GRID':
          await this.executeGridStrategy(strategy, config as GridConfig);
          break;
        // Add more strategy types as needed
        default:
          console.warn(`Unknown strategy type: ${strategy.strategyType}`);
      }
    } catch (error) {
      console.error(`Error executing strategy ${strategy.id}:`, error);
    }
  }

  private async executeDCAStrategy(strategy: Strategy & { wallet_pubkey: string }, config: DCAConfig) {
    // Get current token price
    const currentPrice = await this.getTokenPrice(config.parameters.tokenMint);
    
    // Check if price is within bounds
    if (config.parameters.maxPrice && currentPrice > config.parameters.maxPrice) {
      console.log(`Price ${currentPrice} above max price ${config.parameters.maxPrice}, skipping DCA`);
      return;
    }
    if (config.parameters.minPrice && currentPrice < config.parameters.minPrice) {
      console.log(`Price ${currentPrice} below min price ${config.parameters.minPrice}, skipping DCA`);
      return;
    }

    // Execute DCA trade
    console.log(`Executing DCA strategy for wallet ${strategy.wallet_pubkey}`);
    // TODO: Implement actual trade execution
  }

  private async executeGridStrategy(strategy: Strategy & { wallet_pubkey: string }, config: GridConfig) {
    // Get current token price
    const currentPrice = await this.getTokenPrice(config.parameters.tokenMint);
    
    // Calculate grid levels
    const priceRange = config.parameters.upperPrice - config.parameters.lowerPrice;
    const gridStep = priceRange / config.parameters.gridSize;
    
    // Find current grid level
    const currentGridLevel = Math.floor((currentPrice - config.parameters.lowerPrice) / gridStep);
    
    console.log(`Executing Grid strategy for wallet ${strategy.wallet_pubkey} at grid level ${currentGridLevel}`);
    // TODO: Implement actual trade execution
  }

  private async getTokenPrice(tokenMint: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT current_price_usd
        FROM token_prices
        WHERE mint_address = $1
      `, [tokenMint]);
      
      if (result.rows.length === 0) {
        throw new Error(`No price found for token ${tokenMint}`);
      }
      
      return result.rows[0].current_price_usd;
    } finally {
      client.release();
    }
  }
} 