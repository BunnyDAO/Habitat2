import { TradingWallet } from '../types/wallet';

// Use the backend server URL
const TRADING_WALLETS_ENDPOINT = 'http://localhost:3001/api/v1/trading-wallets';

interface RawWallet {
  publicKey: string;
  secretKey: string;
  mnemonic: string;
  name?: string;
  createdAt: number;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

interface StoredTradingWallets {
  [ownerAddress: string]: TradingWallet[];
}

export const tradingWalletService = {
  async fetchWallets(ownerAddress: string): Promise<TradingWallet[]> {
    try {
      console.log('Fetching wallets for owner:', ownerAddress);
      const response = await fetch(`${TRADING_WALLETS_ENDPOINT}/${ownerAddress}`);
      if (!response.ok) {
        const errorData: ErrorResponse = await response.json();
        console.error('Error response:', errorData);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.error}`);
      }
      const wallets: RawWallet[] = await response.json();
      
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
      // Convert Uint8Array to base64 string for storage
      const walletToStore: RawWallet = {
        ...wallet,
        secretKey: Buffer.from(wallet.secretKey).toString('base64')
      };
      
      const response = await fetch(`${TRADING_WALLETS_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerAddress,
          wallet: walletToStore
        }),
      });

      if (!response.ok) {
        // If backend is not available, just log the error and continue
        console.warn('Backend not available, saving to localStorage only');
        return;
      }
    } catch (error) {
      console.warn('Error saving wallet to backend:', error);
      // Continue execution even if backend save fails
    }
  },

  async deleteWallet(publicKey: string): Promise<void> {
    try {
      // First try to delete from the backend
      try {
        const response = await fetch(`${TRADING_WALLETS_ENDPOINT}/${publicKey}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          console.warn(`Failed to delete wallet from backend: ${response.status} ${response.statusText}`);
          // Continue with local deletion even if backend fails
        }
      } catch (error) {
        console.warn('Error deleting wallet from backend:', error);
        // Continue with local deletion even if backend fails
      }

      // Always delete from localStorage
      const storedWallets = localStorage.getItem('tradingWallets');
      if (storedWallets) {
        const wallets: StoredTradingWallets = JSON.parse(storedWallets);
        const ownerAddress = Object.keys(wallets)[0]; // Get the first (and should be only) owner
        if (ownerAddress && wallets[ownerAddress]) {
          wallets[ownerAddress] = wallets[ownerAddress].filter((w: TradingWallet) => w.publicKey !== publicKey);
          localStorage.setItem('tradingWallets', JSON.stringify(wallets));
        }
      }

      // Clean up all wallet-related data from localStorage
      localStorage.removeItem(`wallet_balances_${publicKey}`);
      localStorage.removeItem(`wallet_${publicKey}`); // Remove the wallet secret key storage
      
    } catch (error) {
      console.error('Error deleting trading wallet:', error);
      throw error;
    }
  },

  async getWallets(ownerAddress: string): Promise<TradingWallet[]> {
    try {
      const response = await fetch(`${TRADING_WALLETS_ENDPOINT}/${ownerAddress}`);
      
      if (!response.ok) {
        console.warn('Backend not available, returning empty array');
        return [];
      }

      const wallets: RawWallet[] = await response.json();
      
      // Convert base64 secret keys back to Uint8Array
      return wallets.map((wallet: RawWallet) => ({
        ...wallet,
        secretKey: new Uint8Array(Buffer.from(wallet.secretKey, 'base64'))
      }));
    } catch (error) {
      console.warn('Error fetching wallets from backend:', error);
      return [];
    }
  }
}; 