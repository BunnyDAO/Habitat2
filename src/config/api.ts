import { getConfigSync, getConfig } from './environment';

// API Configuration
export const API_CONFIG = {
  // Base URLs
  get BASE_URL() {
    return getConfigSync().apiBaseUrl;
  },
  
  get WS_URL() {
    return getConfigSync().wsUrl;
  },
  
  // API Version
  get API_VERSION() {
    return getConfigSync().apiVersion;
  },
  
  // Endpoints
  get API_BASE() {
    return `${this.BASE_URL}/api/${this.API_VERSION}`;
  },
  
  get WS_BASE() {
    return `${this.WS_URL}/api/${this.API_VERSION}/ws`;
  },
  
  get RPC_BASE() {
    return `${this.BASE_URL}/api/rpc`;
  },
  
  // Specific endpoints
  get JUPITER() {
    return {
      QUOTE: `${this.API_BASE}/jupiter/quote`,
      SWAP: `${this.API_BASE}/jupiter/swap`,
    };
  },
  
  get WALLET() {
    return {
      BALANCES: `${this.API_BASE}/wallet-balances`,
      UPDATE: (address: string) => `${this.API_BASE}/wallet-balances/${address}/update`,
    };
  },
  
  get CHART() {
    return {
      DATA: (tokenMint: string) => `${this.API_BASE}/chart-data/${tokenMint}`,
    };
  },
  
  get PRICE() {
    return {
      FEED: `${this.API_BASE}/price`,
    };
  },
  
  get WHALE() {
    return {
      TRACKING: `${this.API_BASE}/whale-tracking`,
    };
  },
  
  get TOKENS() {
    return {
      BATCH: `${this.API_BASE}/tokens/batch`,
    };
  },
};

// Helper to get the full config (useful for components that need to wait for config)
export const getFullConfig = async () => {
  const config = await getConfig();
  return {
    ...API_CONFIG,
    BASE_URL: config.apiBaseUrl,
    WS_URL: config.wsUrl,
    API_VERSION: config.apiVersion,
  };
}; 