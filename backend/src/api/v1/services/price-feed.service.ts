import { createClient } from 'redis';
import { HeliusService } from '../../../services/helius.service';
import { HermesClient } from '@pythnetwork/hermes-client';

const HERMES_ENDPOINT = 'https://hermes.pyth.network';

// Pyth Network price feed IDs
const PRICE_FEEDS: Record<string, string> = {
  'SOL': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'BTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'ETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'AVAX': '0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7',
  'BNB': '0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f',
  'USDC': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  'USDT': '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b'
};

export class PriceFeedService {
  private heliusService: HeliusService;
  private hermesClient: HermesClient;
  private inMemoryCache: { [key: string]: { price: number; timestamp: number } } = {};

  constructor(redisClient: ReturnType<typeof createClient> | null, heliusService: HeliusService) {
    this.heliusService = heliusService;
    this.hermesClient = new HermesClient(HERMES_ENDPOINT);
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
    const timestamp = Math.floor(Date.now() / 10000); // 10-second intervals
    return `price:${token}:${timestamp}`;
  }

  private async getCachedPrice(token: string): Promise<number | null> {
    const cacheKey = this.getCacheKey(token);
    
    // Check in-memory cache first
    const cached = this.inMemoryCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < 10000) { // 10 seconds
      return cached.price;
    }

    return null;
  }

  private async setCachedPrice(token: string, price: number): Promise<void> {
    const cacheKey = this.getCacheKey(token);
    this.inMemoryCache[cacheKey] = {
      price,
      timestamp: Date.now()
    };
  }

  async getPrice(token: string): Promise<number> {
    try {
      const priceFeedId = this.getPriceFeedId(token);
      if (!priceFeedId) {
        return 0;
      }

      // Try to get from cache
      const cachedPrice = await this.getCachedPrice(token);
      if (cachedPrice !== null) {
        console.log(`Cache hit for ${token}: ${cachedPrice}`);
        return cachedPrice;
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
          
          // Cache the price
          await this.setCachedPrice(token, price);

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