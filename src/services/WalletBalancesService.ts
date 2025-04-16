import { EventEmitter } from 'events';
import { WalletBalanceResponse } from '../types/balance';

const BACKEND_ENDPOINT = 'http://localhost:3001/api/v1';
const UPDATE_INTERVAL = 30000; // 30 seconds

export class WalletBalancesService extends EventEmitter {
  private static instance: WalletBalancesService;
  private balances: { [walletAddress: string]: WalletBalanceResponse } = {};
  private updateIntervals: { [walletAddress: string]: NodeJS.Timeout } = {};

  private constructor() {
    super();
    console.log('Initializing WalletBalancesService');
  }

  public static getInstance(): WalletBalancesService {
    if (!WalletBalancesService.instance) {
      WalletBalancesService.instance = new WalletBalancesService();
    }
    return WalletBalancesService.instance;
  }

  public async getBalances(walletAddress: string): Promise<WalletBalanceResponse> {
    try {
      const response = await fetch(`${BACKEND_ENDPOINT}/wallet-balances/${walletAddress}`);
      if (!response.ok) throw new Error('Failed to fetch balances');
      const data = await response.json();
      this.balances[walletAddress] = data;
      this.emit('balancesUpdated', walletAddress, data);
      return data;
    } catch (error) {
      console.error('Error fetching balances:', error);
      throw error;
    }
  }

  public async updateBalances(walletAddress: string): Promise<void> {
    try {
      const url = `${BACKEND_ENDPOINT}/wallet-balances/${walletAddress}/update`;
      console.log(`Updating balances for wallet: ${walletAddress}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // After update, fetch the latest balances
      await this.getBalances(walletAddress);
    } catch (error) {
      console.error(`Error updating balances for ${walletAddress}:`, error);
      throw error;
    }
  }

  public async deleteBalances(walletAddress: string): Promise<void> {
    try {
      const url = `${BACKEND_ENDPOINT}/wallet-balances/${walletAddress}`;
      console.log(`Deleting balances for wallet: ${walletAddress}`);
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      delete this.balances[walletAddress];
      this.emit('balancesUpdated', walletAddress, null);
    } catch (error) {
      console.error(`Error deleting balances for ${walletAddress}:`, error);
      throw error;
    }
  }

  public startAutoUpdate(walletAddress: string): void {
    // Stop any existing interval for this wallet
    this.stopAutoUpdate(walletAddress);

    // Initial fetch
    this.getBalances(walletAddress).catch(console.error);

    // Set up interval for updates
    this.updateIntervals[walletAddress] = setInterval(() => {
      this.getBalances(walletAddress).catch(console.error);
    }, UPDATE_INTERVAL);
  }

  public stopAutoUpdate(walletAddress: string): void {
    if (this.updateIntervals[walletAddress]) {
      clearInterval(this.updateIntervals[walletAddress]);
      delete this.updateIntervals[walletAddress];
    }
  }

  public getCachedBalances(walletAddress: string): WalletBalanceResponse | null {
    return this.balances[walletAddress] || null;
  }

  async hideToken(walletAddress: string, mintAddress: string): Promise<void> {
    try {
      const response = await fetch(`${BACKEND_ENDPOINT}/wallet-balances/hide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ walletAddress, mintAddress }),
      });
      if (!response.ok) throw new Error('Failed to hide token');
    } catch (error) {
      console.error('Error hiding token:', error);
      throw error;
    }
  }

  async unhideToken(walletAddress: string, mintAddress: string): Promise<void> {
    try {
      const response = await fetch(`${BACKEND_ENDPOINT}/wallet-balances/unhide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ walletAddress, mintAddress }),
      });
      if (!response.ok) throw new Error('Failed to unhide token');
    } catch (error) {
      console.error('Error unhiding token:', error);
      throw error;
    }
  }

  async getHiddenTokens(walletAddress: string): Promise<string[]> {
    try {
      const response = await fetch(`${BACKEND_ENDPOINT}/wallet-balances/${walletAddress}/hidden`);
      if (!response.ok) throw new Error('Failed to fetch hidden tokens');
      const data = await response.json();
      return data.hiddenTokens;
    } catch (error) {
      console.error('Error fetching hidden tokens:', error);
      throw error;
    }
  }
} 