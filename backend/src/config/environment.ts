interface BackendConfig {
  port: number;
  apiVersion: string;
  isDevelopment: boolean;
  isStaging: boolean;
  isProduction: boolean;
  environment: 'development' | 'staging' | 'production';
  
  // Database configuration
  databaseUrl: string;
  databaseSsl: boolean | { rejectUnauthorized: boolean };
  
  // Redis configuration
  redisUrl: string;
  redisEnabled: boolean;
  
  // CORS configuration
  corsOrigins: string[];
  
  // API configuration
  backendApiUrl: string;
  wsUrl: string;
  
  // External services
  heliusApiKey: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  jwtSecret: string;
  
  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// Environment detection
const getEnvironment = (): 'development' | 'staging' | 'production' => {
  const env = process.env.NODE_ENV || 'development';
  const customEnv = process.env.APP_ENV;
  
  if (customEnv && ['development', 'staging', 'production'].includes(customEnv)) {
    return customEnv as 'development' | 'staging' | 'production';
  }
  
  if (env === 'production') return 'production';
  if (env === 'staging') return 'staging';
  return 'development';
};

// Environment-specific configurations
const environments: Record<'development' | 'staging' | 'production', Partial<BackendConfig>> = {
  development: {
    port: 3001,
    apiVersion: 'v1',
    isDevelopment: true,
    isStaging: false,
    isProduction: false,
    environment: 'development',
    databaseSsl: false,
    redisEnabled: true,
    corsOrigins: [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
      'http://localhost:4173'
    ],
    logLevel: 'debug'
  },
  staging: {
    port: 3001,
    apiVersion: 'v1',
    isDevelopment: false,
    isStaging: true,
    isProduction: false,
    environment: 'staging',
    databaseSsl: { rejectUnauthorized: false },
    redisEnabled: true,
    corsOrigins: [
      'https://staging-yourdomain.vercel.app',
      'https://staging.yourdomain.com',
      'http://localhost:5173'
    ],
    logLevel: 'info'
  },
  production: {
    port: 3001,
    apiVersion: 'v1',
    isDevelopment: false,
    isStaging: false,
    isProduction: true,
    environment: 'production',
    databaseSsl: { rejectUnauthorized: false },
    redisEnabled: true,
    corsOrigins: [
      'https://yourdomain.vercel.app',
      'https://yourdomain.com',
      'https://www.yourdomain.com'
    ],
    logLevel: 'warn'
  }
};

// Load environment variables
const loadConfig = (): BackendConfig => {
  const env = getEnvironment();
  const baseConfig = environments[env];
  
  // Required environment variables
  const requiredVars = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    HELIUS_API_KEY: process.env.HELIUS_API_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    JWT_SECRET: process.env.JWT_SECRET
  };
  
  // Check for missing required variables
  const missingVars = Object.entries(requiredVars)
    .filter(([_, value]) => !value)
    .map(([key, _]) => key);
  
  if (missingVars.length > 0) {
    console.warn(`⚠️ Missing environment variables: ${missingVars.join(', ')}`);
    console.warn(`⚠️ Using fallback values for ${env} environment`);
  }
  
  return {
    ...baseConfig,
    port: parseInt(process.env.PORT || baseConfig.port?.toString() || '3001', 10),
    apiVersion: process.env.API_VERSION || baseConfig.apiVersion || 'v1',
    isDevelopment: env === 'development',
    isStaging: env === 'staging',
    isProduction: env === 'production',
    environment: env,
    
    // Database configuration
    databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/habitat_dev',
    databaseSsl: baseConfig.databaseSsl || false,
    
    // Redis configuration
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    redisEnabled: baseConfig.redisEnabled !== false,
    
    // CORS configuration
    corsOrigins: process.env.CORS_ORIGINS 
      ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
      : baseConfig.corsOrigins || [],
    
    // API configuration
    backendApiUrl: process.env.BACKEND_API_URL || `http://localhost:${baseConfig.port || 3001}`,
    wsUrl: process.env.WS_URL || `ws://localhost:${baseConfig.port || 3001}`,
    
    // External services
    heliusApiKey: process.env.HELIUS_API_KEY || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
    
    // Logging
    logLevel: (process.env.LOG_LEVEL as BackendConfig['logLevel']) || baseConfig.logLevel || 'info'
  };
};

// Export the configuration
export const config = loadConfig();

// Export environment helpers
export const isDevelopment = () => config.isDevelopment;
export const isStaging = () => config.isStaging;
export const isProduction = () => config.isProduction;
export const getEnvironmentName = () => config.environment;
export const getLogLevel = () => config.logLevel; 