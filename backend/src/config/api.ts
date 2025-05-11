import { config } from './environment';

// All API URLs use config.backendApiUrl, which is set via BACKEND_API_URL env var (http://backend:3001 in Docker Compose)
export const API_CONFIG = {
  BASE_URL: config.backendApiUrl,
  API_VERSION: config.apiVersion,
  WS_BASE: config.wsUrl,
  JUPITER: {
    QUOTE: `${config.backendApiUrl}/api/${config.apiVersion}/jupiter/quote`,
    SWAP: `${config.backendApiUrl}/api/${config.apiVersion}/jupiter/swap`,
  },
  WALLET: {
    BALANCES: `${config.backendApiUrl}/api/${config.apiVersion}/wallet/balances`,
    TOKENS: `${config.backendApiUrl}/api/${config.apiVersion}/wallet/tokens`,
  },
  CHART: {
    DATA: `${config.backendApiUrl}/api/${config.apiVersion}/chart/data`,
  },
  PRICE: {
    DATA: `${config.backendApiUrl}/api/${config.apiVersion}/price/data`,
  },
  WHALE: {
    TRACKER: `${config.backendApiUrl}/api/${config.apiVersion}/whale/tracker`,
  },
  TOKENS: {
    LIST: `${config.backendApiUrl}/api/${config.apiVersion}/tokens/list`,
  },
} as const; 