/**
 * Trading Wallet API Client - Typed methods for wallet management
 */

import { ApiClient } from './api-client';

export interface TradingWallet {
  publicKey: string;
  name: string;
  createdAt: string;
}

export interface CreateTradingWalletRequest {
  ownerAddress: string;
  wallet: {
    name: string;
  };
}

export interface TradingWalletIdResponse {
  id: string;
  wallet_pubkey: string;
}

export class TradingWalletApiClient {
  constructor(private apiClient: ApiClient) {}

  /**
   * Get trading wallets for an owner
   */
  async getTradingWallets(ownerAddress: string): Promise<TradingWallet[]> {
    const response = await this.apiClient.get<TradingWallet[]>(`/api/trading-wallets/${ownerAddress}`);
    return response.data;
  }

  /**
   * Create a new trading wallet
   */
  async createTradingWallet(data: CreateTradingWalletRequest): Promise<TradingWallet> {
    const response = await this.apiClient.post<TradingWallet>('/api/trading-wallets', data);
    return response.data;
  }

  /**
   * Delete a trading wallet
   */
  async deleteTradingWallet(walletPubkey: string): Promise<void> {
    await this.apiClient.delete(`/api/trading-wallets/${walletPubkey}`);
  }

  /**
   * Get trading wallet ID by public key
   */
  async getTradingWalletId(walletPubkey: string): Promise<TradingWalletIdResponse> {
    const response = await this.apiClient.get<TradingWalletIdResponse>(
      `/api/trading-wallets/by-pubkey/${walletPubkey}`
    );
    return response.data;
  }
}
