import { TokenBalance, WalletBalanceResponse, WalletBalanceMap } from '../types/balance';

const WALLET_BALANCES_ENDPOINT = 'http://localhost:3001/api/wallet-balances';

export class WalletBalanceService {
  private refreshInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    // Initialize service
  }

  async initializeWallet(walletAddress: string) {
    try {
      // Initial population of database
      await this.populateDatabase(walletAddress);
      
      // Set up periodic refresh every 2 minutes
      this.startPeriodicRefresh(walletAddress);
    } catch (error) {
      console.error('Error initializing wallet:', error);
      throw error;
    }
  }

  private async populateDatabase(walletAddress: string) {
    try {
      await fetch(`${WALLET_BALANCES_ENDPOINT}/${walletAddress}/populate`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Error populating database:', error);
      throw error;
    }
  }

  private startPeriodicRefresh(walletAddress: string) {
    // Clear any existing interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    // Refresh every 2 minutes
    this.refreshInterval = setInterval(async () => {
      try {
        await this.populateDatabase(walletAddress);
      } catch (error) {
        console.error('Error in periodic refresh:', error);
      }
    }, 2 * 60 * 1000); // 2 minutes
  }

  cleanup() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  async fetchBalances(walletAddress: string): Promise<WalletBalanceMap> {
    try {
      const response = await fetch(`${WALLET_BALANCES_ENDPOINT}/${walletAddress}`);
      if (!response.ok) {
        throw new Error('Failed to fetch balances');
      }
      const data: WalletBalanceResponse = await response.json();
      
      // Convert array to map
      return data.balances.reduce((map, balance) => {
        map[balance.mintAddress] = balance;
        return map;
      }, {} as WalletBalanceMap);
    } catch (error) {
      console.error('Error fetching balances:', error);
      return {};
    }
  }

  async updateBalance(
    walletAddress: string,
    mintAddress: string,
    amount: number,
    decimals: number
  ): Promise<void> {
    try {
      const response = await fetch(WALLET_BALANCES_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddress,
          mintAddress,
          amount,
          decimals,
          lastUpdated: Date.now(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update balance');
      }
    } catch (error) {
      console.error('Error updating balance:', error);
      throw error;
    }
  }

  async deleteBalances(walletAddress: string): Promise<void> {
    try {
      const response = await fetch(`${WALLET_BALANCES_ENDPOINT}/${walletAddress}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete balances');
      }
    } catch (error) {
      console.error('Error deleting balances:', error);
      throw error;
    }
  }

  subscribeToBalanceUpdates(walletAddress: string, callback: (balances: WalletBalanceMap) => void) {
    // TODO: Implement real-time updates
    // For now, just return an empty unsubscribe function
    return () => {};
  }
} 