import { Redis } from 'ioredis';
import { HeliusService } from '../../../services/helius.service';

interface TokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  tokenAmount: number;
  mint: string;
}

interface Transaction {
  signature: string;
  timestamp: number;
  type: string;
  source: string;
  tokenTransfers: TokenTransfer[];
}

export class WhaleTrackingService {
  private redis: Redis | null;
  private heliusService: HeliusService;

  constructor(redis: Redis | null, heliusService: HeliusService) {
    this.redis = redis;
    this.heliusService = heliusService;
  }

  async getWhaleTransactions(address: string): Promise<Transaction[]> {
    try {
      // Check cache first
      const cacheKey = `whale:${address}`;
      if (this.redis) {
        const cachedData = await this.redis.get(cacheKey);
        if (cachedData) {
          return JSON.parse(cachedData);
        }
      }

      const transactions = await this.heliusService.getTransactions(address);
      
      // Cache the result for 1 minute
      if (this.redis) {
        await this.redis.setex(cacheKey, 60, JSON.stringify(transactions));
      }

      return transactions;
    } catch (error) {
      console.error('Error fetching whale transactions:', error);
      throw error;
    }
  }

  async getTokenPrice(mintAddress: string): Promise<number> {
    try {
      // Check cache first
      const cacheKey = `token:${mintAddress}`;
      if (this.redis) {
        const cachedPrice = await this.redis.get(cacheKey);
        if (cachedPrice) {
          return parseFloat(cachedPrice);
        }
      }

      const price = await this.heliusService.getTokenPrice(mintAddress);

      // Cache the result for 5 minutes
      if (this.redis) {
        await this.redis.setex(cacheKey, 300, price.toString());
      }

      return price;
    } catch (error) {
      console.error('Error fetching token price:', error);
      throw error;
    }
  }
} 