import apiClient from './api/api-client';

export interface Token {
  mint_address: string;
  name: string;
  symbol: string;
  decimals: number;
  logo_uri: string;
  price_usd: number;
  price_last_updated: string;
}

export const tokenService = {
  async getTokens() {
    try {
      const response = await apiClient.get<Token[]>('/tokens');
      return response.data;
    } catch (error) {
      console.error('Error fetching tokens:', error);
      throw error;
    }
  },

  async getTokenByMint(mint: string) {
    try {
      const response = await apiClient.get<Token>(`/tokens/${mint}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching token:', error);
      throw error;
    }
  }
}; 