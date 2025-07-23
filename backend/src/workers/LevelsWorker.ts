import { BaseWorker } from './BaseWorker';
import { LevelsStrategy, Level } from '../types/jobs';
import { PublicKey, Keypair } from '@solana/web3.js';
import { SwapService } from '../services/swap.service';

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';
const MIN_TRADE_AMOUNT = 0.01; // Minimum 0.01 SOL for trades

export class LevelsWorker extends BaseWorker {
  private tradingWalletPublicKey: string;
  private tradingWalletSecretKey: Uint8Array;
  private levels: Level[];
  private tradingWalletKeypair: Keypair;
  private lastCheck: number = 0;
  private checkInterval: number = 60000; // 1 minute
  private swapService: SwapService | null;

  constructor(job: LevelsStrategy, endpoint: string, swapService?: SwapService) {
    super(job, endpoint);
    this.tradingWalletPublicKey = job.tradingWalletPublicKey;
    this.tradingWalletSecretKey = job.tradingWalletSecretKey;
    this.levels = this.validateAndSortLevels(job.levels);
    this.tradingWalletKeypair = Keypair.fromSecretKey(this.tradingWalletSecretKey);
    // SwapService will be injected when needed for actual trading
    this.swapService = swapService || null as any;
  }

  private validateAndSortLevels(levels: Level[]): Level[] {
    const validatedLevels = levels.filter(level => {
      if (level.price <= 0) {
        console.warn(`Invalid negative price level ${level.price} removed`);
        return false;
      }
      if (level.percentage <= 0 || level.percentage > 100) {
        console.warn(`Invalid percentage ${level.percentage}% for level ${level.price} - must be 1-100%`);
        return false;
      }
      return true;
    });
    
    return validatedLevels.sort((a, b) => a.price - b.price);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      this.isRunning = true;
      await this.monitorLevels();
    } catch (error) {
      console.error('Error starting levels monitor:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
  }

  private async monitorLevels(): Promise<void> {
    while (this.isRunning) {
      try {
        const now = Date.now();
        if (now - this.lastCheck >= this.checkInterval) {
          await this.checkLevels();
          this.lastCheck = now;
        }

        // Wait 10 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 10000));
      } catch (error) {
        console.error('Error monitoring levels:', error);
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds on error
      }
    }
  }

  private async checkLevels(): Promise<void> {
    try {
      // Get current SOL price from Jupiter API
      const response = await fetch(`${JUPITER_PRICE_API}?ids=So11111111111111111111111111111111111111112`);
      if (!response.ok) {
        throw new Error(`Failed to fetch SOL price: ${response.statusText}`);
      }
      
      const data = await response.json();
      const priceData = data.data?.['So11111111111111111111111111111111111111112'];
      
      if (!priceData || !priceData.price) {
        throw new Error('Invalid price data received from Jupiter API');
      }
      
      const currentPrice = parseFloat(priceData.price);
      if (isNaN(currentPrice) || currentPrice <= 0) {
        throw new Error(`Invalid SOL price: ${currentPrice}`);
      }

      // Get trading wallet's SOL balance
      const tradingWallet = new PublicKey(this.tradingWalletPublicKey);
      const balance = await this.connection.getBalance(tradingWallet);
      const solBalance = balance / 1e9; // Convert lamports to SOL

      // Find triggered levels
      const lastPrice = (this.job as LevelsStrategy).lastTriggerPrice || 0;
      const triggeredLevels = this.levels.filter(level => {
        // Level is triggered when price crosses it in either direction
        return (currentPrice >= level.price && lastPrice < level.price) ||
               (currentPrice <= level.price && lastPrice > level.price);
      });

      if (triggeredLevels.length > 0) {
        console.log(`Found ${triggeredLevels.length} triggered levels at price $${currentPrice}`);
        
        for (const level of triggeredLevels) {
          await this.executeLevelTrade(level, currentPrice, solBalance);
        }
        
        // Update job status after all trades
        (this.job as LevelsStrategy).lastActivity = new Date().toISOString();
        (this.job as LevelsStrategy).lastTriggerPrice = currentPrice;
      }

    } catch (error) {
      console.error('Error checking levels:', error);
      throw error;
    }
  }

  private async executeLevelTrade(level: Level, currentPrice: number, solBalance: number): Promise<void> {
    try {
      // Calculate amount to trade based on level percentage
      const amountToTrade = (solBalance * level.percentage) / 100;
      
      if (amountToTrade < MIN_TRADE_AMOUNT) {
        console.log(`Trade amount ${amountToTrade} SOL below minimum threshold ${MIN_TRADE_AMOUNT} SOL - skipping`);
        return;
      }
      
      if (amountToTrade > solBalance) {
        console.warn(`Trade amount ${amountToTrade} SOL exceeds balance ${solBalance} SOL - capping at balance`);
        // Cap at available balance minus small buffer for fees
        const cappedAmount = Math.max(0, solBalance - 0.002);
        if (cappedAmount < MIN_TRADE_AMOUNT) {
          console.log('Insufficient balance after fee buffer - skipping trade');
          return;
        }
      }
      
      // Determine trade direction based on price crossing
      const lastPrice = (this.job as LevelsStrategy).lastTriggerPrice || 0;
      const isBuy = currentPrice <= level.price && lastPrice > level.price;
      const isSell = currentPrice >= level.price && lastPrice < level.price;
      
      console.log(`${isBuy ? 'Buying' : 'Selling'} ${amountToTrade} SOL at level ${level.price}`);
      
      if (isBuy) {
        // Buy: Convert SOL to tokens (not implemented - would need token mint)
        console.log('Buy operation: Would convert SOL to tokens (requires token selection)');
      } else if (isSell) {
        // Sell: Convert tokens to SOL (not implemented - would need token balances)
        console.log('Sell operation: Would convert tokens to SOL (requires token balances)');
      }
      
      // Update profit tracking
      const job = this.job as LevelsStrategy;
      job.profitTracking.trades.push({
        timestamp: new Date().toISOString(),
        type: isBuy ? 'buy' : 'sell',
        amount: amountToTrade,
        price: currentPrice,
        profit: 0 // Would be calculated after actual trade execution
      });
      
    } catch (error) {
      console.error(`Error executing trade for level ${level.price}:`, error);
      throw error;
    }
  }
} 