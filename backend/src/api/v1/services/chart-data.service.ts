import { Redis } from 'ioredis';
import { TokenService } from '../../../services/token.service';

export class ChartDataService {
  private redis: Redis | null;
  private tokenService: TokenService;

  constructor(redis: Redis | null, tokenService: TokenService) {
    this.redis = redis;
    this.tokenService = tokenService;
  }

  async getTokenPriceChartData(tokenMint: string): Promise<any> {
    try {
      // Check cache first
      const cacheKey = `chart:${tokenMint}`;
      if (this.redis) {
        const cachedData = await this.redis.get(cacheKey);
        if (cachedData) {
          return JSON.parse(cachedData);
        }
      }

      // Fetch from Jupiter API
      const response = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenMint}&amount=1000000000&slippageBps=50`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch chart data: ${response.statusText}`);
      }

      const data = await response.json();

      // Cache the result for 5 minutes
      if (this.redis) {
        await this.redis.setex(cacheKey, 300, JSON.stringify(data));
      }

      return data;
    } catch (error) {
      console.error('Error fetching chart data:', error);
      throw error;
    }
  }
} 