import { 
  DriftClient, 
  User, 
  Wallet, 
  initialize,
  MarketType,
  PositionDirection,
  OrderType,
  OrderParams,
  UserAccount,
  PerpMarketAccount,
  ZERO,
  getMarketOrderParams,
  PostOnlyParams
} from '@drift-labs/sdk';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { BN } from '@drift-labs/sdk';
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createSyncNativeInstruction
} from '@solana/spl-token';

export interface DriftMarket {
  marketIndex: number;
  symbol: string;
  baseAssetSymbol: string;
  status: string;
  contractTier: string;
  marginRatioInitial: number;
  marginRatioMaintenance: number;
  maxLeverage: number;
  baseAssetAmountStepSize: BN;
  minOrderSize: number;
  tickSize: number;
}

export interface DriftPositionInfo {
  marketIndex: number;
  baseAssetAmount: BN;
  quoteAssetAmount: BN;
  direction: PositionDirection;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: BN;
  liquidationPrice: BN;
  marginRatio: number;
  leverage: number;
  pnlPercentage: number;
  distanceToLiquidation: number;
  positionValue: number;
}

export interface DriftOrderResult {
  success: boolean;
  signature?: string;
  error?: string;
  orderId?: number;
}

export class DriftService {
  private driftClient: DriftClient | null = null;
  private connection: Connection;
  private initialized: boolean = false;
  private wallet: Keypair | null = null;

  constructor(endpoint: string) {
    this.connection = new Connection(endpoint, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000, // 60 seconds
      wsEndpoint: endpoint.replace('https', 'wss')
    });
  }

  /**
   * Initialize Drift client
   */
  async initialize(wallet: Keypair): Promise<void> {
    if (this.initialized && this.driftClient) {
      return;
    }
    
    // Store wallet for later use
    this.wallet = wallet;

    try {
      // Ensure wSOL account exists before initializing Drift
      await this.ensureWrappedSOLAccount(wallet);
      
      // Create wallet adapter for Drift SDK
      const walletAdapter = new Wallet(wallet);

      // Initialize Drift client
      this.driftClient = new DriftClient({
        connection: this.connection,
        wallet: walletAdapter,
        programID: new PublicKey('dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH'), // Drift Program ID
        opts: {
          commitment: 'confirmed',
          preflightCommitment: 'confirmed',
        },
        activeSubAccountId: 0,
        perpMarketIndexes: [0, 1, 2, 3, 4, 5], // SOL, BTC, ETH, AVAX, BNB, MATIC
        spotMarketIndexes: [0, 1], // USDC, SOL
        oracleInfos: [],
      });

      // Subscribe to Drift client
      await this.driftClient.subscribe();
      
      // Initialize user account if needed with retry logic
      try {
        await this.driftClient.getUser().getUserAccount();
      } catch (error) {
        console.log('[DriftService] User account not found, checking wallet balance...');
        
        // Check if wallet has enough SOL for account creation
        const walletBalance = await this.connection.getBalance(wallet.publicKey);
        const minBalance = 0.1 * 1e9; // 0.1 SOL minimum
        
        if (walletBalance < minBalance) {
          throw new Error(`Insufficient SOL balance for Drift account creation. Need at least 0.1 SOL, have ${walletBalance / 1e9} SOL`);
        }
        
        console.log(`[DriftService] Wallet balance: ${walletBalance / 1e9} SOL`);
        
        // Retry logic for blockhash issues
        const maxRetries = 3;
        let retryCount = 0;
        let lastError: any = null;
        
        while (retryCount < maxRetries) {
          try {
            console.log(`[DriftService] Creating user account (attempt ${retryCount + 1}/${maxRetries})...`);
            
            // Get fresh blockhash before attempting
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
            
            await this.driftClient.initializeUserAccount();
            console.log('[DriftService] User account created successfully');
            break;
          } catch (retryError: any) {
            lastError = retryError;
            retryCount++;
            
            if (retryError.message?.includes('Blockhash not found') || 
                retryError.message?.includes('blockhash')) {
              console.log(`[DriftService] Blockhash error, waiting ${retryCount * 2} seconds before retry...`);
              await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
            } else {
              // If it's not a blockhash error, don't retry
              console.error('[DriftService] Non-blockhash error:', retryError);
              throw retryError;
            }
          }
        }
        
        if (retryCount >= maxRetries) {
          console.error('[DriftService] Failed to create user account after retries');
          throw lastError;
        }
      }

      this.initialized = true;
      console.log('[DriftService] Drift client initialized successfully');
    } catch (error) {
      console.error('[DriftService] Error initializing Drift client:', error);
      throw error;
    }
  }

  /**
   * Get available perpetual markets
   */
  async getAvailableMarkets(): Promise<DriftMarket[]> {
    if (!this.driftClient) {
      throw new Error('Drift client not initialized');
    }

    try {
      const markets: DriftMarket[] = [];
      const perpMarketAccounts = this.driftClient.getPerpMarketAccounts();

      for (const market of perpMarketAccounts) {
        const marketAccount = market;
        
        markets.push({
          marketIndex: market.marketIndex,
          symbol: `${this.getBaseAssetSymbol(market.marketIndex)}-PERP`,
          baseAssetSymbol: this.getBaseAssetSymbol(market.marketIndex),
          status: this.getMarketStatus(marketAccount.status),
          contractTier: marketAccount.contractTier.toString(),
          marginRatioInitial: this.safeConvertToNumber(marketAccount.marginRatioInitial, 4),
          marginRatioMaintenance: this.safeConvertToNumber(marketAccount.marginRatioMaintenance, 4),
          maxLeverage: this.calculateMaxLeverage(marketAccount.marginRatioInitial),
          baseAssetAmountStepSize: marketAccount.amm.baseAssetAmountWithAmm || marketAccount.amm.baseAssetAmountShort,
          minOrderSize: this.safeConvertToNumber(marketAccount.amm.minOrderSize, 6),
          tickSize: this.safeConvertToNumber(marketAccount.amm.orderTickSize || marketAccount.amm.orderStepSize, 6)
        });
      }

      return markets.filter(market => market.status === 'Active');
    } catch (error) {
      console.error('[DriftService] Error getting available markets:', error);
      throw error;
    }
  }

  /**
   * Get current position for a market
   */
  async getCurrentPosition(marketIndex: number): Promise<DriftPositionInfo | null> {
    if (!this.driftClient) {
      throw new Error('Drift client not initialized');
    }

    try {
      const user = this.driftClient.getUser();
      const position = user.getPerpPosition(marketIndex);

      if (!position || position.baseAssetAmount.eq(ZERO)) {
        return null;
      }

      const marketAccount = this.driftClient.getPerpMarketAccount(marketIndex);
      const oraclePrice = this.driftClient.getOracleDataForPerpMarket(marketIndex);
      
      const unrealizedPnl = user.getUnrealizedPNL(true, marketIndex);
      const liquidationPrice = user.liquidationPrice(marketIndex, MarketType.PERP);
      const marginRatio = user.getMarginRatio();
      const leverage = user.getLeverage();

      // Calculate current price from oracle
      const currentPrice = this.safeConvertToNumber(oraclePrice.price, 6);
      
      // Calculate entry price
      const entryPrice = this.safeConvertToNumber(position.quoteEntryAmount.abs().div(position.baseAssetAmount.abs()), 6);
      
      // Calculate P&L percentage
      const pnlPercentage = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
      
      // Calculate distance to liquidation
      const distanceToLiquidation = liquidationPrice.gt(ZERO) ? 
        ((currentPrice - this.safeConvertToNumber(liquidationPrice, 6)) / currentPrice) * 100 : 0;
      
      // Determine position direction
      const direction = position.baseAssetAmount.gt(ZERO) ? PositionDirection.LONG : PositionDirection.SHORT;
      
      // Calculate position value in USD
      const positionValue = this.safeConvertToNumber(position.baseAssetAmount.abs(), 6) * currentPrice;

      return {
        marketIndex,
        baseAssetAmount: position.baseAssetAmount,
        quoteAssetAmount: position.quoteAssetAmount,
        direction,
        entryPrice,
        currentPrice,
        unrealizedPnl,
        liquidationPrice: liquidationPrice || ZERO,
        marginRatio: this.safeConvertToNumber(marginRatio, 4),
        leverage: this.safeConvertToNumber(leverage, 2),
        pnlPercentage: Math.round(pnlPercentage * 100) / 100,
        distanceToLiquidation: Math.round(distanceToLiquidation * 100) / 100,
        positionValue: Math.round(positionValue * 100) / 100
      };
    } catch (error) {
      console.error('[DriftService] Error getting current position:', error);
      return null;
    }
  }

  /**
   * Get current market price
   */
  async getMarketPrice(marketIndex: number): Promise<number> {
    if (!this.driftClient) {
      throw new Error('Drift client not initialized');
    }

    try {
      const oracleData = this.driftClient.getOracleDataForPerpMarket(marketIndex);
      
      // Check if oracleData and price exist
      if (!oracleData) {
        throw new Error(`No oracle data available for market index ${marketIndex}`);
      }
      
      console.log(`[DriftService] Oracle data for market ${marketIndex}:`, {
        hasPrice: !!oracleData.price,
        priceType: typeof oracleData.price,
        priceValue: oracleData.price?.toString?.() || String(oracleData.price),
        hasIsZero: typeof oracleData.price?.isZero === 'function'
      });
      
      if (!oracleData.price && oracleData.price !== 0) {
        throw new Error(`No price data available in oracle for market index ${marketIndex}`);
      }

      // Use safe conversion helper
      return this.safeConvertToNumber(oracleData.price, 6);
    } catch (error) {
      console.error('[DriftService] Error getting market price:', error);
      console.error('[DriftService] Market index:', marketIndex);
      throw error;
    }
  }

  /**
   * Open a perpetual position
   */
  async openPosition(
    marketIndex: number,
    direction: 'long' | 'short',
    baseAssetAmount: number,
    price?: number
  ): Promise<DriftOrderResult> {
    if (!this.driftClient) {
      throw new Error('Drift client not initialized');
    }

    try {
      const baseAssetAmountBN = new BN(baseAssetAmount * 1e6); // Convert to 6 decimals
      const positionDirection = direction === 'long' ? PositionDirection.LONG : PositionDirection.SHORT;
      
      let orderParams: OrderParams;

      if (price) {
        // Limit order at specific price
        const limitPrice = new BN(price * 1e6);
        orderParams = {
          orderType: OrderType.LIMIT,
          marketIndex,
          direction: positionDirection,
          baseAssetAmount: baseAssetAmountBN,
          price: limitPrice,
          marketType: MarketType.PERP,
          postOnly: PostOnlyParams.NONE,
          reduceOnly: false,
          userOrderId: 0,
          bitFlags: 0,
          triggerPrice: ZERO,
          triggerCondition: 0,
          oraclePriceOffset: ZERO,
          auctionDuration: 0,
          maxTs: ZERO,
          auctionStartPrice: ZERO,
          auctionEndPrice: ZERO,
        };
      } else {
        // Market order
        orderParams = {
          ...getMarketOrderParams({
            marketIndex,
            direction: positionDirection,
            baseAssetAmount: baseAssetAmountBN,
            marketType: MarketType.PERP,
          }),
          marketType: MarketType.PERP,
        } as OrderParams;
      }

      console.log(`[DriftService] Opening ${direction} position for market ${marketIndex}`);
      const txSig = await this.driftClient.placeOrders([orderParams]);

      return {
        success: true,
        signature: txSig,
        orderId: undefined // Order ID is not directly returned
      };
    } catch (error) {
      console.error('[DriftService] Error opening position:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Close a perpetual position
   */
  async closePosition(marketIndex: number, price?: number): Promise<DriftOrderResult> {
    if (!this.driftClient) {
      throw new Error('Drift client not initialized');
    }

    try {
      const position = await this.getCurrentPosition(marketIndex);
      if (!position) {
        return {
          success: false,
          error: 'No position to close'
        };
      }

      // Determine opposite direction for closing
      const closeDirection = position.direction === PositionDirection.LONG 
        ? PositionDirection.SHORT 
        : PositionDirection.LONG;

      let orderParams: OrderParams;

      if (price) {
        // Limit order to close at specific price
        const limitPrice = new BN(price * 1e6);
        orderParams = {
          orderType: OrderType.LIMIT,
          marketIndex,
          direction: closeDirection,
          baseAssetAmount: position.baseAssetAmount.abs(),
          price: limitPrice,
          marketType: MarketType.PERP,
          postOnly: PostOnlyParams.NONE,
          reduceOnly: true,
          userOrderId: 0,
          bitFlags: 0,
          triggerPrice: ZERO,
          triggerCondition: 0,
          oraclePriceOffset: ZERO,
          auctionDuration: 0,
          maxTs: ZERO,
          auctionStartPrice: ZERO,
          auctionEndPrice: ZERO,
        };
      } else {
        // Market order to close
        orderParams = {
          ...getMarketOrderParams({
            marketIndex,
            direction: closeDirection,
            baseAssetAmount: position.baseAssetAmount.abs(),
            marketType: MarketType.PERP,
            reduceOnly: true,
          }),
          marketType: MarketType.PERP,
        } as OrderParams;
      }

      console.log(`[DriftService] Closing position for market ${marketIndex}`);
      const txSig = await this.driftClient.placeOrders([orderParams]);

      return {
        success: true,
        signature: txSig
      };
    } catch (error) {
      console.error('[DriftService] Error closing position:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get account value and buying power
   */
  async getAccountInfo(): Promise<{
    totalCollateral: number;
    freeCollateral: number;
    unsettledPnl: number;
    marginRatio: number;
    leverage: number;
    unrealizedPnl: number;
    accountHealth: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    maxPositionSize: number;
    maxLeverage: number;
  }> {
    if (!this.driftClient) {
      throw new Error('Drift client not initialized');
    }

    try {
      const user = this.driftClient.getUser();
      const totalCollateral = user.getTotalCollateral();
      const freeCollateral = user.getFreeCollateral();
      const marginRatio = user.getMarginRatio();
      const leverage = user.getLeverage();
      const unrealizedPnl = user.getUnrealizedPNL(true);

      // Debug logging to see raw SDK values
      console.log(`[DriftService] Raw SDK values:`, {
        totalCollateral: totalCollateral?.toString(),
        freeCollateral: freeCollateral?.toString(),
        marginRatio: marginRatio?.toString(),
        leverage: leverage?.toString(),
        unrealizedPnl: unrealizedPnl?.toString()
      });
      
      // Force restart comment - nodemon should pick this up

      const totalCollateralNum = this.safeConvertToNumber(totalCollateral, 6);
      const freeCollateralNum = this.safeConvertToNumber(freeCollateral, 6);
      const unsettledPnl = totalCollateralNum - freeCollateralNum;
      
      // Check if there are any open positions
      const hasOpenPositions = this.hasOpenPositions();
      
      // Calculate account health based on whether there are positions
      let accountHealth: number;
      let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      
      if (!hasOpenPositions) {
        // No positions = 100% health, no risk
        accountHealth = 100;
        riskLevel = 'LOW';
      } else {
        // Calculate health based on margin ratio
        const marginRatioNum = this.safeConvertToNumber(marginRatio, 4);
        accountHealth = Math.max(0, (1 - marginRatioNum) * 100);
        
        // Determine risk level based on account health
        if (accountHealth >= 80) {
          riskLevel = 'LOW';
        } else if (accountHealth >= 60) {
          riskLevel = 'MEDIUM';
        } else if (accountHealth >= 40) {
          riskLevel = 'HIGH';
        } else {
          riskLevel = 'CRITICAL';
        }
      }
      
      // Calculate actual leverage based on positions
      let actualLeverage = 0;
      if (hasOpenPositions) {
        actualLeverage = this.safeConvertToNumber(leverage, 2);
      }
      
      // Get max leverage from market (default to 10x for SOL-PERP)
      const maxLeverage = 10;
      const maxPositionSize = freeCollateralNum * maxLeverage;

      console.log(`[DriftService] Account info - Total: ${totalCollateralNum}, Free: ${freeCollateralNum}, Health: ${accountHealth.toFixed(1)}%, Risk: ${riskLevel}, Has Positions: ${hasOpenPositions}, Leverage: ${actualLeverage}`);

      return {
        totalCollateral: totalCollateralNum,
        freeCollateral: freeCollateralNum,
        unsettledPnl: unsettledPnl,
        marginRatio: this.safeConvertToNumber(marginRatio, 4),
        leverage: actualLeverage,
        unrealizedPnl: this.safeConvertToNumber(unrealizedPnl, 6),
        accountHealth: Math.round(accountHealth * 100) / 100, // Round to 2 decimal places
        riskLevel,
        maxPositionSize: Math.round(maxPositionSize * 100) / 100,
        maxLeverage
      };
    } catch (error) {
      console.error('[DriftService] Error getting account info:', error);
      throw error;
    }
  }

  /**
   * Check if there are any open positions
   */
  private hasOpenPositions(): boolean {
    if (!this.driftClient) return false;
    
    try {
      const user = this.driftClient.getUser();
      // Check SOL-PERP market (index 0) for positions
      const position = user.getPerpPosition(0);
      return position && position.baseAssetAmount && !position.baseAssetAmount.isZero();
    } catch (error) {
      console.error('[DriftService] Error checking for open positions:', error);
      return false;
    }
  }

  /**
   * Settle unsettled PnL 
   */
  async settlePnL(): Promise<{ success: boolean; signature?: string; error?: string }> {
    if (!this.driftClient) {
      throw new Error('Drift client not initialized');
    }

    try {
      console.log('[DriftService] Attempting to settle PnL...');
      
      const user = this.driftClient.getUser();
      
      // Check if there's unsettled PnL to settle
      const totalCollateral = user.getTotalCollateral();
      const freeCollateral = user.getFreeCollateral();
      const unsettledAmount = this.safeConvertToNumber(totalCollateral, 6) - this.safeConvertToNumber(freeCollateral, 6);
      
      if (Math.abs(unsettledAmount) < 0.001) {
        console.log('[DriftService] No significant unsettled PnL to settle');
        return {
          success: true,
          error: 'No unsettled PnL to settle'
        };
      }

      console.log(`[DriftService] Unsettled PnL amount: ${unsettledAmount} SOL`);
      
      // TODO: Check if Drift SDK has settlement methods like:
      // - await this.driftClient.settlePnl()
      // - await user.settlePnl() 
      // - await this.driftClient.settlePosition()
      // For now, return info about manual settlement needed
      
      return {
        success: false,
        error: `Settlement method not implemented. You have ${unsettledAmount.toFixed(4)} SOL unsettled PnL. Please settle manually on app.drift.trade`
      };
      
    } catch (error) {
      console.error('[DriftService] Error settling PnL:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown settlement error'
      };
    }
  }

  /**
   * Deposit collateral (USDC or SOL)
   */
  async depositCollateral(amount: number, assetType: 'USDC' | 'SOL' = 'USDC'): Promise<DriftOrderResult> {
    if (!this.driftClient) {
      throw new Error('Drift client not initialized');
    }

    try {
      let amountBN: BN;
      let spotMarketIndex: number;
      
      if (assetType === 'SOL') {
        amountBN = new BN(amount * 1e9); // SOL has 9 decimals
        spotMarketIndex = 1; // SOL spot market index (wSOL)
        console.log(`[DriftService] Depositing ${amount} SOL as collateral`);
        
        // For SOL deposits, we need to handle wSOL account creation and wrapping
        const result = await this.depositSOLAsCollateral(amount);
        return result;
      } else {
        amountBN = new BN(amount * 1e6); // USDC has 6 decimals
        spotMarketIndex = 0; // USDC spot market index
        console.log(`[DriftService] Depositing ${amount} USDC as collateral`);
        
        // Get USDC mint address (mainnet)
        const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        
        // Get the user's USDC token account
        const userUSDCAccount = await getAssociatedTokenAddress(
          USDC_MINT,
          this.wallet!.publicKey
        );
        
        const txSig = await this.driftClient.deposit(amountBN, spotMarketIndex, userUSDCAccount);
        
        return {
          success: true,
          signature: txSig
        };
      }
    } catch (error) {
      console.error('[DriftService] Error depositing collateral:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Ensure wrapped SOL account exists for the wallet
   */
  private async ensureWrappedSOLAccount(wallet: Keypair): Promise<void> {
    try {
      const userPublicKey = wallet.publicKey;
      
      // Get the wSOL associated token account
      const wsolAccount = await getAssociatedTokenAddress(
        NATIVE_MINT,
        userPublicKey
      );
      
      // Check if wSOL account exists
      const accountInfo = await this.connection.getAccountInfo(wsolAccount);
      if (!accountInfo) {
        console.log(`[DriftService] Creating wSOL associated token account for ${userPublicKey.toString()}`);
        
        const transaction = new Transaction();
        transaction.add(
          createAssociatedTokenAccountInstruction(
            userPublicKey,     // payer
            wsolAccount,       // associatedToken
            userPublicKey,     // owner
            NATIVE_MINT        // mint
          )
        );
        
        // Send the transaction to create wSOL account
        const { blockhash } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = userPublicKey;
        
        // Sign and send the transaction
        transaction.sign(wallet);
        const txSig = await this.connection.sendRawTransaction(transaction.serialize());
        
        console.log(`[DriftService] wSOL account creation transaction: ${txSig}`);
        
        // Wait for confirmation
        await this.connection.confirmTransaction(txSig);
        console.log(`[DriftService] wSOL account created successfully at ${wsolAccount.toString()}`);
      } else {
        console.log(`[DriftService] wSOL account already exists at ${wsolAccount.toString()}`);
      }
    } catch (error) {
      console.error('[DriftService] Error ensuring wSOL account:', error);
      throw error;
    }
  }

  /**
   * Deposit SOL as collateral by handling wSOL wrapping
   */
  private async depositSOLAsCollateral(amount: number): Promise<DriftOrderResult> {
    if (!this.driftClient || !this.wallet) {
      throw new Error('Drift client or wallet not initialized');
    }

    try {
      const amountLamports = Math.floor(amount * 1e9);
      const userPublicKey = this.wallet.publicKey;
      
      // Get the wSOL associated token account
      const wsolAccount = await getAssociatedTokenAddress(
        NATIVE_MINT,
        userPublicKey
      );
      
      console.log(`[DriftService] Creating/using wSOL account: ${wsolAccount.toString()}`);
      
      // Create transaction to fund the wSOL account
      const transaction = new Transaction();
      
      // wSOL account should already exist from initialization, but double-check
      const accountInfo = await this.connection.getAccountInfo(wsolAccount);
      if (!accountInfo) {
        console.log(`[DriftService] wSOL account not found during deposit, creating it`);
        transaction.add(
          createAssociatedTokenAccountInstruction(
            userPublicKey,     // payer
            wsolAccount,       // associatedToken
            userPublicKey,     // owner
            NATIVE_MINT        // mint
          )
        );
      }
      
      // Transfer SOL to wSOL account
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: userPublicKey,
          toPubkey: wsolAccount,
          lamports: amountLamports,
        })
      );
      
      // Sync native (convert SOL to wSOL)
      transaction.add(createSyncNativeInstruction(wsolAccount));
      
      // Send the transaction to create/fund wSOL account
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = userPublicKey;
      
      // Sign the transaction using the keypair
      transaction.sign(this.wallet);
      const wsolTxSig = await this.connection.sendRawTransaction(transaction.serialize());
      
      console.log(`[DriftService] wSOL wrap transaction: ${wsolTxSig}`);
      
      // Wait for confirmation
      await this.connection.confirmTransaction(wsolTxSig);
      
      // Now deposit the wSOL to Drift
      const amountBN = new BN(amountLamports);
      const spotMarketIndex = 1; // wSOL market index
      
      console.log(`[DriftService] Depositing ${amount} wSOL to Drift`);
      console.log(`[DriftService] Amount in lamports: ${amountLamports}`);
      console.log(`[DriftService] User account: ${this.driftClient.getUser().getUserAccountPublicKey().toString()}`);
      console.log(`[DriftService] wSOL account: ${wsolAccount.toString()}`);
      
      const driftTxSig = await this.driftClient.deposit(
        amountBN, 
        spotMarketIndex, 
        wsolAccount
      );
      
      console.log(`[DriftService] Drift deposit transaction: ${driftTxSig}`);
      
      return {
        success: true,
        signature: driftTxSig
      };
    } catch (error) {
      console.error('[DriftService] Error depositing SOL as collateral:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Withdraw SOL collateral
   */
  async withdrawCollateral(amount: number): Promise<DriftOrderResult> {
    if (!this.driftClient || !this.wallet) {
      throw new Error('Drift client or wallet not initialized');
    }

    try {
      // Check account info before attempting withdrawal
      const accountInfo = await this.getAccountInfo();
      
      if (accountInfo.freeCollateral <= 0) {
        return {
          success: false,
          error: `No collateral available to withdraw. Total: ${accountInfo.totalCollateral}, Free: ${accountInfo.freeCollateral}`
        };
      }
      
      if (amount > accountInfo.freeCollateral) {
        return {
          success: false,
          error: `Insufficient collateral. Requested: ${amount}, Available: ${accountInfo.freeCollateral}`
        };
      }

      // For SOL withdrawal, use wSOL (market index 1)
      const amountBN = new BN(amount * 1e9); // SOL has 9 decimals
      const spotMarketIndex = 1; // wSOL spot market index
      
      // Get the wSOL associated token account
      const wsolAccount = await getAssociatedTokenAddress(
        NATIVE_MINT,
        this.wallet.publicKey
      );
      
      console.log(`[DriftService] Withdrawing ${amount} SOL from collateral`);
      console.log(`[DriftService] wSOL account: ${wsolAccount.toString()}`);
      console.log(`[DriftService] Account status - Total: ${accountInfo.totalCollateral}, Free: ${accountInfo.freeCollateral}, Margin: ${accountInfo.marginRatio}`);
      
      const txSig = await this.driftClient.withdraw(amountBN, spotMarketIndex, wsolAccount);

      console.log(`[DriftService] Withdrawal transaction: ${txSig}`);
      
      return {
        success: true,
        signature: txSig
      };
    } catch (error) {
      console.error('[DriftService] Error withdrawing SOL collateral:', error);
      
      // Provide more specific error messages for common Drift errors
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        if (error.message.includes('Insufficient collateral')) {
          errorMessage = 'Insufficient collateral in Drift account';
        } else if (error.message.includes('0x1773')) {
          errorMessage = 'Insufficient collateral - account below margin requirements';
        } else {
          errorMessage = error.message;
        }
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Clean up and unsubscribe
   */
  async cleanup(): Promise<void> {
    if (this.driftClient) {
      await this.driftClient.unsubscribe();
      this.driftClient = null;
      this.initialized = false;
    }
  }

  // Helper methods

  private getBaseAssetSymbol(marketIndex: number): string {
    const symbols: { [key: number]: string } = {
      0: 'SOL',
      1: 'BTC', 
      2: 'ETH',
      3: 'AVAX',
      4: 'BNB',
      5: 'MATIC',
      6: 'DOGE',
      7: 'ADA',
      8: 'DOT',
      9: 'LINK'
    };
    return symbols[marketIndex] || `UNKNOWN-${marketIndex}`;
  }

  private getMarketStatus(status: any): string {
    // Map Drift market status enum to string
    if (status.active) return 'Active';
    if (status.paused) return 'Paused';
    if (status.cancelled) return 'Cancelled';
    return 'Unknown';
  }

  private calculateMaxLeverage(marginRatioInitial: BN): number {
    const marginRatio = this.safeConvertToNumber(marginRatioInitial, 4);
    return Math.floor(1 / marginRatio);
  }

  /**
   * Safely convert a value to a number using manual conversion
   * Bypasses Drift's convertToNumber function to avoid BN issues
   */
  private safeConvertToNumber(value: any, decimals: number): number {
    if (!value && value !== 0) {
      return 0;
    }

    try {
      // Manual conversion without using Drift's convertToNumber
      let numValue: number;
      
      if (typeof value === 'number') {
        numValue = value;
      } else if (typeof value === 'string') {
        numValue = parseFloat(value);
      } else if (typeof value === 'object' && value !== null) {
        // Handle BN or BN-like objects
        if (typeof value.toString === 'function') {
          numValue = parseFloat(value.toString());
        } else {
          console.warn(`Cannot convert object to number: ${value}, returning 0`);
          return 0;
        }
      } else {
        console.warn(`Unknown value type: ${typeof value}, value: ${value}, returning 0`);
        return 0;
      }
      
      // Apply decimals scaling
      const result = numValue / Math.pow(10, decimals);
      
      return isNaN(result) ? 0 : result;
    } catch (error) {
      console.warn(`Failed to convert value: ${value}, error: ${error}, returning 0`);
      return 0;
    }
  }
}