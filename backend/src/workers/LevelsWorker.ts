import { BaseWorker } from './BaseWorker';
import { LevelsStrategy, Level } from '../types/jobs';
import { PublicKey, Keypair } from '@solana/web3.js';
import { SwapService } from '../services/swap.service';
import { tradeEventsService } from '../services/trade-events.service';

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';
const MIN_TRADE_AMOUNT = 0.01; // Minimum 0.01 SOL for trades
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export class LevelsWorker extends BaseWorker {
  private tradingWalletPublicKey: string;
  private tradingWalletSecretKey: Uint8Array;
  private levels: Level[];
  private tradingWalletKeypair: Keypair;
  private lastCheck: number = 0;
  private checkInterval: number = 60000; // 1 minute
  private swapService: SwapService;
  private lastPrice: number = 0; // Track last price to detect crossings

  constructor(job: LevelsStrategy, endpoint: string, swapService: SwapService) {
    super(job, endpoint);
    this.tradingWalletPublicKey = job.tradingWalletPublicKey;
    this.tradingWalletSecretKey = job.tradingWalletSecretKey;
    this.levels = this.validateAndSortLevels(job.levels);
    this.tradingWalletKeypair = Keypair.fromSecretKey(this.tradingWalletSecretKey);
    this.swapService = swapService;
    
    console.log(`[Levels] Worker initialized with ${this.levels.length} levels for wallet ${this.tradingWalletPublicKey}`);
    this.levels.forEach(level => {
      console.log(`[Levels] Level: $${level.price} USD → Sell ${level.percentage}% of SOL`);
    });
  }

  private validateAndSortLevels(levels: Level[]): Level[] {
    const validatedLevels = levels.filter(level => {
      if (level.price <= 0) {
        console.warn(`[Levels] Invalid negative price level ${level.price} removed`);
        return false;
      }
      if (level.percentage <= 0 || level.percentage > 100) {
        console.warn(`[Levels] Invalid percentage ${level.percentage}% for level ${level.price} - must be 1-100%`);
        return false;
      }
      return true;
    });
    
    // Sort levels by price (descending for sell levels)
    return validatedLevels.sort((a, b) => b.price - a.price);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      this.isRunning = true;
      console.log(`[Levels] Starting levels monitoring for wallet ${this.tradingWalletPublicKey}`);
      await this.monitorLevels();
    } catch (error) {
      console.error('[Levels] Error starting levels monitor:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log(`[Levels] Stopped levels monitoring for wallet ${this.tradingWalletPublicKey}`);
  }

  private async monitorLevels(): Promise<void> {
    while (this.isRunning) {
      try {
        const now = Date.now();
        if (now - this.lastCheck >= this.checkInterval) {
          await this.checkLevels();
          this.lastCheck = now;
        }

        // Wait 30 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 30000));
      } catch (error) {
        console.error('[Levels] Error monitoring levels:', error);
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute on error
      }
    }
  }

  private async checkLevels(): Promise<void> {
    try {
      // Get current SOL price from Jupiter API
      const response = await fetch(`${JUPITER_PRICE_API}?ids=${SOL_MINT}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch SOL price: ${response.statusText}`);
      }
      
      const data = await response.json();
      const priceData = data.data?.[SOL_MINT];
      
      if (!priceData || !priceData.price) {
        throw new Error('Invalid price data received from Jupiter API');
      }
      
      const currentPrice = parseFloat(priceData.price);
      if (isNaN(currentPrice) || currentPrice <= 0) {
        throw new Error(`Invalid SOL price: ${currentPrice}`);
      }

      console.log(`[Levels] Current SOL price: $${currentPrice} (Previous: $${this.lastPrice})`);

      // Get trading wallet's SOL balance
      const tradingWallet = new PublicKey(this.tradingWalletPublicKey);
      const balance = await this.connection.getBalance(tradingWallet);
      const solBalance = balance / 1e9; // Convert lamports to SOL

      console.log(`[Levels] Trading wallet SOL balance: ${solBalance} SOL`);

      // Find triggered levels (price crossed below or equal to level)
      const triggeredLevels = this.levels.filter(level => {
        // Only trigger when price crosses DOWN to or below the level
        // (this.lastPrice > level.price && currentPrice <= level.price) - crossed down through level
        // (currentPrice <= level.price && this.lastPrice === 0) - first check and already below level
        return (this.lastPrice > level.price && currentPrice <= level.price) ||
               (currentPrice <= level.price && this.lastPrice === 0);
      });

      if (triggeredLevels.length > 0) {
        console.log(`[Levels] 🎯 Found ${triggeredLevels.length} triggered levels at price $${currentPrice}`);
        
        for (const level of triggeredLevels) {
          await this.executeLevelSell(level, currentPrice, solBalance);
        }
      }

      // Update last price for next comparison
      this.lastPrice = currentPrice;

    } catch (error) {
      console.error('[Levels] Error checking levels:', error);
      throw error;
    }
  }

  private async executeLevelSell(level: Level, currentPrice: number, solBalance: number): Promise<void> {
    try {
      console.log(`[Levels] 📉 Level triggered: $${level.price} (Current: $${currentPrice})`);
      console.log(`[Levels] Executing sell: ${level.percentage}% of ${solBalance} SOL → USDC`);
      
      // Calculate amount to sell based on level percentage
      const amountToSell = (solBalance * level.percentage) / 100;
      
      if (amountToSell < MIN_TRADE_AMOUNT) {
        console.log(`[Levels] ⚠️ Amount ${amountToSell} SOL below minimum threshold ${MIN_TRADE_AMOUNT} SOL - skipping`);
        return;
      }

      // Ensure we leave enough SOL for transaction fees
      const maxSellAmount = Math.max(0, solBalance - 0.01); // Leave 0.01 SOL for fees
      const finalAmount = Math.min(amountToSell, maxSellAmount);
      
      if (finalAmount <= 0) {
        console.log(`[Levels] ⚠️ Insufficient SOL balance for trade after fee buffer - skipping`);
        return;
      }

      console.log(`[Levels] 💰 Selling ${finalAmount} SOL to USDC at level $${level.price}`);

      // Convert SOL amount to lamports for SwapService
      const amountInLamports = Math.floor(finalAmount * 1e9);

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

      console.log(`[Levels] ✅ Level trade completed successfully: ${swapResult.signature}`);
      
      // Update profit tracking
      const job = this.job as LevelsStrategy;
      job.profitTracking.trades.push({
        timestamp: new Date().toISOString(),
        type: 'sell',
        amount: finalAmount,
        price: currentPrice,
        profit: 0 // Will be calculated when we have historical data
      });

      // Update job activity
      job.lastActivity = new Date().toISOString();

      // Emit trade success event for vault strategies to monitor
      tradeEventsService.emitTradeSuccess({
        strategyId: this.job.id,
        tradingWalletAddress: this.tradingWalletKeypair.publicKey.toString(),
        strategyType: 'levels',
        signature: swapResult.signature,
        timestamp: new Date().toISOString(),
        amount: finalAmount
      });
      
    } catch (error) {
      console.error(`[Levels] ❌ Error executing sell for level ${level.price}:`, error);
      throw error;
    }
  }
} 