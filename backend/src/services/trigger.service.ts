export interface PairTradeSignal {
  tokenAMint: string;
  tokenBMint: string;
  action: 'buy' | 'sell';
  targetToken: 'A' | 'B';
  percentage: number;
  timestamp: string;
  maxSlippage?: number;
}

export interface ProcessingResult {
  processedStrategies: number;
  successfulTrades: number;
  failedTrades: number;
  errors: string[];
  totalVolume: number;
}

export interface Strategy {
  id: string;
  tokenAMint: string;
  tokenBMint: string;
  walletPubkey: string;
  isActive: boolean;
}

export interface TradeResult {
  success: boolean;
  signature: string;
  error?: string;
}

export class TriggerService {
  async processPairTradeSignal(signal: PairTradeSignal): Promise<ProcessingResult> {
    // Validate signal
    this.validateSignal(signal);

    // Find matching strategies
    const strategies = await this.findStrategiesByTokenPair(signal.tokenAMint, signal.tokenBMint);
    
    let successfulTrades = 0;
    let failedTrades = 0;
    const errors: string[] = [];
    let totalVolume = 0;

    // Process each strategy
    for (const strategy of strategies) {
      try {
        const result = await this.executeTrade(strategy, signal);
        if (result.success) {
          successfulTrades++;
          // totalVolume += result.volume; // Would track actual volume
        } else {
          failedTrades++;
          if (result.error) {
            errors.push(`Strategy ${strategy.id}: ${result.error}`);
          }
        }
      } catch (error) {
        failedTrades++;
        errors.push(`Strategy ${strategy.id}: ${(error as Error).message}`);
      }
    }

    const result: ProcessingResult = {
      processedStrategies: strategies.length,
      successfulTrades,
      failedTrades,
      errors,
      totalVolume
    };

    // Log for audit trail
    await this.logProcessedSignal(signal, result);

    return result;
  }

  private validateSignal(signal: PairTradeSignal): void {
    // Validate token addresses
    if (!signal.tokenAMint || !signal.tokenBMint) {
      throw new Error('Invalid signal format: missing token addresses');
    }

    if (!this.isValidMintAddress(signal.tokenAMint) || !this.isValidMintAddress(signal.tokenBMint)) {
      throw new Error('Invalid token mint addresses');
    }

    // Validate action
    if (!['buy', 'sell'].includes(signal.action)) {
      throw new Error('Invalid action: must be buy or sell');
    }

    // Validate target token
    if (!['A', 'B'].includes(signal.targetToken)) {
      throw new Error('Invalid target token: must be A or B');
    }

    // Validate percentage
    if (signal.percentage < 1 || signal.percentage > 100) {
      throw new Error('Invalid percentage: must be between 1 and 100');
    }

    // Validate timestamp
    if (!signal.timestamp || isNaN(Date.parse(signal.timestamp))) {
      throw new Error('Invalid timestamp format');
    }
  }

  private async findStrategiesByTokenPair(tokenAMint: string, tokenBMint: string): Promise<Strategy[]> {
    // Mock implementation - would query database for strategies with matching token pairs
    // This would find all active pair-trade strategies that use these exact tokens
    
    const mockStrategies: Strategy[] = [
      {
        id: 'strategy_1',
        tokenAMint,
        tokenBMint,
        walletPubkey: 'wallet_address_1',
        isActive: true
      },
      {
        id: 'strategy_2', 
        tokenAMint,
        tokenBMint,
        walletPubkey: 'wallet_address_2',
        isActive: true
      }
    ];

    // Filter to only return strategies that match exactly
    return mockStrategies.filter(strategy => 
      strategy.tokenAMint === tokenAMint && 
      strategy.tokenBMint === tokenBMint &&
      strategy.isActive
    );
  }

  private async executeTrade(strategy: Strategy, signal: PairTradeSignal): Promise<TradeResult> {
    try {
      // This would use the PairTradeExecutor to execute the actual trade
      // For now, mock implementation
      
      // Simulate trade execution
      const signature = `trade_${strategy.id}_${Date.now()}`;
      
      return {
        success: true,
        signature
      };
    } catch (error) {
      return {
        success: false,
        signature: '',
        error: (error as Error).message
      };
    }
  }

  private async logProcessedSignal(signal: PairTradeSignal, result: ProcessingResult): Promise<void> {
    // Mock implementation - would log to database for audit trail
    console.log('Processed signal:', {
      signal,
      result,
      timestamp: new Date().toISOString()
    });
  }

  private isValidMintAddress(mintAddress: string): boolean {
    if (!mintAddress || mintAddress.trim() === '') {
      return false;
    }
    
    // Basic validation - should be 32-44 characters (base58)
    if (mintAddress.length < 32 || mintAddress.length > 44) {
      return false;
    }

    // Check if it contains only valid base58 characters
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    return base58Regex.test(mintAddress);
  }
}