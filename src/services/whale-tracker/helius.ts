import { WhaleWallet, Trade, WhaleTrackerConfig, WhaleAnalytics } from '../../types/whale-tracker/types';
import { API_CONFIG } from '../../config/api';

export class HeliusService {
  private static instance: HeliusService;
  private baseUrl: string;

  private constructor() {
    this.baseUrl = API_CONFIG.WHALE.TRACKING;
  }

  public static getInstance(): HeliusService {
    if (!HeliusService.instance) {
      HeliusService.instance = new HeliusService();
    }
    return HeliusService.instance;
  }

  async getTokenHolders(tokenMint: string, minAmount: number): Promise<WhaleWallet[]> {
    try {
      const response = await fetch(`${this.baseUrl}/token-holders?tokenMint=${tokenMint}&minAmount=${minAmount}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch token holders: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching token holders:', error);
      return [];
    }
  }

  async getWalletTrades(address: string, timeframe: number): Promise<Trade[]> {
    try {
      const response = await fetch(`${this.baseUrl}/wallet-trades?address=${address}&timeframe=${timeframe}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch wallet trades: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching wallet trades:', error);
      return [];
    }
  }

  async calculateTradesProfitability(trades: Trade[]): Promise<Trade[]> {
    try {
      const response = await fetch(`${this.baseUrl}/calculate-profitability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trades)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to calculate trade profitability: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error calculating trade profitability:', error);
      return trades;
    }
  }

  async getWhaleAnalytics(address: string, config: WhaleTrackerConfig): Promise<WhaleAnalytics> {
    try {
      const response = await fetch(`${this.baseUrl}/analytics/${address}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch whale analytics: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching whale analytics:', error);
      throw error;
    }
  }

  async getWhaleTrades(address: string, config: WhaleTrackerConfig): Promise<Trade[]> {
    try {
      const response = await fetch(`${this.baseUrl}/trades/${address}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch whale trades: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching whale trades:', error);
      throw error;
    }
  }

  async trackWhaleMovements(config: WhaleTrackerConfig) {
    try {
      // Set up WebSocket connection for real-time updates
      const ws = new WebSocket(`${this.baseUrl}/ws`);

      ws.onopen = () => {
        console.log('WebSocket connection established');
        // Subscribe to token mint address
        ws.send(JSON.stringify({
          type: 'subscribe',
          config
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'whale-movement') {
            // Dispatch custom event with whale movement data
            const whaleEvent = new CustomEvent('whale-movement', {
              detail: data.payload
            });
            
            window.dispatchEvent(whaleEvent);
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed');
        // Attempt to reconnect after a delay
        setTimeout(() => this.trackWhaleMovements(config), 5000);
      };

      return () => {
        ws.close();
      };
    } catch (error) {
      console.error('Error setting up whale tracking:', error);
      throw error;
    }
  }
} 