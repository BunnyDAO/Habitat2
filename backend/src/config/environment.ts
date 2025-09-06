// Reads BACKEND_API_URL from environment for all backend/daemon API calls.
interface EnvironmentConfig {
  port: number;
  apiVersion: string;
  isDevelopment: boolean;
  backendApiUrl: string;
  wsUrl: string;
}

// Default development configuration
const defaultConfig: EnvironmentConfig = {
  port: 3001,
  apiVersion: 'v1',
  isDevelopment: process.env.NODE_ENV !== 'production',
  backendApiUrl: process.env.BACKEND_API_URL || 'http://backend:3001',
  wsUrl: process.env.WS_URL || 'ws://backend:3001'
};

// Load environment variables
const loadConfig = (): EnvironmentConfig => {
  return {
    ...defaultConfig,
    port: parseInt(process.env.PORT || defaultConfig.port.toString(), 10),
    apiVersion: process.env.API_VERSION || defaultConfig.apiVersion,
    isDevelopment: process.env.NODE_ENV !== 'production',
    backendApiUrl: process.env.BACKEND_API_URL || defaultConfig.backendApiUrl,
    wsUrl: process.env.WS_URL || defaultConfig.wsUrl
  };
};

// Export the configuration
export const config = loadConfig(); 