import apiClient from './api-client';
import { JobType } from '../../types/jobs';
import tradingWalletService from '../tradingWalletService';
import { authService } from '../auth.service';

export interface StrategyConfig {
  walletAddress?: string;
  percentage?: number;
  targetPrice?: number;
  direction?: 'above' | 'below';
  percentageToSell?: number;
  vaultPercentage?: number;
  levels?: Array<{
    price: number;
    percentage: number;
  }>;
  // Pair trade specific fields
  tokenAMint?: string;
  tokenBMint?: string;
  tokenASymbol?: string;
  tokenBSymbol?: string;
  allocationPercentage?: number;
  maxSlippage?: number;
  autoRebalance?: boolean;
}

export interface CreateStrategyRequest {
  trading_wallet_id: number;
  strategy_type: JobType;
  config: StrategyConfig;
  name?: string;
}

export interface Strategy {
  id: string;
  trading_wallet_id: number;
  main_wallet_pubkey: string;
  strategy_type: JobType;
  config: StrategyConfig;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  name?: string;
  version: number;
}

class StrategyApiService {
  private static instance: StrategyApiService;

  private constructor() {}

  public static getInstance(): StrategyApiService {
    if (!StrategyApiService.instance) {
      StrategyApiService.instance = new StrategyApiService();
    }
    return StrategyApiService.instance;
  }

  async createStrategy(request: Omit<CreateStrategyRequest, 'trading_wallet_id'> & { tradingWalletPublicKey: string }): Promise<Strategy> {
    try {
      // Ensure we have a valid auth token
      const token = await authService.getSession();
      if (!token) {
        throw new Error('Not authenticated');
      }

      // Get trading wallet ID
      let trading_wallet_id: number;
      let wallet_pubkey: string;
      try {
        const walletInfo = await tradingWalletService.getWalletId(request.tradingWalletPublicKey);
        trading_wallet_id = walletInfo.id;
        wallet_pubkey = walletInfo.wallet_pubkey;
        console.log('Retrieved trading wallet ID:', trading_wallet_id);
      } catch (error) {
        console.error('Error getting trading wallet ID:', error);
        throw new Error('Failed to get trading wallet ID. Please ensure the trading wallet exists and try again.');
      }

      if (!trading_wallet_id) {
        throw new Error('Trading wallet not found. Please ensure the trading wallet exists and try again.');
      }

      // Create strategy
      const { tradingWalletPublicKey, ...rest } = request;
      const requestPayload = {
        ...rest,
        trading_wallet_id,
        current_wallet_pubkey: wallet_pubkey
      };
      console.log('Sending strategy creation request with payload:', JSON.stringify(requestPayload, null, 2));

      try {
        const response = await apiClient.post<Strategy>('/strategies', requestPayload);
        return response.data;
      } catch (error: any) {
        console.error('Error response from server:', error.response?.data);
        throw error;
      }
    } catch (error) {
      console.error('Error creating strategy:', error);
      throw error;
    }
  }

  async getStrategies(tradingWalletPublicKey?: string): Promise<Strategy[]> {
    try {
      // Ensure we have a valid auth token
      const token = await authService.getSession();
      if (!token) {
        throw new Error('Not authenticated');
      }

      let url = '/strategies';
      if (tradingWalletPublicKey) {
        const trading_wallet_id = await tradingWalletService.getWalletId(tradingWalletPublicKey);
        if (trading_wallet_id) {
          url += `?trading_wallet_id=${trading_wallet_id}`;
        }
      }

      const response = await apiClient.get<Strategy[]>(url);
      return response.data;
    } catch (error) {
      console.error('Error fetching strategies:', error);
      throw error;
    }
  }

  async updateStrategy(id: string, config: StrategyConfig, change_reason?: string): Promise<Strategy> {
    try {
      // Ensure we have a valid auth token
      const token = await authService.getSession();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await apiClient.put<Strategy>(`/strategies/${id}`, {
        config,
        change_reason
      });

      return response.data;
    } catch (error) {
      console.error('Error updating strategy:', error);
      throw error;
    }
  }

  async getStrategyVersions(id: string): Promise<Array<{ version: number; config: StrategyConfig; created_at: string; change_reason?: string }>> {
    try {
      // Ensure we have a valid auth token
      const token = await authService.getSession();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await apiClient.get<Array<{ version: number; config: StrategyConfig; created_at: string; change_reason?: string }>>(`/strategies/${id}/versions`);
      return response.data;
    } catch (error) {
      console.error('Error fetching strategy versions:', error);
      throw error;
    }
  }

  async restoreStrategyVersion(id: string, version: number): Promise<Strategy> {
    try {
      // Ensure we have a valid auth token
      const token = await authService.getSession();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await apiClient.post<Strategy>(`/strategies/${id}/restore/${version}`);
      return response.data;
    } catch (error) {
      console.error('Error restoring strategy version:', error);
      throw error;
    }
  }

  async deleteStrategy(id: string): Promise<void> {
    try {
      // Ensure we have a valid auth token
      const token = await authService.getSession();
      if (!token) {
        throw new Error('Not authenticated');
      }

      await apiClient.delete(`/strategies/${id}`);
    } catch (error) {
      console.error('Error deleting strategy:', error);
      throw error;
    }
  }
}

export const strategyApiService = StrategyApiService.getInstance(); 