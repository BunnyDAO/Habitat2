import apiClient from './api-client';

export interface WhaleWallet {
  address: string;
  tokenHoldings: {
    mint: string;
    amount: number;
    symbol: string;
  }[];
}

export interface Trade {
  timestamp: number;
  type: 'buy' | 'sell';
  tokenMint: string;
  amount: number;
  price: number;
  value: number;
}

export const getTransactions = async (address: string): Promise<any[]> => {
  try {
    const response = await apiClient.get(`/helius/transactions/${address}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching transactions:', error);
    throw error;
  }
};

export const getTokenHolders = async (tokenMint: string, minAmount: number): Promise<WhaleWallet[]> => {
  try {
    const response = await apiClient.get(`/helius/token-holders/${tokenMint}`, {
      params: { minAmount }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching token holders:', error);
    throw error;
  }
};

export const getWalletTrades = async (address: string, timeframe: number = 7): Promise<Trade[]> => {
  try {
    const response = await apiClient.get(`/helius/wallet-trades/${address}`, {
      params: { timeframe }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching wallet trades:', error);
    throw error;
  }
}; 