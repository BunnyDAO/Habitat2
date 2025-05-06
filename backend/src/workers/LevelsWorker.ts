import { BaseWorker } from './BaseWorker';
import { LevelsStrategy, Level } from '../types/jobs';
import { PublicKey, Keypair } from '@solana/web3.js';

const JUPITER_API_BASE = 'https://api.jup.ag/swap/v1';

export class LevelsWorker extends BaseWorker {
  private tradingWalletPublicKey: string;
  private tradingWalletSecretKey: Uint8Array;
  private levels: Level[];
  private tradingWalletKeypair: Keypair;
  private lastCheck: number = 0;
  private checkInterval: number = 60000; // 1 minute

  constructor(job: LevelsStrategy, endpoint: string) {
    super(job, endpoint);
    this.tradingWalletPublicKey = job.tradingWalletPublicKey;
    this.tradingWalletSecretKey = job.tradingWalletSecretKey;
    this.levels = job.levels.sort((a, b) => a.price - b.price); // Sort levels by price
    this.tradingWalletKeypair = Keypair.fromSecretKey(this.tradingWalletSecretKey);
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
      const response = await fetch(`${JUPITER_API_BASE}/price?ids=SOL`);
      const data = await response.json();
      const currentPrice = data.SOL;

      // Get trading wallet's SOL balance
      const tradingWallet = new PublicKey(this.tradingWalletPublicKey);
      const balance = await this.connection.getBalance(tradingWallet);
      const solBalance = balance / 1e9; // Convert lamports to SOL

      // Find triggered levels
      const triggeredLevels = this.levels.filter(level => {
        const lastPrice = (this.job as LevelsStrategy).lastTriggerPrice || 0;
        
        // Level is triggered when price crosses it in either direction
        return (currentPrice >= level.price && lastPrice < level.price) ||
               (currentPrice <= level.price && lastPrice > level.price);
      });

      if (triggeredLevels.length > 0) {
        console.log(`Found ${triggeredLevels.length} triggered levels at price $${currentPrice}`);
        
        for (const level of triggeredLevels) {
          // Calculate amount to trade based on level percentage
          const amountToTrade = (solBalance * level.percentage) / 100;
          
          if (amountToTrade > 0.01) { // Only trade if amount is significant
            // Determine trade direction
            const isBuy = currentPrice <= level.price;
            console.log(`${isBuy ? 'Buying' : 'Selling'} ${amountToTrade} SOL at level ${level.price}`);
            
            // TODO: Implement trade execution using Jupiter API
            // This would be similar to PriceMonitorWorker's executeTrade method
            
            // Update job status
            (this.job as LevelsStrategy).lastActivity = new Date().toISOString();
            (this.job as LevelsStrategy).lastTriggerPrice = currentPrice;
          }
        }
      }

    } catch (error) {
      console.error('Error checking levels:', error);
      throw error;
    }
  }
} 