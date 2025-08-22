import { config } from './environment';

// API Configuration based on environment
export const API_CONFIG = {
  BASE_URL: config.backendApiUrl,
  API_VERSION: config.apiVersion,
  WS_BASE: config.wsUrl,
  
  // API endpoints
  get API_BASE() {
    return `${this.BASE_URL}/api/${this.API_VERSION}`;
  },
  
  get WS_ENDPOINT() {
    return `${this.WS_BASE}/api/${this.API_VERSION}/ws`;
  },
  
  // Jupiter API endpoints
  JUPITER: {
    QUOTE: `${config.backendApiUrl}/api/${config.apiVersion}/jupiter/quote`,
    SWAP: `${config.backendApiUrl}/api/${config.apiVersion}/jupiter/swap`,
  },
  
  // Wallet API endpoints
  WALLET: {
    BALANCES: `${config.backendApiUrl}/api/${config.apiVersion}/wallet-balances`,
    TOKENS: `${config.backendApiUrl}/api/${config.apiVersion}/tokens`,
    UPDATE: (address: string) => `${config.backendApiUrl}/api/${config.apiVersion}/wallet-balances/${address}/update`,
  },
  
  // Chart API endpoints
  CHART: {
    DATA: (tokenMint: string) => `${config.backendApiUrl}/api/${config.apiVersion}/chart-data/${tokenMint}`,
  },
  
  // Price API endpoints
  PRICE: {
    DATA: `${config.backendApiUrl}/api/${config.apiVersion}/price`,
    FEED: `${config.backendApiUrl}/api/${config.apiVersion}/price-feed`,
  },
  
  // Whale tracking API endpoints
  WHALE: {
    TRACKER: `${config.backendApiUrl}/api/${config.apiVersion}/whale-tracking`,
  },
  
  // Token API endpoints
  TOKENS: {
    LIST: `${config.backendApiUrl}/api/${config.apiVersion}/tokens`,
    BATCH: `${config.backendApiUrl}/api/${config.apiVersion}/tokens/batch`,
    METADATA: `${config.backendApiUrl}/api/${config.apiVersion}/token-metadata`,
  },
  
  // Strategy API endpoints
  STRATEGIES: {
    BASE: `${config.backendApiUrl}/api/${config.apiVersion}/strategies`,
    CREATE: `${config.backendApiUrl}/api/strategies`,
    PUBLISH: `${config.backendApiUrl}/api/strategies/publish`,
  },
  
  // Trading wallet API endpoints
  TRADING_WALLETS: {
    BASE: `${config.backendApiUrl}/api/${config.apiVersion}/trading-wallets`,
    CREATE: `${config.backendApiUrl}/api/trading-wallets`,
    REVEAL_KEY: (address: string) => `${config.backendApiUrl}/api/trading-wallets/${address}/reveal-private-key`,
  },
  
  // Drift API endpoints
  DRIFT: {
    BASE: `${config.backendApiUrl}/api/${config.apiVersion}/drift`,
    POSITION: (jobId: string) => `${config.backendApiUrl}/api/${config.apiVersion}/drift/position/${jobId}`,
    WITHDRAW: `${config.backendApiUrl}/api/${config.apiVersion}/drift/withdraw-collateral`,
  },
  
  // Health check endpoint
  HEALTH: `${config.backendApiUrl}/health`,
} as const;

// Environment-specific API configuration
export const getApiConfig = () => {
  return {
    ...API_CONFIG,
    environment: config.environment,
    isDevelopment: config.isDevelopment,
    isStaging: config.isStaging,
    isProduction: config.isProduction,
  };
}; 