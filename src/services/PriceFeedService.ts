import { EventEmitter } from 'events';
import { HermesClient } from '@pythnetwork/hermes-client';

const PRICE_UPDATE_INTERVAL = 5000; // 5 seconds
const SOL_PRICE_FEED = '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'; // SOL/USD feed ID
const HERMES_ENDPOINT = 'https://hermes.pyth.network'; // Production mainnet endpoint
const RECONNECT_DELAY = 5000; // 5 seconds delay before reconnecting
const MAX_SSE_RETRIES = 2; // Maximum number of SSE connection attempts before falling back to polling

// Debug flag to help identify which version of the code is running
const CODE_VERSION = 'v2.0.0';

export class PriceFeedService extends EventEmitter {
  private static instance: PriceFeedService;
  private prices: { [symbol: string]: number } = {};
  private updateInterval: NodeJS.Timeout | null = null;
  private retryCount: number = 0;
  private readonly MAX_RETRIES = 3;
  private hermesClient: HermesClient;
  private eventSource: EventSource | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private sseRetryCount: number = 0;

  private constructor() {
    super();
    this.hermesClient = new HermesClient(HERMES_ENDPOINT);
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
      await this.subscribeToPriceFeeds();
      this.updateInterval = setInterval(() => this.checkConnection(), PRICE_UPDATE_INTERVAL);
    } catch (error) {
      console.error('Error starting PriceFeedService:', error);
      this.startPolling(); // Fall back to polling on startup error
      throw error;
    }
  }

  public stop(): void {
    console.log('Stopping PriceFeedService');
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  public getPrice(symbol: string): number {
    return this.prices[symbol.toLowerCase()] || 0;
  }

  private async fetchLatestPrice(): Promise<void> {
    try {
      // Use the correct endpoint for fetching latest prices
      const url = `${HERMES_ENDPOINT}/api/latest_price_feeds?ids[]=${SOL_PRICE_FEED}`;
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
      
      if (data && Array.isArray(data) && data.length > 0) {
        const priceFeed = data[0];
        if (priceFeed && priceFeed.price) {
          const price = Number(priceFeed.price.price) * Math.pow(10, priceFeed.price.expo);
          console.log(`[${CODE_VERSION}] Updated price:`, price);
          this.prices['sol'] = price;
          this.emit('price_update', { sol: price });
        }
      }
    } catch (error) {
      console.error(`[${CODE_VERSION}] Error fetching price:`, error);
      if (!this.pollInterval) {
        this.startPolling();
      }
    }
  }

  private startPolling(): void {
    console.log(`[${CODE_VERSION}] Starting price polling...`);
    if (!this.pollInterval) {
      // Initial fetch
      this.fetchLatestPrice();
      // Set up polling interval
      this.pollInterval = setInterval(() => this.fetchLatestPrice(), PRICE_UPDATE_INTERVAL);
    }
  }

  private async setupEventSource(): Promise<void> {
    if (this.sseRetryCount >= MAX_SSE_RETRIES) {
      console.log(`[${CODE_VERSION}] SSE connection failed ${MAX_SSE_RETRIES} times, switching to polling`);
      this.startPolling();
      return;
    }

    if (this.eventSource) {
      console.log(`[${CODE_VERSION}] Closing existing event source`);
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.reconnectTimeout) {
      console.log(`[${CODE_VERSION}] Clearing reconnect timeout`);
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    try {
      // Use the correct streaming endpoint
      const streamUrl = new URL(`${HERMES_ENDPOINT}/price/stream`);
      streamUrl.searchParams.append('feed_id', SOL_PRICE_FEED);
      console.log(`[${CODE_VERSION}] Setting up price feed stream:`, streamUrl.toString());
      
      this.eventSource = new EventSource(streamUrl.toString());
      
      this.eventSource.onopen = () => {
        console.log(`[${CODE_VERSION}] Price feed stream connected successfully`);
        this.retryCount = 0;
        this.sseRetryCount = 0;
        
        if (this.pollInterval) {
          console.log(`[${CODE_VERSION}] Stream connected, stopping polling`);
          clearInterval(this.pollInterval);
          this.pollInterval = null;
        }
      };
      
      this.eventSource.onmessage = (event) => {
        try {
          const rawData = JSON.parse(event.data);
          console.log(`[${CODE_VERSION}] Received price update:`, rawData);
          
          if (rawData && rawData.price) {
            const price = Number(rawData.price) * Math.pow(10, rawData.expo || 0);
            console.log(`[${CODE_VERSION}] New price:`, price);
            this.prices['sol'] = price;
            this.emit('price_update', { sol: price });
          }
        } catch (error) {
          console.error(`[${CODE_VERSION}] Error processing price update:`, error);
          this.retryCount++;
        }
      };

      this.eventSource.onerror = (error) => {
        console.error(`[${CODE_VERSION}] Stream connection error:`, error);
        this.sseRetryCount++;
        
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }

        if (this.sseRetryCount >= MAX_SSE_RETRIES) {
          console.log(`[${CODE_VERSION}] Stream connection failed, switching to polling`);
          this.startPolling();
        } else {
          console.log(`[${CODE_VERSION}] Stream connection failed (attempt ${this.sseRetryCount}/${MAX_SSE_RETRIES}), retrying...`);
          this.reconnectTimeout = setTimeout(() => {
            this.setupEventSource().catch(err => {
              console.error(`[${CODE_VERSION}] Failed to reconnect stream:`, err);
              if (!this.pollInterval) {
                this.startPolling();
              }
            });
          }, RECONNECT_DELAY);
        }
      };
    } catch (error) {
      console.error(`[${CODE_VERSION}] Error setting up stream:`, error);
      this.sseRetryCount++;
      if (this.sseRetryCount >= MAX_SSE_RETRIES || !this.pollInterval) {
        this.startPolling();
      }
    }
  }

  private async subscribeToPriceFeeds(): Promise<void> {
    try {
      console.log(`[${CODE_VERSION}] Subscribing to price feeds...`);
      // Get initial price
      await this.fetchLatestPrice();

      // Try to set up streaming
      await this.setupEventSource();
    } catch (error) {
      console.error(`[${CODE_VERSION}] Error in price feed subscription:`, error);
      if (!this.pollInterval) {
        this.startPolling();
      }
    }
  }

  private async checkConnection(): Promise<void> {
    if (this.retryCount >= this.MAX_RETRIES && !this.pollInterval) {
      console.log(`[${CODE_VERSION}] Checking connection status...`);
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      if (this.sseRetryCount >= MAX_SSE_RETRIES) {
        console.log(`[${CODE_VERSION}] Max SSE retries reached, sticking to polling`);
        this.startPolling();
      } else {
        await this.subscribeToPriceFeeds();
        this.retryCount = 0;
      }
    }
  }
} 