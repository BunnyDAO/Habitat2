import { Pool } from 'pg';

export interface TokenHolding {
  mint: string;
  amount: number;
}

export interface StrategyHoldings {
  tokenA: TokenHolding;
  tokenB: TokenHolding;
  totalAllocatedSOL: number;
  lastUpdated?: Date;
}

export interface TradeRecord {
  id: string;
  strategyId: string;
  tradeType: 'initial_allocation' | 'signal_trade';
  fromToken?: 'A' | 'B';
  toToken?: 'A' | 'B';
  fromMint: string;
  toMint: string;
  inputAmount: number;
  outputAmount: number;
  percentageTraded?: number;
  slippageBps?: number;
  jupiterSignature?: string;
  signalData?: any;
  executionStatus: 'pending' | 'completed' | 'failed' | 'partial';
  errorMessage?: string;
  gasUsed?: number;
  createdAt: Date;
  completedAt?: Date;
}

export interface TradeRecordInput {
  strategyId: string;
  tradeType: 'initial_allocation' | 'signal_trade';
  fromToken?: 'A' | 'B';
  toToken?: 'A' | 'B';
  fromMint: string;
  toMint: string;
  inputAmount: number;
  outputAmount: number;
  percentageTraded?: number;
  slippageBps?: number;
  jupiterSignature?: string;
  signalData?: any;
  executionStatus: 'pending' | 'completed' | 'failed' | 'partial';
  errorMessage?: string;
  gasUsed?: number;
}

export interface PortfolioValue {
  totalValueUSD: number;
  tokenAValueUSD: number;
  tokenBValueUSD: number;
  allocationUtilized: number;
  priceData: { [mint: string]: number };
}

export class HoldingsTracker {
  constructor(private pool: Pool) {}

  async updateHoldings(strategyId: string, holdings: StrategyHoldings): Promise<void> {
    try {
      // Check if holdings record exists
      const existingQuery = `
        SELECT id FROM strategy_holdings 
        WHERE strategy_id = $1
      `;
      const existingResult = await this.pool.query(existingQuery, [strategyId]);

      if (existingResult.rows.length > 0) {
        // Update existing record
        const updateQuery = `
          UPDATE strategy_holdings 
          SET 
            token_a_amount = $1,
            token_b_amount = $2,
            last_updated = now()
          WHERE id = $3
          RETURNING id
        `;
        await this.pool.query(updateQuery, [
          holdings.tokenA.amount,
          holdings.tokenB.amount,
          existingResult.rows[0].id
        ]);
      } else {
        // Create new record
        const insertQuery = `
          INSERT INTO strategy_holdings (
            strategy_id,
            token_a_mint,
            token_a_amount,
            token_b_mint,
            token_b_amount,
            total_allocated_sol
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `;
        await this.pool.query(insertQuery, [
          strategyId,
          holdings.tokenA.mint,
          holdings.tokenA.amount,
          holdings.tokenB.mint,
          holdings.tokenB.amount,
          holdings.totalAllocatedSOL
        ]);
      }
    } catch (error) {
      throw new Error('Failed to update holdings: ' + (error as Error).message);
    }
  }

  async getHoldings(strategyId: string): Promise<StrategyHoldings | null> {
    if (!strategyId || strategyId.trim() === '') {
      throw new Error('Invalid strategy ID');
    }

    try {
      const query = `
        SELECT 
          token_a_mint,
          token_a_amount,
          token_b_mint,
          token_b_amount,
          total_allocated_sol,
          last_updated
        FROM strategy_holdings 
        WHERE strategy_id = $1
      `;
      
      const result = await this.pool.query(query, [strategyId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        tokenA: {
          mint: row.token_a_mint,
          amount: parseInt(row.token_a_amount)
        },
        tokenB: {
          mint: row.token_b_mint,
          amount: parseInt(row.token_b_amount)
        },
        totalAllocatedSOL: parseInt(row.total_allocated_sol),
        lastUpdated: row.last_updated
      };
    } catch (error) {
      throw new Error('Failed to get holdings: ' + (error as Error).message);
    }
  }

  async getTradeHistory(strategyId: string, limit: number = 50, offset: number = 0): Promise<TradeRecord[]> {
    try {
      const query = `
        SELECT 
          id,
          strategy_id,
          trade_type,
          from_token,
          to_token,
          from_mint,
          to_mint,
          input_amount,
          output_amount,
          percentage_traded,
          slippage_bps,
          jupiter_signature,
          signal_data,
          execution_status,
          error_message,
          gas_used,
          created_at,
          completed_at
        FROM trade_history 
        WHERE strategy_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
      
      const result = await this.pool.query(query, [strategyId, limit, offset]);
      
      return result.rows.map(row => ({
        id: row.id,
        strategyId: row.strategy_id,
        tradeType: row.trade_type,
        fromToken: row.from_token,
        toToken: row.to_token,
        fromMint: row.from_mint,
        toMint: row.to_mint,
        inputAmount: parseInt(row.input_amount),
        outputAmount: parseInt(row.output_amount),
        percentageTraded: row.percentage_traded ? parseFloat(row.percentage_traded) : undefined,
        slippageBps: row.slippage_bps,
        jupiterSignature: row.jupiter_signature,
        signalData: row.signal_data,
        executionStatus: row.execution_status,
        errorMessage: row.error_message,
        gasUsed: row.gas_used ? parseInt(row.gas_used) : undefined,
        createdAt: row.created_at,
        completedAt: row.completed_at
      }));
    } catch (error) {
      throw new Error('Failed to get trade history: ' + (error as Error).message);
    }
  }

  async recordTrade(tradeData: TradeRecordInput): Promise<string> {
    try {
      const query = `
        INSERT INTO trade_history (
          strategy_id,
          trade_type,
          from_token,
          to_token,
          from_mint,
          to_mint,
          input_amount,
          output_amount,
          percentage_traded,
          slippage_bps,
          jupiter_signature,
          signal_data,
          execution_status,
          error_message,
          gas_used,
          completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING id
      `;
      
      const values = [
        tradeData.strategyId,
        tradeData.tradeType,
        tradeData.fromToken || null,
        tradeData.toToken || null,
        tradeData.fromMint,
        tradeData.toMint,
        tradeData.inputAmount,
        tradeData.outputAmount,
        tradeData.percentageTraded || null,
        tradeData.slippageBps || null,
        tradeData.jupiterSignature || null,
        tradeData.signalData ? JSON.stringify(tradeData.signalData) : null,
        tradeData.executionStatus,
        tradeData.errorMessage || null,
        tradeData.gasUsed || null,
        tradeData.executionStatus === 'completed' ? new Date() : null
      ];
      
      const result = await this.pool.query(query, values);
      return result.rows[0].id;
    } catch (error) {
      throw new Error('Failed to record trade: ' + (error as Error).message);
    }
  }

  async calculatePortfolioValue(holdings: StrategyHoldings): Promise<PortfolioValue> {
    try {
      // Get current token prices
      const priceData = await this.getTokenPrices([holdings.tokenA.mint, holdings.tokenB.mint]);
      
      // Calculate values (assuming amounts are in smallest units)
      const tokenAPrice = priceData[holdings.tokenA.mint] || 0;
      const tokenBPrice = priceData[holdings.tokenB.mint] || 0;
      
      // Convert amounts to full units (this would need token decimals info)
      const tokenAFullUnits = holdings.tokenA.amount / 1000000000; // Assuming 9 decimals for SOL
      const tokenBFullUnits = holdings.tokenB.amount / 1000000; // Assuming 6 decimals for USDC
      
      const tokenAValueUSD = tokenAFullUnits * tokenAPrice;
      const tokenBValueUSD = tokenBFullUnits * tokenBPrice;
      const totalValueUSD = tokenAValueUSD + tokenBValueUSD;
      
      // Calculate allocation utilization
      const initialAllocationUSD = (holdings.totalAllocatedSOL / 1000000000) * (priceData['SOL'] || 100);
      const allocationUtilized = totalValueUSD / initialAllocationUSD;
      
      return {
        totalValueUSD,
        tokenAValueUSD,
        tokenBValueUSD,
        allocationUtilized,
        priceData
      };
    } catch (error) {
      throw new Error('Failed to calculate portfolio value: ' + (error as Error).message);
    }
  }

  private async getTokenPrices(mints: string[]): Promise<{ [mint: string]: number }> {
    // Mock implementation - would integrate with price feed service
    const mockPrices: { [mint: string]: number } = {
      'SOL': 100,
      'So11111111111111111111111111111111111111112': 100, // SOL mint
      'USDC': 1,
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 1, // USDC mint
    };
    
    const result: { [mint: string]: number } = {};
    for (const mint of mints) {
      result[mint] = mockPrices[mint] || 0;
    }
    
    return result;
  }
}