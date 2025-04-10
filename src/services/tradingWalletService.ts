import { TradingWallet } from '../types/wallet';

// Use relative path - this will work both locally and when deployed
const TRADING_WALLETS_ENDPOINT = '/api/trading-wallets';

export const tradingWalletService = {
  async fetchWallets(ownerAddress: string): Promise<TradingWallet[]> {
    try {
      const response = await fetch(`${TRADING_WALLETS_ENDPOINT}/${ownerAddress}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const wallets = await response.json();
      return wallets;
    } catch (error) {
      console.error('Error fetching trading wallets:', error);
      return [];
    }
  },

  async saveWallet(ownerAddress: string, wallet: TradingWallet): Promise<TradingWallet | null> {
    try {
      const response = await fetch(TRADING_WALLETS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ownerAddress, wallet }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error saving trading wallet:', error);
      return null;
    }
  },

  async deleteWallet(publicKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${TRADING_WALLETS_ENDPOINT}/${publicKey}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch (error) {
      console.error('Error deleting trading wallet:', error);
      return false;
    }
  }
}; 