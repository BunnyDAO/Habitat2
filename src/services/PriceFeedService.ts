import { EventEmitter } from 'events';
import { API_CONFIG } from '../config/api';

const PRICE_UPDATE_INTERVAL = 10000; // 10 seconds to match backend cache
const BACKEND_ENDPOINT = API_CONFIG.PRICE.FEED;
const RECONNECT_DELAY = 5000; // 5 seconds delay before reconnecting
const MAX_RETRIES = 3;

// Debug flag to help identify which version of the code is running
const CODE_VERSION = 'v4.0.0';

// Supported assets for price tracking
const SUPPORTED_ASSETS = ['SOL', 'BTC', 'ETH', 'AVAX', 'BNB'];

export class PriceFeedService extends EventEmitter {
  private static instance: PriceFeedService;
  private prices: { [symbol: string]: number } = {};
  private updateInterval: NodeJS.Timeout | null = null;
  private retryCount: number = 0;

  private constructor() {
    super();
    console.log(`Initializing PriceFeedService ${CODE_VERSION}`);
  }

  public static getInstance(): PriceFeedService {
    if (!PriceFeedService.instance) {
      PriceFeedService.instance = new PriceFeedService();
    }
    return PriceFeedService.instance;
  }

  public async start(): Promise<void> {
    console.log(`Starting PriceFeedService ${CODE_VERSION}`);
    try {
      await this.fetchLatestPrices();
      this.updateInterval = setInterval(() => this.fetchLatestPrices(), PRICE_UPDATE_INTERVAL);
    } catch (error) {
      console.error('Error starting PriceFeedService:', error);
      throw error;
    }
  }

  public stop(): void {
    console.log('Stopping PriceFeedService');
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  public getPrice(symbol: string): number {
    const normalizedSymbol = symbol.toUpperCase();
    return this.prices[normalizedSymbol] || 0;
  }

  public getAllPrices(): { [symbol: string]: number } {
    return { ...this.prices };
  }

  public getAssetPriceFromMarket(marketSymbol: string): number {
    // Extract base asset from market symbol (e.g., "SOL-PERP" -> "SOL")
    const baseAsset = marketSymbol.replace('-PERP', '');
    return this.getPrice(baseAsset);
  }

  private async fetchLatestPrices(): Promise<void> {
    try {
      // Fetch prices for all supported assets
      const pricePromises = SUPPORTED_ASSETS.map(async (asset) => {
        try {
          const url = `${BACKEND_ENDPOINT}/${asset}`;
          console.log(`[${CODE_VERSION}] Fetching price for ${asset} from:`, url);
          
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            },
          });

          if (response.ok) {
            const data = await response.json();
            if (data && typeof data.price === 'number') {
              const price = data.price;
              console.log(`[${CODE_VERSION}] Updated price for ${asset}:`, price);
              this.prices[asset] = price;
              return { asset, price };
            } else {
              console.log(`[${CODE_VERSION}] Invalid price data for ${asset}:`, data);
            }
          } else {
            console.log(`[${CODE_VERSION}] HTTP error for ${asset}: ${response.status}`);
          }
        } catch (error) {
          console.error(`[${CODE_VERSION}] Error fetching price for ${asset}:`, error);
        }
        return null;
      });

      const results = await Promise.all(pricePromises);
      const validResults = results.filter(result => result !== null);

      if (validResults.length > 0) {
        // Emit price update event with all prices
        this.emit('price_update', this.prices);
        this.retryCount = 0; // Reset retry count on successful fetch
        console.log(`[${CODE_VERSION}] Updated ${validResults.length} asset prices:`, validResults.map(r => `${r?.asset}: ${r?.price}`));
      } else {
        console.log(`[${CODE_VERSION}] No valid prices fetched for any assets`);
      }
    } catch (error) {
      console.error(`[${CODE_VERSION}] Error fetching prices:`, error);
      this.retryCount++;
      
      if (this.retryCount >= MAX_RETRIES) {
        console.error(`[${CODE_VERSION}] Max retries reached, stopping price updates`);
        this.stop();
      }
    }
  }
} 