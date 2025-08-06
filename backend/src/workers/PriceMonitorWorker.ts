import { BaseWorker } from './BaseWorker';
import { PriceMonitoringJob } from '../types/jobs';
import { 
  PublicKey, 
  TransactionMessage, 
  VersionedTransaction, 
  TransactionInstruction,
  Keypair,
  Connection
} from '@solana/web3.js';
import { SwapService } from '../services/swap.service';
import { tradeEventsService } from '../services/trade-events.service';
import { createClient } from '@supabase/supabase-js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_FEE_ACCOUNT = '5PkZKoYHDoNwThvqdM5U35ACcYdYrT4ZSQdU2bY3iqKV';

// Initialize Supabase client for database updates
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export class PriceMonitorWorker extends BaseWorker {
  private lastTriggered: number = 0;
  private tradingWalletKeypair: Keypair;
  private tradingWalletPublicKey: string;
  private targetPrice: number;
  private direction: 'above' | 'below';
  private percentageToSell: number;
  private swapService: SwapService;
  private strategyCompleted: boolean = false;
  
  // Rate limiting
  private readonly MIN_TIME_BETWEEN_TRIGGERS = 300000; // 5 minutes
  private readonly CHECK_INTERVAL = 60000; // 1 minute

  constructor(job: PriceMonitoringJob, endpoint: string, swapService: SwapService) {
    super(job, endpoint);
    
    this.tradingWalletKeypair = Keypair.fromSecretKey(job.tradingWalletSecretKey);
    this.tradingWalletPublicKey = job.tradingWalletPublicKey;
    this.targetPrice = job.targetPrice;
    this.direction = job.direction;
    this.percentageToSell = job.percentageToSell;
    this.swapService = swapService;

    console.log(`[PriceMonitor] Initialized for wallet ${this.tradingWalletPublicKey}`);
    console.log(`[PriceMonitor] Target: ${this.direction} $${this.targetPrice}, sell ${this.percentageToSell}% SOL`);
  }

  /**
   * Check if strategy is currently active in the database
   * This ensures we always have the most up-to-date status
   */
  private async isStrategyActive(): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('strategies')
        .select('is_active')
        .eq('id', this.job.id)
        .single();

      if (error) {
        console.error(`[PriceMonitor] Error checking strategy ${this.job.id} active status:`, error);
        // If we can't check the database, be conservative and return false
        return false;
      }

      return data?.is_active === true;
    } catch (error) {
      console.error(`[PriceMonitor] Exception checking strategy ${this.job.id} active status:`, error);
      // If we can't check the database, be conservative and return false
      return false;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      this.isRunning = true;
      await this.monitorPrice();
    } catch (error) {
      console.error('[PriceMonitor] Error starting price monitor:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log(`[PriceMonitor] Stopped price monitoring for wallet ${this.tradingWalletPublicKey}`);
  }

  private async monitorPrice(): Promise<void> {
    while (this.isRunning && !this.strategyCompleted) {
      try {
        // Get current SOL price using the backend price service endpoint
        const response = await fetch('http://habitat2-backend-1:3001/api/v1/price/SOL');
        if (!response.ok) {
          throw new Error(`Failed to fetch SOL price from backend: ${response.statusText}`);
        }

        const data = await response.json();
        const currentPrice = parseFloat(data.price);
        
        if (!currentPrice || isNaN(currentPrice)) {
          throw new Error('Invalid price data received from backend');
        }
        console.log(`[PriceMonitor] Current SOL price: $${currentPrice} (Target: ${this.direction} $${this.targetPrice})`);

        // Check if price condition is met
        const priceConditionMet = 
          (this.direction === 'above' && currentPrice >= this.targetPrice) ||
          (this.direction === 'below' && currentPrice <= this.targetPrice);

        if (priceConditionMet) {
          // Check if strategy is active before executing trades
          // Query the database to get the current status (not the stale in-memory value)
          const isActive = await this.isStrategyActive();
          if (!isActive) {
            console.log(`[PriceMonitor] Price condition triggered but strategy is not active (database is_active=false). Skipping trade.`);
            return;
          }

          // Check rate limiting
          const now = Date.now();
          if (now - this.lastTriggered < this.MIN_TIME_BETWEEN_TRIGGERS) {
            const remainingTime = Math.ceil((this.MIN_TIME_BETWEEN_TRIGGERS - (now - this.lastTriggered)) / 1000);
            console.log(`[PriceMonitor] Price condition met but rate limited. ${remainingTime}s remaining.`);
          } else {
            console.log(`[PriceMonitor] 🎯 Price condition triggered: $${currentPrice} is ${this.direction} $${this.targetPrice}`);
            await this.executeTrade(currentPrice);
            this.lastTriggered = now;
            // Auto-pause strategy after successful trade
            this.strategyCompleted = true;
            console.log(`[PriceMonitor] ✅ Strategy completed successfully. Auto-pausing to prevent spam trades.`);
            
            // Update database to deactivate strategy
            await this.deactivateStrategy();
          }
        }

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, this.CHECK_INTERVAL));
      } catch (error) {
        console.error('[PriceMonitor] Error in price monitoring loop:', error);
        await new Promise(resolve => setTimeout(resolve, this.CHECK_INTERVAL * 2)); // Wait longer on error
      }
    }

    if (this.strategyCompleted) {
      console.log(`[PriceMonitor] Strategy completed. Stopping worker.`);
      await this.stop();
    }
  }

  private async deactivateStrategy(): Promise<void> {
    try {
      console.log(`[PriceMonitor] 🗃️ Deactivating strategy ${this.job.id} in database...`);
      
      const { error } = await supabase
        .from('strategies')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString() 
        })
        .eq('id', this.job.id);

      if (error) {
        console.error('[PriceMonitor] ❌ Failed to deactivate strategy in database:', error);
        throw error;
      }

      console.log(`[PriceMonitor] ✅ Strategy ${this.job.id} successfully deactivated in database`);
    } catch (error) {
      console.error('[PriceMonitor] ❌ Error deactivating strategy:', error);
      // Don't throw - we want the worker to stop even if DB update fails
    }
  }

  private async executeTrade(currentPrice: number): Promise<void> {
    try {
      // Get trading wallet's SOL balance
      const tradingWallet = new PublicKey(this.tradingWalletPublicKey);
      const balance = await this.connection.getBalance(tradingWallet);
      const solBalance = balance / 1e9; // Convert lamports to SOL

      // Check SOL balance for fees
      if (balance < 10000) { // ~0.00001 SOL for fees
        throw new Error('Insufficient SOL balance for transaction fees');
      }

      // Calculate amount to swap (in UI format for SwapService)
      const amountToSwap = (solBalance * this.percentageToSell) / 100;

      if (amountToSwap <= 0 || amountToSwap >= solBalance - 0.00001) {
        throw new Error('Invalid swap amount or insufficient balance');
      }

      console.log(`[PriceMonitor] 💰 Executing trade: ${amountToSwap} SOL → USDC at $${currentPrice}`);

      // Execute swap using SwapService (pass UI amount, not lamports)
      const swapResult = await this.swapService.executeSwap({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: amountToSwap, // UI amount (not lamports)
        slippageBps: 100, // 1% default slippage
        walletKeypair: {
          publicKey: this.tradingWalletKeypair.publicKey.toString(),
          secretKey: Array.from(this.tradingWalletKeypair.secretKey)
        },
        feeWalletPubkey: JUPITER_FEE_ACCOUNT // Updated fee account
      });

      console.log(`[PriceMonitor] ✅ Trade executed successfully: ${swapResult.signature}`);

      // Update profit tracking
      const profit = currentPrice * amountToSwap - amountToSwap;
      (this.job as PriceMonitoringJob).profitTracking.trades.push({
        timestamp: new Date().toISOString(),
        type: 'sell',
        amount: amountToSwap,
        price: currentPrice,
        profit
      });

      // Emit trade success event for vault strategies to monitor
      tradeEventsService.emitTradeSuccess({
        strategyId: this.job.id,
        tradingWalletAddress: this.tradingWalletKeypair.publicKey.toString(),
        strategyType: 'price-monitor',
        signature: swapResult.signature,
        timestamp: new Date().toISOString(),
        amount: amountToSwap,
        profit
      });

    } catch (error) {
      console.error('[PriceMonitor] Error executing trade:', error);
      throw error;
    }
  }
} 