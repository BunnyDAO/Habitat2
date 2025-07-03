/**
 * Strategy API Client - Typed methods for strategy management
 */

import { ApiClient } from './api-client';

export interface Strategy {
  id: string;
  trading_wallet_id: string;
  main_wallet_pubkey: string;
  strategy_type: string;
  config: any;
  name: string;
  version: number;
  is_active: boolean;
  position: number;
  current_wallet_pubkey: string;
  wallet_pubkey?: string;
  trading_wallet_name?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateStrategyRequest {
  trading_wallet_id: string;
  strategy_type: string;
  config: any;
  name: string;
}

export interface UpdateStrategyRequest {
  config: any;
  change_reason?: string;
}

export interface StrategyVersion {
  id: string;
  strategy_id: string;
  version: number;
  config: any;
  change_reason: string;
  created_at: string;
}

export class StrategyApiClient {
  constructor(private apiClient: ApiClient) {}

  /**
   * Create a new strategy
   */
  async createStrategy(data: CreateStrategyRequest): Promise<Strategy> {
    const response = await this.apiClient.post<Strategy>('/api/strategies', data);
    return response.data;
  }

  /**
   * Get all strategies (optionally filtered by trading wallet)
   */
  async getStrategies(tradingWalletId?: string): Promise<Strategy[]> {
    const params = tradingWalletId ? { trading_wallet_id: tradingWalletId } : {};
    const response = await this.apiClient.get<Strategy[]>('/api/strategies', { params });
    return response.data;
  }

  /**
   * Update a strategy
   */
  async updateStrategy(id: string, data: UpdateStrategyRequest): Promise<Strategy> {
    const response = await this.apiClient.put<Strategy>(`/api/strategies/${id}`, data);
    return response.data;
  }

  /**
   * Delete a strategy
   */
  async deleteStrategy(id: string): Promise<void> {
    await this.apiClient.delete(`/api/strategies/${id}`);
  }

  /**
   * Get strategy versions
   */
  async getStrategyVersions(id: string): Promise<StrategyVersion[]> {
    const response = await this.apiClient.get<StrategyVersion[]>(`/api/strategies/${id}/versions`);
    return response.data;
  }

  /**
   * Restore strategy to a specific version
   */
  async restoreStrategyVersion(id: string, version: number): Promise<Strategy> {
    const response = await this.apiClient.post<Strategy>(`/api/strategies/${id}/restore/${version}`);
    return response.data;
  }

  /**
   * Publish a strategy
   */
  async publishStrategy(id: string): Promise<Strategy> {
    const response = await this.apiClient.post<Strategy>(`/api/strategies/${id}/publish`);
    return response.data;
  }

  /**
   * Get published strategies
   */
  async getPublishedStrategies(): Promise<Strategy[]> {
    const response = await this.apiClient.get<Strategy[]>('/api/strategies/published');
    return response.data;
  }

  /**
   * Import a published strategy
   */
  async importStrategy(strategyId: string, tradingWalletId: string): Promise<Strategy> {
    const response = await this.apiClient.post<Strategy>(`/api/strategies/import/${strategyId}`, {
      trading_wallet_id: tradingWalletId,
    });
    return response.data;
  }
}
