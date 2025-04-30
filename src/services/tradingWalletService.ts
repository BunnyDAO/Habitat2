import { TradingWallet } from '../types/wallet';
import apiClient from './api/api-client';
import { authService } from './auth.service';

// Use the backend server URL
const TRADING_WALLETS_ENDPOINT = '/trading-wallets';

interface RawWallet {
  publicKey: string;
  secretKey: string;
  mnemonic: string;
  name?: string;
  createdAt: number;
}

interface ErrorResponse {
  error: string;
}

interface StoredTradingWallets {
  [ownerAddress: string]: TradingWallet[];
}

export const tradingWalletService = {
  async fetchWallets(ownerAddress: string): Promise<TradingWallet[]> {
    try {
      console.log('Fetching wallets for owner:', ownerAddress);
      const response = await apiClient.get(`${TRADING_WALLETS_ENDPOINT}/${ownerAddress}`);
      const wallets: RawWallet[] = response.data;
      
      // Convert secretKey back to Uint8Array
      const processedWallets = wallets.map((wallet) => ({
        ...wallet,
        secretKey: new Uint8Array(Buffer.from(wallet.secretKey, 'base64'))
      }));
      
      console.log('Fetched wallets:', processedWallets);
      return processedWallets;
    } catch (error) {
      console.error('Error fetching trading wallets:', error);
      return [];
    }
  },

  async saveWallet(ownerAddress: string, wallet: TradingWallet): Promise<void> {
    try {
      // Ensure we have a valid auth token
      const token = await authService.getSession();
      if (!token) {
        // Try to sign in first
        const newToken = await authService.signIn(ownerAddress);
        if (!newToken) {
          throw new Error('Not authenticated');
        }
      }

      // Convert Uint8Array to base64 string for storage
      const walletToStore: RawWallet = {
        ...wallet,
        secretKey: Buffer.from(wallet.secretKey).toString('base64')
      };
      
      console.log('Saving wallet to endpoint:', TRADING_WALLETS_ENDPOINT);
      console.log('Request data:', { ownerAddress, wallet: walletToStore });
      
      const response = await apiClient.post(TRADING_WALLETS_ENDPOINT, {
        ownerAddress,
        wallet: walletToStore
      });

      console.log('Save wallet response:', response.data);
    } catch (error) {
      console.error('Error saving wallet:', error);
      throw error;
    }
  },

  async deleteWallet(publicKey: string): Promise<void> {
    try {
      await apiClient.delete(`${TRADING_WALLETS_ENDPOINT}/${publicKey}`);
    } catch (error) {
      console.error('Error deleting wallet:', error);
      throw error;
    }
  },

  async getWallets(ownerAddress: string): Promise<TradingWallet[]> {
    try {
      const response = await apiClient.get(`${TRADING_WALLETS_ENDPOINT}/${ownerAddress}`);
      const wallets: RawWallet[] = response.data;
      
      // Convert base64 secret keys back to Uint8Array
      return wallets.map((wallet: RawWallet) => ({
        ...wallet,
        secretKey: new Uint8Array(Buffer.from(wallet.secretKey, 'base64'))
      }));
    } catch (error) {
      console.warn('Error fetching wallets from backend:', error);
      return [];
    }
  },

  async getWalletId(publicKey: string): Promise<number> {
    try {
      const response = await apiClient.get(`${TRADING_WALLETS_ENDPOINT}/by-pubkey/${publicKey}`);
      if (!response.data || !response.data.id) {
        throw new Error('Trading wallet not found');
      }
      return response.data.id;
    } catch (error) {
      console.error('Error getting trading wallet ID:', error);
      throw error;
    }
  }
};

export default tradingWalletService; 