import { Connection, PublicKey } from '@solana/web3.js';
import { createRateLimitedConnection } from '../utils/connection';

interface PriceData {
  time: number;  // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PoolData {
  address: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenABalance: number;
  tokenBBalance: number;
}

export class SolanaChartDataService {
  private static instance: SolanaChartDataService;
  private connection: Connection;
  private priceCache: Map<string, PriceData[]>;
  private poolCache: Map<string, PoolData>;
  private subscribers: Map<string, Set<(data: PriceData) => void>>;

  private constructor() {
    this.connection = new Connection(process.env.NEXT_PUBLIC_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
    this.priceCache = new Map();
    this.poolCache = new Map();
    this.subscribers = new Map();
  }

  public static getInstance(): SolanaChartDataService {
    if (!SolanaChartDataService.instance) {
      SolanaChartDataService.instance = new SolanaChartDataService();
    }
    return SolanaChartDataService.instance;
  }

  private async findPools(tokenMint: string): Promise<PoolData[]> {
    try {
      // Get Jupiter API route data for the token
      const response = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenMint}&amount=1000000000&slippageBps=50`);
      const data = await response.json();
      
      // Extract pool addresses from routes
      const pools = data.routes?.[0]?.marketInfos?.map((info: any) => ({
        address: info.amm.id,
        tokenAMint: info.inputMint,
        tokenBMint: info.outputMint,
        // We'll fetch balances separately
        tokenABalance: 0,
        tokenBBalance: 0
      })) || [];

      return pools;
    } catch (error) {
      console.error('Error finding pools:', error);
      return [];
    }
  }

  private async getPoolBalances(pool: PoolData): Promise<PoolData> {
    try {
      const account = await this.connection.getAccountInfo(new PublicKey(pool.address));
      if (!account) return pool;

      // Note: This is a simplified example. In reality, you'd need to:
      // 1. Decode pool data based on the AMM type (Raydium, Orca, etc)
      // 2. Handle different pool versions
      // 3. Account for decimals
      
      // For now, we'll just return the pool as is
      return pool;
    } catch (error) {
      console.error('Error getting pool balances:', error);
      return pool;
    }
  }

  public async getHistoricalPrices(
    tokenMint: string,
    resolution: string,
    from: number,
    to: number
  ): Promise<PriceData[]> {
    const cacheKey = `${tokenMint}-${resolution}`;
    const cachedData = this.priceCache.get(cacheKey) || [];
    
    // If we have cached data that covers the requested range, use it
    const filteredCache = cachedData.filter(d => d.time >= from && d.time <= to);
    if (filteredCache.length > 0) {
      return filteredCache;
    }

    try {
      // Find relevant pools
      const pools = await this.findPools(tokenMint);
      if (pools.length === 0) return [];

      // Get pool balances
      const poolsWithBalances = await Promise.all(
        pools.map(pool => this.getPoolBalances(pool))
      );

      // Store pools in cache
      poolsWithBalances.forEach(pool => {
        this.poolCache.set(pool.address, pool);
      });

      // For historical data, we'll need to:
      // 1. Use Helius getRawTransactions to get pool transactions
      // 2. Decode transactions to get swap amounts
      // 3. Calculate price impact and aggregate into candles
      // 4. Cache the results

      // For now, return placeholder data
      const data: PriceData[] = [];
      const interval = this.getIntervalInSeconds(resolution);
      for (let t = from; t <= to; t += interval) {
        data.push({
          time: t,
          open: 0,
          high: 0,
          low: 0,
          close: 0,
          volume: 0
        });
      }

      // Cache the data
      this.priceCache.set(cacheKey, [...cachedData, ...data]);

      return data;
    } catch (error) {
      console.error('Error fetching historical prices:', error);
      return [];
    }
  }

  public subscribeToRealtimePrice(
    tokenMint: string,
    callback: (data: PriceData) => void
  ): () => void {
    // Add subscriber
    if (!this.subscribers.has(tokenMint)) {
      this.subscribers.set(tokenMint, new Set());
      this.startPoolMonitoring(tokenMint);
    }
    this.subscribers.get(tokenMint)?.add(callback);

    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(tokenMint);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(tokenMint);
          this.stopPoolMonitoring(tokenMint);
        }
      }
    };
  }

  private async startPoolMonitoring(tokenMint: string) {
    const pools = await this.findPools(tokenMint);
    
    // Subscribe to pool account changes
    pools.forEach(pool => {
      this.connection.onAccountChange(
        new PublicKey(pool.address),
        (accountInfo) => {
          // Handle pool updates:
          // 1. Decode account data
          // 2. Calculate new price
          // 3. Notify subscribers
          
          const dummyData: PriceData = {
            time: Math.floor(Date.now() / 1000),
            open: 0,
            high: 0,
            low: 0,
            close: 0,
            volume: 0
          };

          this.subscribers.get(tokenMint)?.forEach(callback => callback(dummyData));
        }
      );
    });
  }

  private stopPoolMonitoring(tokenMint: string) {
    // Clean up subscriptions when needed
  }

  private getIntervalInSeconds(resolution: string): number {
    const intervals: { [key: string]: number } = {
      '1': 60,
      '5': 300,
      '15': 900,
      '30': 1800,
      '60': 3600,
      '240': 14400,
      '1D': 86400,
      '1W': 604800,
      '1M': 2592000
    };
    return intervals[resolution] || 3600;
  }

  async getTokenPriceChartData(tokenMint: string): Promise<any> {
    try {
      const response = await fetch(`http://localhost:3001/api/v1/chart-data/${tokenMint}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch chart data: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching chart data:', error);
      throw error;
    }
  }
} 