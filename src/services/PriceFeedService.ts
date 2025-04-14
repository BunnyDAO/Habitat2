import { EventEmitter } from 'events';

const PRICE_UPDATE_INTERVAL = 10000; // 10 seconds to match backend cache
const BACKEND_ENDPOINT = 'http://localhost:3001/api/v1/price';
const RECONNECT_DELAY = 5000; // 5 seconds delay before reconnecting
const MAX_RETRIES = 3;

// Debug flag to help identify which version of the code is running
const CODE_VERSION = 'v3.0.0';

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
      await this.fetchLatestPrice();
      this.updateInterval = setInterval(() => this.fetchLatestPrice(), PRICE_UPDATE_INTERVAL);
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
    return this.prices[symbol.toLowerCase()] || 0;
  }

  private async fetchLatestPrice(): Promise<void> {
    try {
      const url = `${BACKEND_ENDPOINT}/SOL`;
      console.log(`[${CODE_VERSION}] Fetching latest price from:`, url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      const data = await response.json();
      console.log(`[${CODE_VERSION}] Received price data:`, data);
      
      if (data && typeof data.price === 'number') {
        const price = data.price;
        console.log(`[${CODE_VERSION}] Updated price:`, price);
        this.prices['sol'] = price;
        this.emit('price_update', { sol: price });
        this.retryCount = 0; // Reset retry count on successful fetch
      }
    } catch (error) {
      console.error(`[${CODE_VERSION}] Error fetching price:`, error);
      this.retryCount++;
      
      if (this.retryCount >= MAX_RETRIES) {
        console.error(`[${CODE_VERSION}] Max retries reached, stopping price updates`);
        this.stop();
      }
    }
  }
} 