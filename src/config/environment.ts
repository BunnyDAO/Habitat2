interface EnvironmentConfig {
  apiBaseUrl: string;
  wsUrl: string;
  apiVersion: string;
  isDevelopment: boolean;
  isStaging: boolean;
  isProduction: boolean;
  environment: 'development' | 'staging' | 'production';
}

// Environment detection
const getEnvironment = (): 'development' | 'staging' | 'production' => {
  const mode = import.meta.env.MODE;
  const viteMode = import.meta.env.VITE_ENV;
  
  if (viteMode) return viteMode as 'development' | 'staging' | 'production';
  if (mode === 'production') return 'production';
  if (mode === 'staging') return 'staging';
  return 'development';
};

// Environment-specific configurations
const environments: Record<'development' | 'staging' | 'production', EnvironmentConfig> = {
  development: {
    apiBaseUrl: 'http://localhost:3001',
    wsUrl: 'ws://localhost:3001',
    apiVersion: 'v1',
    isDevelopment: true,
    isStaging: false,
    isProduction: false,
    environment: 'development'
  },
  staging: {
    apiBaseUrl: 'https://staging-backend.railway.app',
    wsUrl: 'wss://staging-backend.railway.app',
    apiVersion: 'v1',
    isDevelopment: false,
    isStaging: true,
    isProduction: false,
    environment: 'staging'
  },
  production: {
    apiBaseUrl: 'https://production-backend.railway.app',
    wsUrl: 'wss://production-backend.railway.app',
    apiVersion: 'v1',
    isDevelopment: false,
    isStaging: false,
    isProduction: true,
    environment: 'production'
  }
};

// Get current environment configuration
const getCurrentConfig = (): EnvironmentConfig => {
  const env = getEnvironment();
  return environments[env];
};

// Default configuration (development)
const defaultConfig: EnvironmentConfig = environments.development;

// Load runtime configuration (for production config.json override)
const loadRuntimeConfig = async (): Promise<EnvironmentConfig> => {
  try {
    // In production, this will be a JSON file hosted alongside your frontend
    const response = await fetch('/config.json');
    if (!response.ok) {
      console.warn('Failed to load config.json, using environment-based config');
      return getCurrentConfig();
    }
    const config = await response.json();
    
    // Merge with current environment config
    return {
      ...getCurrentConfig(),
      ...config,
      // Preserve environment flags
      isDevelopment: config.isDevelopment ?? getCurrentConfig().isDevelopment,
      isStaging: config.isStaging ?? getCurrentConfig().isStaging,
      isProduction: config.isProduction ?? getCurrentConfig().isProduction,
      environment: config.environment ?? getCurrentConfig().environment
    };
  } catch (error) {
    console.warn('Error loading config.json, using environment-based config:', error);
    return getCurrentConfig();
  }
};

// Create a promise that will resolve with the config
let configPromise: Promise<EnvironmentConfig> | null = null;

export const getConfig = async (): Promise<EnvironmentConfig> => {
  if (!configPromise) {
    configPromise = loadRuntimeConfig();
  }
  return configPromise;
};

// For synchronous access to config (will use current environment until config is loaded)
export const getConfigSync = (): EnvironmentConfig => getCurrentConfig();

// Export environment helpers
export const isDevelopment = () => getCurrentConfig().isDevelopment;
export const isStaging = () => getCurrentConfig().isStaging;
export const isProduction = () => getCurrentConfig().isProduction;
export const getEnvironmentName = () => getCurrentConfig().environment; 