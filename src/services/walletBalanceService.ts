import { WalletBalanceMap, WalletBalanceResponse } from '../types/balance';
import { API_CONFIG } from '../config/api';

const WALLET_BALANCES_ENDPOINT = API_CONFIG.WALLET.BALANCES;

export class WalletBalanceService {
  private refreshInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    // Initialize service
  }

  async initializeWallet(walletAddress: string) {
    try {
      console.log(`Initializing wallet: ${walletAddress}`);
      
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
      console.log(`Populating database for wallet: ${walletAddress}`);
      const response = await fetch(`${WALLET_BALANCES_ENDPOINT}/${walletAddress}/populate`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to populate database: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // After populating, immediately fetch the balances
      return await this.fetchBalances(walletAddress);
    } catch (error) {
      console.error('Error populating database:', error);
      throw error;
    }
  }

  private startPeriodicRefresh(walletAddress: string) {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    this.refreshInterval = setInterval(async () => {
      try {
        await this.updateBalances(walletAddress);
      } catch (error) {
        console.error('Error in periodic refresh:', error);
      }
    }, 120000); // 2 minutes
  }

  async updateBalances(walletAddress: string) {
    try {
      console.log(`Updating balances for wallet: ${walletAddress}`);
      const response = await fetch(`${WALLET_BALANCES_ENDPOINT}/${walletAddress}/update`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update balances: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // After updating, immediately fetch the latest balances
      const balances = await this.fetchBalances(walletAddress);

      // Dispatch event for UI update
      window.dispatchEvent(new CustomEvent('balanceUpdate', {
        detail: { walletAddress, balances }
      }));

      return balances;
    } catch (error) {
      console.error('Error updating balances:', error);
      throw error;
    }
  }

  cleanup() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  async fetchBalances(walletAddress: string): Promise<WalletBalanceMap> {
    try {
      console.log(`Fetching balances for wallet: ${walletAddress}`);
      const response = await fetch(`${WALLET_BALANCES_ENDPOINT}/${walletAddress}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch balances: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data: WalletBalanceResponse = await response.json();
      console.log(`Received balances for ${walletAddress}:`, data);
      
      // Convert array to map
      return data.balances.reduce((map, balance) => {
        map[balance.mint] = balance;
        return map;
      }, {} as WalletBalanceMap);
    } catch (error) {
      console.error('Error fetching balances:', error);
      throw error;
    }
  }

  async updateBalance(
    walletAddress: string,
    mintAddress: string,
    amount: number,
    decimals: number
  ): Promise<void> {
    try {
      console.log(`Updating single balance: ${walletAddress} ${mintAddress} ${amount}`);
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
        const errorText = await response.text();
        throw new Error(`Failed to update balance: ${response.status} ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error updating balance:', error);
      throw error;
    }
  }

  async deleteBalances(walletAddress: string): Promise<void> {
    try {
      console.log(`Deleting balances for wallet: ${walletAddress}`);
      const response = await fetch(`${WALLET_BALANCES_ENDPOINT}/${walletAddress}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete balances: ${response.status} ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error deleting balances:', error);
      throw error;
    }
  }

  subscribeToBalanceUpdates(walletAddress: string): () => void {
    // TODO: Implement real-time updates using WebSocket
    console.log(`Balance updates subscription requested for ${walletAddress}`);
    return () => {
      console.log(`Unsubscribing from balance updates for ${walletAddress}`);
    };
  }
} 