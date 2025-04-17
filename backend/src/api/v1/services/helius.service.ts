import { Redis } from 'ioredis';

interface TokenHolder {
  address: string;
  amount: string;
  decimals?: number;
  symbol?: string;
}

interface WhaleWallet {
  address: string;
  tokenHoldings: {
    mint: string;
    amount: number;
    symbol: string;
  }[];
}

interface Trade {
  timestamp: number;
  type: 'buy' | 'sell';
  tokenMint: string;
  amount: number;
  price: number;
  value: number;
}

export class HeliusService {
  private redis: Redis | null;
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly heliusApiKey: string;

  constructor(redis: Redis | null, heliusApiKey: string) {
    this.redis = redis;
    this.heliusApiKey = heliusApiKey;
  }

  async getTransactions(address: string): Promise<any[]> {
    try {
      // Check cache first
      const cacheKey = `helius:transactions:${address}`;
      if (this.redis) {
        const cachedTransactions = await this.redis.get(cacheKey);
        if (cachedTransactions) {
          return JSON.parse(cachedTransactions);
        }
      }

      const response = await fetch(
        `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${this.heliusApiKey}`
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch transactions: ${response.statusText}`);
      }

      const transactions = await response.json();

      // Cache the result
      if (this.redis) {
        await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(transactions));
      }

      return transactions;
    } catch (error) {
      console.error('Error fetching transactions:', error);
      throw error;
    }
  }

  async getTokenHolders(tokenMint: string, minAmount: number): Promise<WhaleWallet[]> {
    try {
      // Check cache first
      const cacheKey = `helius:holders:${tokenMint}:${minAmount}`;
      if (this.redis) {
        const cachedHolders = await this.redis.get(cacheKey);
        if (cachedHolders) {
          return JSON.parse(cachedHolders);
        }
      }

      const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'my-id',
          method: 'getTokenLargestAccounts',
          params: [tokenMint]
        })
      });

      const data = await response.json();
      const holders = data.result?.value || [];

      const whaleHolders = holders
        .filter((holder: TokenHolder) => {
          const amount = parseFloat(holder.amount) / Math.pow(10, holder.decimals || 0);
          return amount >= minAmount;
        })
        .map((holder: TokenHolder) => ({
          address: holder.address,
          tokenHoldings: [{
            mint: tokenMint,
            amount: parseFloat(holder.amount) / Math.pow(10, holder.decimals || 0),
            symbol: holder.symbol || 'Unknown'
          }]
        }));

      // Cache the result
      if (this.redis) {
        await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(whaleHolders));
      }

      return whaleHolders;
    } catch (error) {
      console.error('Error fetching token holders:', error);
      throw error;
    }
  }

  async getWalletTrades(address: string, timeframe: number): Promise<Trade[]> {
    try {
      // Check cache first
      const cacheKey = `helius:trades:${address}:${timeframe}`;
      if (this.redis) {
        const cachedTrades = await this.redis.get(cacheKey);
        if (cachedTrades) {
          return JSON.parse(cachedTrades);
        }
      }

      const endTime = new Date();
      const startTime = new Date();
      startTime.setDate(startTime.getDate() - timeframe);

      const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'my-id',
          method: 'searchTransactions',
          params: {
            account: address,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            type: 'SWAP'
          }
        })
      });

      const data = await response.json();
      const trades = this.parseTradesFromTransactions(data.result);

      // Cache the result
      if (this.redis) {
        await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(trades));
      }

      return trades;
    } catch (error) {
      console.error('Error fetching wallet trades:', error);
      throw error;
    }
  }

  private parseTradesFromTransactions(transactions: any[]): Trade[] {
    return transactions.map(tx => ({
      timestamp: new Date(tx.blockTime * 1000).getTime(),
      type: tx.type === 'SWAP' ? 'buy' : 'sell', // This is a simplification
      tokenMint: tx.tokenMint,
      amount: tx.amount,
      price: tx.price,
      value: tx.amount * tx.price
    }));
  }
} 