import { getConfigSync } from './environment';

const config = getConfigSync();

// API Configuration
export const API_CONFIG = {
  BASE_URL: config.apiBaseUrl,
  API_VERSION: config.apiVersion,
  WS_BASE: config.wsUrl,
  JUPITER: {
    QUOTE: `${config.apiBaseUrl}/api/${config.apiVersion}/jupiter/quote`,
    SWAP: `${config.apiBaseUrl}/api/${config.apiVersion}/jupiter/swap`,
  },
  WALLET: {
    BALANCES: `${config.apiBaseUrl}/api/${config.apiVersion}/wallet/balances`,
    TOKENS: `${config.apiBaseUrl}/api/${config.apiVersion}/wallet/tokens`,
  },
  CHART: {
    DATA: `${config.apiBaseUrl}/api/${config.apiVersion}/chart/data`,
  },
  PRICE: {
    DATA: `${config.apiBaseUrl}/api/${config.apiVersion}/price/data`,
  },
  WHALE: {
    TRACKER: `${config.apiBaseUrl}/api/${config.apiVersion}/whale/tracker`,
  },
  TOKENS: {
    LIST: `${config.apiBaseUrl}/api/${config.apiVersion}/tokens/list`,
  },
} as const; 