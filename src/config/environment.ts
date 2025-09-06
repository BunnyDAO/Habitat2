interface EnvironmentConfig {
  apiBaseUrl: string;
  wsUrl: string;
  apiVersion: string;
  isDevelopment: boolean;
}

// Default development configuration
const defaultConfig: EnvironmentConfig = {
  apiBaseUrl: 'http://localhost:3001',
  wsUrl: 'ws://localhost:3001',
  apiVersion: 'v1',
  isDevelopment: true
};

// Load runtime configuration
const loadConfig = async (): Promise<EnvironmentConfig> => {
  try {
    // In production, this will be a JSON file hosted alongside your frontend
    const response = await fetch('/config.json');
    if (!response.ok) {
      console.warn('Failed to load config.json, using default config');
      return defaultConfig;
    }
    const config = await response.json();
    return {
      ...defaultConfig,
      ...config,
      isDevelopment: false
    };
  } catch (error) {
    console.warn('Error loading config.json, using default config:', error);
    return defaultConfig;
  }
};

// Create a promise that will resolve with the config
let configPromise: Promise<EnvironmentConfig> | null = null;

export const getConfig = async (): Promise<EnvironmentConfig> => {
  if (!configPromise) {
    configPromise = loadConfig();
  }
  return configPromise;
};

// For synchronous access to config (will use defaults until config is loaded)
export const getConfigSync = (): EnvironmentConfig => defaultConfig; 