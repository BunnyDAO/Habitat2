import { Redis } from 'ioredis';

export class JupiterService {
  private redis: Redis | null;
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(redis: Redis | null) {
    this.redis = redis;
  }

  async getTokenPrice(tokenMint: string): Promise<number> {
    try {
      // Check cache first
      const cacheKey = `jupiter:price:${tokenMint}`;
      if (this.redis) {
        const cachedPrice = await this.redis.get(cacheKey);
        if (cachedPrice) {
          return parseFloat(cachedPrice);
        }
      }

      // Fetch from Jupiter API
      const response = await fetch(`https://price.jup.ag/v4/price?ids=${tokenMint}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch token price: ${response.statusText}`);
      }

      const data = await response.json();
      const price = data.data[tokenMint]?.price || 0;

      // Cache the result
      if (this.redis) {
        await this.redis.setex(cacheKey, this.CACHE_TTL, price.toString());
      }

      return price;
    } catch (error) {
      console.error('Error fetching token price:', error);
      throw error;
    }
  }

  async getTokenPrices(tokenMints: string[]): Promise<Record<string, number>> {
    try {
      // Check cache first
      const cacheKey = `jupiter:prices:${tokenMints.join(',')}`;
      if (this.redis) {
        const cachedPrices = await this.redis.get(cacheKey);
        if (cachedPrices) {
          return JSON.parse(cachedPrices);
        }
      }

      // Fetch from Jupiter API
      const response = await fetch(`https://price.jup.ag/v4/price?ids=${tokenMints.join(',')}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch token prices: ${response.statusText}`);
      }

      const data = await response.json();
      const prices: Record<string, number> = {};

      tokenMints.forEach(mint => {
        prices[mint] = data.data[mint]?.price || 0;
      });

      // Cache the result
      if (this.redis) {
        await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(prices));
      }

      return prices;
    } catch (error) {
      console.error('Error fetching token prices:', error);
      throw error;
    }
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50
  ): Promise<any> {
    try {
      // Check cache first
      const cacheKey = `jupiter:quote:${inputMint}:${outputMint}:${amount}`;
      if (this.redis) {
        const cachedQuote = await this.redis.get(cacheKey);
        if (cachedQuote) {
          return JSON.parse(cachedQuote);
        }
      }

      // Fetch from Jupiter API
      const response = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`
      );

      if (!response.ok) {
        throw new Error(`Failed to get quote: ${response.statusText}`);
      }

      const quote = await response.json();

      // Cache the result
      if (this.redis) {
        await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(quote));
      }

      return quote;
    } catch (error) {
      console.error('Error fetching quote:', error);
      throw error;
    }
  }

  async getAllTokens(): Promise<any[]> {
    try {
      // Check cache first
      const cacheKey = 'jupiter:tokens:all';
      if (this.redis) {
        const cachedTokens = await this.redis.get(cacheKey);
        if (cachedTokens) {
          return JSON.parse(cachedTokens);
        }
      }

      // Fetch from Jupiter API
      const response = await fetch('https://token.jup.ag/all');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch tokens: ${response.statusText}`);
      }

      const tokens = await response.json();

      // Cache the result
      if (this.redis) {
        await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(tokens));
      }

      return tokens;
    } catch (error) {
      console.error('Error fetching tokens:', error);
      throw error;
    }
  }
} 