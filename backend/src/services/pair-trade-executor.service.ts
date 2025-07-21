import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import axios from 'axios';

export interface InitialAllocationParams {
  walletPubkey: string;
  tokenAMint: string;
  tokenBMint: string;
  allocationPercentage: number;
  recommendedToken: 'A' | 'B';
  strategyId?: string;
}

export interface InitialAllocationResult {
  allocatedAmount: number;
  purchasedToken: 'A' | 'B';
  purchasedAmount: number;
  signature: string;
}

export interface SignalTradeParams {
  strategyId: string;
  action: 'buy' | 'sell';
  targetToken: 'A' | 'B';
  percentage: number;
  maxSlippage?: number;
}

export interface SignalTradeResult {
  success: boolean;
  fromToken: 'A' | 'B';
  toToken: 'A' | 'B';
  actualPercentage: number;
  partialFill: boolean;
  maxTradeableAmount: number;
  signature: string;
}

export interface TokenHolding {
  mint: string;
  amount: number;
}

export interface StrategyHoldings {
  tokenA: TokenHolding;
  tokenB: TokenHolding;
  totalAllocatedSOL: number;
}

export interface JupiterSwapParams {
  inputMint: string;
  outputMint: string;
  amount: number;
  walletPubkey: string;
  slippageBps?: number;
}

export interface JupiterSwapResult {
  signature: string;
  inputAmount: number;
  outputAmount: number;
}

export class PairTradeExecutor {
  constructor(private connection: Connection) {}

  async executeInitialAllocation(params: InitialAllocationParams): Promise<InitialAllocationResult> {
    try {
      // Get wallet balance
      const walletPubkey = new PublicKey(params.walletPubkey);
      const balance = await this.connection.getBalance(walletPubkey);
      
      // Calculate allocation amount
      const allocationAmount = Math.floor((balance * params.allocationPercentage) / 100);
      
      if (allocationAmount <= 0 || allocationAmount > balance) {
        throw new Error('Insufficient wallet balance');
      }

      // Determine which token to buy based on recommendation
      const inputMint = 'SOL'; // Always start with SOL
      const outputMint = params.recommendedToken === 'A' ? params.tokenAMint : params.tokenBMint;
      
      // Execute the swap
      const swapResult = await this.executeJupiterSwap({
        inputMint,
        outputMint,
        amount: allocationAmount,
        walletPubkey: params.walletPubkey
      });

      // Update strategy holdings if strategyId provided
      if (params.strategyId) {
        const holdings: StrategyHoldings = {
          tokenA: {
            mint: params.tokenAMint,
            amount: params.recommendedToken === 'A' ? swapResult.outputAmount : 0
          },
          tokenB: {
            mint: params.tokenBMint,
            amount: params.recommendedToken === 'B' ? swapResult.outputAmount : 0
          },
          totalAllocatedSOL: allocationAmount
        };
        
        await this.updateStrategyHoldings(params.strategyId, holdings);
      }

      return {
        allocatedAmount: allocationAmount,
        purchasedToken: params.recommendedToken,
        purchasedAmount: swapResult.outputAmount,
        signature: swapResult.signature
      };
    } catch (error) {
      throw new Error('Failed to execute initial allocation: ' + (error as Error).message);
    }
  }

  async executeSignalTrade(params: SignalTradeParams): Promise<SignalTradeResult> {
    // Get current holdings
    const holdings = await this.getStrategyHoldings(params.strategyId);
    
    // Determine source and target tokens
    const sourceToken = params.targetToken; // Token we're selling
    const targetToken = params.targetToken === 'A' ? 'B' : 'A'; // Token we're buying
    
    const sourceHolding = sourceToken === 'A' ? holdings.tokenA : holdings.tokenB;
    const targetHolding = targetToken === 'A' ? holdings.tokenA : holdings.tokenB;
    
    // Calculate trade amount
    const tradeAmount = Math.floor((sourceHolding.amount * params.percentage) / 100);
    const maxTradeableAmount = sourceHolding.amount;
    
    if (tradeAmount <= 0) {
      throw new Error('No tokens available to trade');
    }

    // Execute the swap
    const slippageBps = params.maxSlippage ? params.maxSlippage * 100 : 100; // Default 1%
    
    const swapResult = await this.executeJupiterSwap({
      inputMint: sourceHolding.mint,
      outputMint: targetHolding.mint,
      amount: tradeAmount,
      walletPubkey: 'wallet_address', // Would get from strategy
      slippageBps
    });

    // Check if partial fill occurred
    const actualPercentage = (swapResult.inputAmount / sourceHolding.amount) * 100;
    const partialFill = swapResult.inputAmount < tradeAmount;

    // Update holdings
    const updatedHoldings: StrategyHoldings = {
      tokenA: sourceToken === 'A' 
        ? { ...holdings.tokenA, amount: holdings.tokenA.amount - swapResult.inputAmount }
        : { ...holdings.tokenA, amount: holdings.tokenA.amount + swapResult.outputAmount },
      tokenB: sourceToken === 'B'
        ? { ...holdings.tokenB, amount: holdings.tokenB.amount - swapResult.inputAmount }
        : { ...holdings.tokenB, amount: holdings.tokenB.amount + swapResult.outputAmount },
      totalAllocatedSOL: holdings.totalAllocatedSOL
    };

    await this.updateStrategyHoldings(params.strategyId, updatedHoldings);

    return {
      success: true,
      fromToken: sourceToken,
      toToken: targetToken,
      actualPercentage,
      partialFill,
      maxTradeableAmount,
      signature: swapResult.signature
    };
  }

  private async executeJupiterSwap(params: JupiterSwapParams): Promise<JupiterSwapResult> {
    // Mock implementation - would integrate with actual Jupiter API
    try {
      const response = await axios.post('https://quote-api.jup.ag/v6/swap', {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        slippageBps: params.slippageBps || 100
      });

      return {
        signature: `mock_signature_${Date.now()}`,
        inputAmount: params.amount,
        outputAmount: Math.floor(params.amount * 0.95) // Mock 5% conversion rate
      };
    } catch (error) {
      throw new Error('Jupiter swap failed: ' + (error as Error).message);
    }
  }

  private async getStrategyHoldings(strategyId: string): Promise<StrategyHoldings> {
    // Mock implementation - would query database
    return {
      tokenA: { mint: 'USDC', amount: 500 * 1000000 },
      tokenB: { mint: 'SOL', amount: 0 },
      totalAllocatedSOL: 5 * LAMPORTS_PER_SOL
    };
  }

  private async updateStrategyHoldings(strategyId: string, holdings: StrategyHoldings): Promise<void> {
    // Mock implementation - would update database
    console.log(`Updating holdings for strategy ${strategyId}:`, holdings);
  }
}