import { TradingWallet } from '../types/wallet';

// Use relative path - this will work both locally and when deployed
const TRADING_WALLETS_ENDPOINT = '/api/trading-wallets';

export const tradingWalletService = {
  async fetchWallets(ownerAddress: string): Promise<TradingWallet[]> {
    try {
      console.log('Fetching wallets for owner:', ownerAddress);
      const response = await fetch(`${TRADING_WALLETS_ENDPOINT}/${ownerAddress}`);
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error response:', errorData);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.error}`);
      }
      const wallets = await response.json();
      console.log('Fetched wallets:', wallets);
      return wallets;
    } catch (error) {
      console.error('Error fetching trading wallets:', error);
      return [];
    }
  },

  async saveWallet(ownerAddress: string, wallet: TradingWallet): Promise<TradingWallet | null> {
    try {
      console.log('Saving wallet:', { ownerAddress, wallet });
      const response = await fetch(TRADING_WALLETS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ownerAddress, wallet }),
      });
      
      const responseData = await response.json();
      console.log('Save wallet response:', responseData);
      
      if (!response.ok) {
        console.error('Error saving wallet:', responseData);
        throw new Error(`Failed to save wallet: ${responseData.error}, details: ${responseData.details}`);
      }
      
      return responseData;
    } catch (error) {
      console.error('Error saving trading wallet:', error);
      throw error; // Propagate the error to be handled by the UI
    }
  },

  async deleteWallet(publicKey: string): Promise<boolean> {
    try {
      console.log('Deleting wallet:', publicKey);
      const response = await fetch(`${TRADING_WALLETS_ENDPOINT}/${publicKey}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error deleting wallet:', errorData);
        throw new Error(`Failed to delete wallet: ${errorData.error}`);
      }
      
      return true;
    } catch (error) {
      console.error('Error deleting trading wallet:', error);
      throw error; // Propagate the error to be handled by the UI
    }
  }
}; 