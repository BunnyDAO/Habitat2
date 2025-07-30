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

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export class PriceMonitorWorker extends BaseWorker {
  private lastTriggered: number = 0;
  private tradingWalletKeypair: Keypair;
  private tradingWalletPublicKey: string;
  private targetPrice: number;
  private direction: 'above' | 'below';
  private percentageToSell: number;
  private swapService: SwapService;
  
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
    while (this.isRunning) {
      try {
        // Get current SOL price from Jupiter API
        const response = await fetch('https://price.jup.ag/v4/price?ids=So11111111111111111111111111111111111111112');
        if (!response.ok) {
          throw new Error(`Failed to fetch SOL price: ${response.statusText}`);
        }

        const data = await response.json();
        const priceData = data.data?.['So11111111111111111111111111111111111111112'];
        
        if (!priceData || !priceData.price) {
          throw new Error('Invalid price data received');
        }

        const currentPrice = parseFloat(priceData.price);
        console.log(`[PriceMonitor] Current SOL price: $${currentPrice} (Target: ${this.direction} $${this.targetPrice})`);

        // Check if price condition is met
        const priceConditionMet = 
          (this.direction === 'above' && currentPrice >= this.targetPrice) ||
          (this.direction === 'below' && currentPrice <= this.targetPrice);

        if (priceConditionMet) {
          // Check rate limiting
          const now = Date.now();
          if (now - this.lastTriggered < this.MIN_TIME_BETWEEN_TRIGGERS) {
            const remainingTime = Math.ceil((this.MIN_TIME_BETWEEN_TRIGGERS - (now - this.lastTriggered)) / 1000);
            console.log(`[PriceMonitor] Price condition met but rate limited. ${remainingTime}s remaining.`);
          } else {
            console.log(`[PriceMonitor] 🎯 Price condition triggered: $${currentPrice} is ${this.direction} $${this.targetPrice}`);
            await this.executeTrade(currentPrice);
            this.lastTriggered = now;
          }
        }

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, this.CHECK_INTERVAL));
      } catch (error) {
        console.error('[PriceMonitor] Error in price monitoring loop:', error);
        await new Promise(resolve => setTimeout(resolve, this.CHECK_INTERVAL * 2)); // Wait longer on error
      }
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

      // Calculate amount to swap
      const amountToSwap = (solBalance * this.percentageToSell) / 100;
      const amountInLamports = Math.floor(amountToSwap * 1e9);

      if (amountInLamports <= 0 || amountInLamports >= balance - 10000) {
        throw new Error('Invalid swap amount or insufficient balance');
      }

      console.log(`[PriceMonitor] 💰 Executing trade: ${amountToSwap} SOL → USDC at $${currentPrice}`);

      // Execute swap using SwapService
      const swapResult = await this.swapService.executeSwap({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: amountInLamports,
        slippageBps: 100, // 1% default slippage
        walletKeypair: {
          publicKey: this.tradingWalletKeypair.publicKey.toString(),
          secretKey: Array.from(this.tradingWalletKeypair.secretKey)
        },
        feeWalletPubkey: '2yrLVmLcMyZyKaV8cZKkk79zuvMPqhVjLMWkQFQtj4g6' // Jupiter fee account
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