import { createClient } from 'redis';
import { HeliusService } from '../../../services/helius.service';
import { HermesClient } from '@pythnetwork/hermes-client';

const HERMES_ENDPOINT = 'https://hermes.pyth.network';

// Pyth Network price feed IDs
const PRICE_FEEDS: Record<string, string> = {
  'SOL': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'USDC': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  'USDT': '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b'
};

export class PriceFeedService {
  private redisClient: ReturnType<typeof createClient>;
  private heliusService: HeliusService;
  private hermesClient: HermesClient;

  constructor(redisClient: ReturnType<typeof createClient>, heliusService: HeliusService) {
    this.redisClient = redisClient;
    this.heliusService = heliusService;
    this.hermesClient = new HermesClient(HERMES_ENDPOINT);
    this.initializeCache();
  }

  private async initializeCache() {
    try {
      // Clear all price-related cache on startup
      const keys = await this.redisClient.keys('price:*');
      if (keys.length > 0) {
        await this.redisClient.del(keys);
        console.log('Cleared existing price cache');
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  private getPriceFeedId(token: string): string | null {
    const feedId = PRICE_FEEDS[token.toUpperCase()];
    if (!feedId) {
      console.log(`No price feed available for token: ${token}`);
      return null;
    }
    console.log(`Using price feed ID for ${token}: ${feedId}`);
    return feedId;
  }

  private getCacheKey(token: string): string {
    // Get current minute timestamp to ensure we get fresh prices
    const timestamp = Math.floor(Date.now() / 10000); // 10-second intervals
    return `price:${token}:${timestamp}`;
  }

  async getPrice(token: string): Promise<number> {
    try {
      const priceFeedId = this.getPriceFeedId(token);
      if (!priceFeedId) {
        return 0;
      }

      const cacheKey = this.getCacheKey(token);
      
      // Try to get from cache first
      const cachedPrice = await this.redisClient.get(cacheKey);
      if (cachedPrice) {
        console.log(`Cache hit for ${token}: ${cachedPrice}`);
        return parseFloat(cachedPrice);
      }

      console.log(`Cache miss for ${token}, fetching new price...`);

      // If not in cache, fetch from Pyth Network
      const url = `${HERMES_ENDPOINT}/api/latest_price_feeds?ids[]=${priceFeedId}`;
      console.log(`Fetching latest price for ${token} from:`, url);
      
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
      console.log(`Received price data for ${token}:`, JSON.stringify(data, null, 2));
      
      if (data && Array.isArray(data) && data.length > 0) {
        const priceFeed = data[0];
        if (priceFeed && priceFeed.price) {
          const price = Number(priceFeed.price.price) * Math.pow(10, priceFeed.price.expo);
          console.log(`Updated price for ${token}: ${price}`);
          
          // Cache the price for 10 seconds
          await this.redisClient.set(cacheKey, price.toString(), {
            EX: 10 // 10 seconds
          });

          return price;
        }
      }

      return 0;
    } catch (error) {
      console.error(`Error fetching price for ${token}:`, error);
      throw error;
    }
  }

  async getPrices(tokens: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};
    for (const token of tokens) {
      try {
        prices[token] = await this.getPrice(token);
      } catch (error) {
        console.error(`Error fetching price for ${token}:`, error);
        prices[token] = 0;
      }
    }
    return prices;
  }
} 