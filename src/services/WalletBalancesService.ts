import { EventEmitter } from 'events';
import { TokenBalance, WalletBalanceResponse } from '../types/balance';

const BACKEND_ENDPOINT = 'http://localhost:3001/api/v1/wallet-balances';
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
      const url = `${BACKEND_ENDPOINT}/${walletAddress}`;
      console.log(`Fetching balances for wallet: ${walletAddress}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log(`Received balances for ${walletAddress}:`, data);
      
      this.balances[walletAddress] = data;
      this.emit('balances_update', { walletAddress, balances: data });
      
      return data;
    } catch (error) {
      console.error(`Error fetching balances for ${walletAddress}:`, error);
      throw error;
    }
  }

  public async updateBalances(walletAddress: string): Promise<void> {
    try {
      const url = `${BACKEND_ENDPOINT}/${walletAddress}/update`;
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
      const url = `${BACKEND_ENDPOINT}/${walletAddress}`;
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
      this.emit('balances_update', { walletAddress, balances: null });
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
} 