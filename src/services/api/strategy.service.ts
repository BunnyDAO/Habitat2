import apiClient from './api-client';
import { JobType } from '../../types/jobs';
import tradingWalletService from '../tradingWalletService';

export interface CreateStrategyRequest {
  trading_wallet_id: number;
  strategy_type: JobType;
  config: any;
  name?: string;
}

export interface Strategy {
  id: string;
  trading_wallet_id: number;
  main_wallet_pubkey: string;
  strategy_type: JobType;
  config: any;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  name?: string;
  version: number;
}

class StrategyApiService {
  private static instance: StrategyApiService;

  public static getInstance(): StrategyApiService {
    if (!StrategyApiService.instance) {
      StrategyApiService.instance = new StrategyApiService();
    }
    return StrategyApiService.instance;
  }

  async createStrategy(request: Omit<CreateStrategyRequest, 'trading_wallet_id'> & { tradingWalletPublicKey: string }): Promise<Strategy> {
    try {
      const trading_wallet_id = await tradingWalletService.getWalletId(request.tradingWalletPublicKey);
      
      const response = await apiClient.post<Strategy>('/strategies', {
        ...request,
        trading_wallet_id
      });
      return response.data;
    } catch (error) {
      console.error('Error creating strategy:', error);
      throw error;
    }
  }

  async getStrategies(): Promise<Strategy[]> {
    try {
      const response = await apiClient.get<Strategy[]>('/strategies');
      return response.data;
    } catch (error) {
      console.error('Error fetching strategies:', error);
      throw error;
    }
  }

  async updateStrategy(id: string, updates: Partial<CreateStrategyRequest>): Promise<Strategy> {
    try {
      const response = await apiClient.put<Strategy>(`/strategies/${id}`, updates);
      return response.data;
    } catch (error) {
      console.error('Error updating strategy:', error);
      throw error;
    }
  }

  async toggleStrategy(id: string, isActive: boolean): Promise<Strategy> {
    try {
      const response = await apiClient.put<Strategy>(`/strategies/${id}/toggle`, { is_active: isActive });
      return response.data;
    } catch (error) {
      console.error('Error toggling strategy:', error);
      throw error;
    }
  }

  async deleteStrategy(id: string): Promise<void> {
    try {
      await apiClient.delete(`/strategies/${id}`);
    } catch (error) {
      console.error('Error deleting strategy:', error);
      throw error;
    }
  }
}

export const strategyApiService = StrategyApiService.getInstance(); 