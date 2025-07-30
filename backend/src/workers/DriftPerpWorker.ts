import { BaseWorker } from './BaseWorker';
import { DriftPerpJob, DriftPerpPosition } from '../types/jobs';
import { DriftService, DriftPositionInfo } from '../services/DriftService';
import { TokenService } from '../services/TokenService';
import { createRateLimitedConnection } from '../utils/connection';
import { Pool } from 'pg';
import { 
  PublicKey, 
  Keypair, 
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction
} from '@solana/spl-token';
import { tradeEventsService } from '../services/trade-events.service';

export class DriftPerpWorker extends BaseWorker {
  private tradingWalletKeypair: Keypair;
  private driftService: DriftService;
  private tokenService: TokenService;
  private pool: Pool;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isProcessingOrder: boolean = false;
  private readonly MONITORING_INTERVAL_MS = 5000; // 5 seconds
  private readonly USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  constructor(job: DriftPerpJob, endpoint: string, tokenService: TokenService, pool: Pool) {
    super(job, endpoint);
    this.tokenService = tokenService;
    this.pool = pool;
    
    // Initialize trading wallet keypair
    this.tradingWalletKeypair = Keypair.fromSecretKey(job.tradingWalletSecretKey);
    
    // Initialize Drift service
    this.driftService = new DriftService(endpoint);
    
    console.log(`DriftPerpWorker initialized for ${job.marketSymbol} market`);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      // Create connection
      this.connection = createRateLimitedConnection('https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a');
      
      // Initialize Drift client
      await this.driftService.initialize(this.tradingWalletKeypair);
      
      // Setup initial collateral if needed
      await this.setupInitialCollateral();
      
      // Start monitoring loop
      this.startMonitoring();
      
      this.isRunning = true;
      console.log(`DriftPerpWorker started for strategy ${this.job.id}`);
    } catch (error) {
      console.error('Error starting DriftPerpWorker:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    // Cleanup Drift service
    await this.driftService.cleanup();
    
    this.isRunning = false;
    console.log(`DriftPerpWorker stopped for strategy ${this.job.id}`);
  }

  /**
   * Execute the perpetual strategy
   */
  async executeStrategy(): Promise<{
    success: boolean;
    action?: 'opened' | 'closed' | 'none';
    signature?: string;
    error?: string;
  }> {
    if (this.isProcessingOrder) {
      return { success: false, error: 'Order already in progress' };
    }

    this.isProcessingOrder = true;
    
    try {
      const job = this.job as DriftPerpJob;
      
      // Get current market price
      const currentPrice = await this.driftService.getMarketPrice(job.marketIndex);
      
      // Get current position
      const currentPosition = await this.driftService.getCurrentPosition(job.marketIndex);
      
      // Update job position info
      if (currentPosition) {
        job.currentPosition = this.convertDriftPositionToJob(currentPosition, currentPrice);
        job.isPositionOpen = true;
      } else {
        job.currentPosition = undefined;
        job.isPositionOpen = false;
      }

      // Decision logic
      if (!job.isPositionOpen) {
        // Check if we should open a position
        if (this.shouldOpenPosition(currentPrice, job)) {
          return await this.openPosition(currentPrice);
        }
      } else {
        // Check if we should close the position
        if (this.shouldClosePosition(currentPrice, job)) {
          return await this.closePosition(currentPrice);
        }
      }

      return { success: true, action: 'none' };
    } catch (error) {
      console.error('[DriftPerp] Error executing strategy:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    } finally {
      this.isProcessingOrder = false;
    }
  }

  /**
   * Get current status of the strategy
   */
  async getStatus(): Promise<{
    isPositionOpen: boolean;
    currentPosition?: DriftPerpPosition;
    currentPrice: number;
    accountInfo: {
      totalCollateral: number;
      freeCollateral: number;
      marginRatio: number;
      leverage: number;
      unrealizedPnl: number;
    };
    marketSymbol: string;
    entryPrice: number;
    exitPrice: number;
    isProcessingOrder: boolean;
  }> {
    const job = this.job as DriftPerpJob;
    
    try {
      const currentPrice = await this.driftService.getMarketPrice(job.marketIndex);
      const accountInfo = await this.driftService.getAccountInfo();
      
      return {
        isPositionOpen: job.isPositionOpen,
        currentPosition: job.currentPosition,
        currentPrice,
        accountInfo,
        marketSymbol: job.marketSymbol,
        entryPrice: job.entryPrice,
        exitPrice: job.exitPrice,
        isProcessingOrder: this.isProcessingOrder
      };
    } catch (error) {
      console.error('[DriftPerp] Error getting status:', error);
      throw error;
    }
  }

  /**
   * Force close position (emergency close)
   */
  async forceClosePosition(): Promise<{
    success: boolean;
    signature?: string;
    error?: string;
  }> {
    const job = this.job as DriftPerpJob;
    
    if (!job.isPositionOpen) {
      return { success: false, error: 'No position to close' };
    }

    try {
      const result = await this.driftService.closePosition(job.marketIndex);
      
      if (result.success) {
        // Update job state
        const currentPrice = await this.driftService.getMarketPrice(job.marketIndex);
        await this.recordPositionClose('force_close', currentPrice, result.signature!);
        
        job.isPositionOpen = false;
        job.currentPosition = undefined;
        this.updateJobActivity();
      }
      
      return result;
    } catch (error) {
      console.error('[DriftPerp] Error force closing position:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Private methods

  /**
   * Start the monitoring loop
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      if (!this.isRunning || this.isProcessingOrder) return;
      
      try {
        await this.executeStrategy();
      } catch (error) {
        console.error('[DriftPerp] Error in monitoring loop:', error);
      }
    }, this.MONITORING_INTERVAL_MS);
  }

  /**
   * Setup initial USDC collateral
   */
  private async setupInitialCollateral(): Promise<void> {
    const job = this.job as DriftPerpJob;
    
    try {
      // Calculate SOL to convert to USDC for collateral
      const solBalance = await this.connection.getBalance(this.tradingWalletKeypair.publicKey);
      const solToUse = Math.floor(solBalance * (job.allocationPercentage / 100));
      
      if (solToUse <= 0.1 * LAMPORTS_PER_SOL) {
        console.warn('[DriftPerp] Insufficient SOL balance for collateral setup');
        return;
      }

      // Check current account info
      const accountInfo = await this.driftService.getAccountInfo();
      
      // If we already have sufficient collateral, skip setup
      if (accountInfo.totalCollateral >= (solToUse / LAMPORTS_PER_SOL) * 0.8) {
        console.log('[DriftPerp] Sufficient collateral already available');
        return;
      }

      console.log(`[DriftPerp] Setting up collateral: ${solToUse / LAMPORTS_PER_SOL} SOL worth`);
      
      // For simplicity, we'll assume the user manually provides USDC
      // In a production system, you'd want to swap SOL -> USDC via Jupiter
      console.log('[DriftPerp] Note: Manual USDC collateral deposit required');
      
    } catch (error) {
      console.error('[DriftPerp] Error setting up collateral:', error);
    }
  }

  /**
   * Check if we should open a position
   */
  private shouldOpenPosition(currentPrice: number, job: DriftPerpJob): boolean {
    // Open position if current price hits entry price
    if (job.direction === 'long') {
      return currentPrice <= job.entryPrice;
    } else {
      return currentPrice >= job.entryPrice;
    }
  }

  /**
   * Check if we should close a position
   */
  private shouldClosePosition(currentPrice: number, job: DriftPerpJob): boolean {
    if (!job.currentPosition) return false;

    // Close at exit price
    if (job.direction === 'long') {
      if (currentPrice >= job.exitPrice) return true;
    } else {
      if (currentPrice <= job.exitPrice) return true;
    }

    // Close at stop loss if set
    if (job.stopLoss) {
      if (job.direction === 'long' && currentPrice <= job.stopLoss) return true;
      if (job.direction === 'short' && currentPrice >= job.stopLoss) return true;
    }

    // Close at take profit if set
    if (job.takeProfit) {
      if (job.direction === 'long' && currentPrice >= job.takeProfit) return true;
      if (job.direction === 'short' && currentPrice <= job.takeProfit) return true;
    }

    return false;
  }

  /**
   * Open a perpetual position
   */
  private async openPosition(currentPrice: number): Promise<{
    success: boolean;
    action: 'opened';
    signature?: string;
    error?: string;
  }> {
    const job = this.job as DriftPerpJob;
    
    try {
      // Calculate position size based on allocation and leverage
      const accountInfo = await this.driftService.getAccountInfo();
      const maxPositionValue = accountInfo.freeCollateral * job.leverage;
      const positionSize = maxPositionValue / currentPrice;
      
      console.log(`[DriftPerp] Opening ${job.direction} position: ${positionSize} units at $${currentPrice}`);
      
      const result = await this.driftService.openPosition(
        job.marketIndex,
        job.direction,
        positionSize,
        job.entryPrice // Use limit order at entry price
      );
      
      if (result.success) {
        // Record the position opening
        await this.recordPositionOpen(currentPrice, positionSize, result.signature!);
        
        // Update job state
        job.isPositionOpen = true;
        job.lastActivityTimestamp = new Date().toISOString();
        this.updateJobActivity();
        
        console.log(`[DriftPerp] Position opened successfully: ${result.signature}`);
        
        // Emit trade success event for vault strategies to monitor
        if (result.signature) {
          tradeEventsService.emitTradeSuccess({
            strategyId: this.job.id,
            tradingWalletAddress: this.tradingWalletKeypair.publicKey.toString(),
            strategyType: 'drift-perp',
            signature: result.signature,
            timestamp: new Date().toISOString(),
            amount: positionSize
          });
        }
      }
      
      return {
        success: result.success,
        action: 'opened',
        signature: result.signature,
        error: result.error
      };
    } catch (error) {
      console.error('[DriftPerp] Error opening position:', error);
      return {
        success: false,
        action: 'opened',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Close a perpetual position
   */
  private async closePosition(currentPrice: number): Promise<{
    success: boolean;
    action: 'closed';
    signature?: string;
    error?: string;
  }> {
    const job = this.job as DriftPerpJob;
    
    try {
      console.log(`[DriftPerp] Closing position at $${currentPrice}`);
      
      const result = await this.driftService.closePosition(
        job.marketIndex,
        job.exitPrice // Use limit order at exit price
      );
      
      if (result.success) {
        // Record the position closing
        await this.recordPositionClose('exit_price', currentPrice, result.signature!);
        
        // Update job state
        job.isPositionOpen = false;
        job.currentPosition = undefined;
        job.lastActivityTimestamp = new Date().toISOString();
        this.updateJobActivity();
        
        console.log(`[DriftPerp] Position closed successfully: ${result.signature}`);
        
        // Emit trade success event for vault strategies to monitor
        if (result.signature) {
          tradeEventsService.emitTradeSuccess({
            strategyId: this.job.id,
            tradingWalletAddress: this.tradingWalletKeypair.publicKey.toString(),
            strategyType: 'drift-perp',
            signature: result.signature,
            timestamp: new Date().toISOString()
          });
        }
      }
      
      return {
        success: result.success,
        action: 'closed',
        signature: result.signature,
        error: result.error
      };
    } catch (error) {
      console.error('[DriftPerp] Error closing position:', error);
      return {
        success: false,
        action: 'closed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Record position opening in history
   */
  private async recordPositionOpen(price: number, size: number, signature: string): Promise<void> {
    const job = this.job as DriftPerpJob;
    
    job.orderHistory.push({
      timestamp: new Date().toISOString(),
      type: 'open',
      direction: job.direction,
      size,
      price,
      signature
    });
  }

  /**
   * Record position closing in history
   */
  private async recordPositionClose(reason: string, price: number, signature: string): Promise<void> {
    const job = this.job as DriftPerpJob;
    
    if (job.currentPosition) {
      // Calculate PnL
      const entryPrice = job.currentPosition.entryPrice;
      const size = job.currentPosition.baseAssetAmount;
      let pnl = 0;
      
      if (job.direction === 'long') {
        pnl = (price - entryPrice) * size;
      } else {
        pnl = (entryPrice - price) * size;
      }
      
      job.orderHistory.push({
        timestamp: new Date().toISOString(),
        type: 'close',
        direction: job.direction,
        size,
        price,
        pnl,
        signature
      });

      // Move current position to history
      job.positionHistory.push({
        ...job.currentPosition,
        currentPrice: price,
        unrealizedPnl: pnl
      });
    }
  }

  /**
   * Convert Drift position info to job position format
   */
  private convertDriftPositionToJob(driftPosition: DriftPositionInfo, currentPrice: number): DriftPerpPosition {
    return {
      timestamp: new Date().toISOString(),
      marketIndex: driftPosition.marketIndex,
      direction: driftPosition.direction === 0 ? 'long' : 'short', // 0 = Long, 1 = Short in Drift
      baseAssetAmount: parseFloat(driftPosition.baseAssetAmount.toString()) / 1e6,
      quoteAssetAmount: parseFloat(driftPosition.quoteAssetAmount.toString()) / 1e6,
      entryPrice: parseFloat(driftPosition.entryPrice.toString()) / 1e6,
      currentPrice,
      unrealizedPnl: parseFloat(driftPosition.unrealizedPnl.toString()) / 1e6,
      leverage: driftPosition.leverage,
      liquidationPrice: parseFloat(driftPosition.liquidationPrice.toString()) / 1e6,
      marginRatio: driftPosition.marginRatio
    };
  }

  /**
   * Update job activity timestamp
   */
  private updateJobActivity(): void {
    if (this.job) {
      this.job.lastActivity = new Date().toISOString();
    }
  }
}