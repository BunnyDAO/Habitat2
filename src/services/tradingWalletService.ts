import { TradingWallet } from '../types/wallet';
import apiClient from './api/api-client';
import { authService } from './auth.service';

// Use the backend server URL
const TRADING_WALLETS_ENDPOINT = '/trading-wallets';

interface RawWallet {
  id: string;
  publicKey: string;
  secretKey?: string; // base64
  mnemonic?: string;
  name?: string;
  createdAt: string;
}

export const tradingWalletService = {
  async fetchWallets(ownerAddress: string): Promise<TradingWallet[]> {
    try {
      console.log('Fetching wallets for owner:', ownerAddress);
      const response = await apiClient.get(`${TRADING_WALLETS_ENDPOINT}/${ownerAddress}`);
      const wallets: RawWallet[] = response.data;
      
      // Convert secretKey back to Uint8Array if present
      const processedWallets = wallets.map((wallet) => ({
        ...wallet,
        secretKey: wallet.secretKey ? new Uint8Array(Buffer.from(wallet.secretKey, 'base64')) : undefined
      }));
      
      console.log('Fetched wallets:', processedWallets);
      return processedWallets;
    } catch (error) {
      console.error('Error fetching trading wallets:', error);
      return [];
    }
  },

  async saveWallet(ownerAddress: string, wallet: Partial<TradingWallet> & { name?: string }): Promise<RawWallet | undefined> {
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

      // Only send name to backend for creation
      const requestWallet = { name: wallet.name };
      console.log('Saving wallet to endpoint:', TRADING_WALLETS_ENDPOINT);
      console.log('Request data:', { ownerAddress, wallet: requestWallet });
      
      // Call backend to create wallet
      const response = await apiClient.post(TRADING_WALLETS_ENDPOINT, {
        ownerAddress,
        wallet: requestWallet
      });
      
      if (!response.data) {
        throw new Error('No data received from backend');
      }
      
      const backendWallet: RawWallet = response.data;
      console.log('Save wallet response:', backendWallet);

      // Store secretKey in localStorage if present
      if (backendWallet.secretKey) {
        localStorage.setItem(`wallet_${backendWallet.publicKey}`, backendWallet.secretKey);
      }
      return backendWallet;
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
      
      // Convert base64 secret keys back to Uint8Array if present
      return wallets.map((wallet: RawWallet) => ({
        ...wallet,
        secretKey: wallet.secretKey ? new Uint8Array(Buffer.from(wallet.secretKey, 'base64')) : undefined
      }));
    } catch (error) {
      console.warn('Error fetching wallets from backend:', error);
      return [];
    }
  },

  async getWalletId(publicKey: string): Promise<{ id: number; wallet_pubkey: string }> {
    try {
      const response = await apiClient.get(`${TRADING_WALLETS_ENDPOINT}/by-pubkey/${publicKey}`);
      if (!response.data || !response.data.id) {
        throw new Error('Trading wallet not found');
      }
      return { id: response.data.id, wallet_pubkey: response.data.wallet_pubkey };
    } catch (error) {
      console.error('Error getting trading wallet ID:', error);
      throw error;
    }
  },

  async updateWalletName(publicKey: string, newName: string): Promise<void> {
    try {
      console.log(`Updating wallet name for ${publicKey} to "${newName}"`);
      const response = await apiClient.put(`${TRADING_WALLETS_ENDPOINT}/${publicKey}/name`, { 
        name: newName 
      });
      console.log('Wallet name update response:', response.data);
    } catch (error) {
      console.error('Error updating wallet name:', error);
      throw error;
    }
  }
};

export default tradingWalletService; 