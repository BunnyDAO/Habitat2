import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment configurations
const environments = {
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

// Get environment from command line argument or default to development
const env = process.argv[2] || 'development';

if (!environments[env]) {
  console.error(`❌ Invalid environment: ${env}`);
  console.error('Available environments:', Object.keys(environments).join(', '));
  process.exit(1);
}

const config = environments[env];

console.log(`🚀 Setting up ${env} environment configuration...`);
console.log(`📡 API Base URL: ${config.apiBaseUrl}`);
console.log(`🔌 WebSocket URL: ${config.wsUrl}`);

// Ensure public directory exists
const publicDir = path.join(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
  console.log('📁 Created public directory');
}

// Write config file
const configPath = path.join(publicDir, 'config.json');
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

console.log(`✅ Created ${env} configuration at ${configPath}`);

// Create environment-specific .env files for backend
const backendDir = path.join(__dirname, '../backend');
if (fs.existsSync(backendDir)) {
  console.log('🔧 Setting up backend environment files...');
  
  // Create .env.development
  const devEnvPath = path.join(backendDir, '.env.development');
  const devEnvContent = `# Development Environment
NODE_ENV=development
APP_ENV=development
PORT=3001
DATABASE_URL=postgresql://localhost:5432/Lackey_dev
REDIS_URL=redis://localhost:6379
HELIUS_API_KEY=your_development_helius_key
SUPABASE_URL=your_development_supabase_url
SUPABASE_ANON_KEY=your_development_supabase_key
JWT_SECRET=dev-secret-key-change-in-production
LOG_LEVEL=debug
CORS_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:3000,http://localhost:4173
`;
  fs.writeFileSync(devEnvPath, devEnvContent);
  console.log('✅ Created .env.development');
  
  // Create .env.staging
  const stagingEnvPath = path.join(backendDir, '.env.staging');
  const stagingEnvContent = `# Staging Environment
NODE_ENV=staging
APP_ENV=staging
PORT=3001
DATABASE_URL=your_staging_supabase_url
REDIS_URL=your_staging_upstash_url
HELIUS_API_KEY=your_staging_helius_key
SUPABASE_URL=your_staging_supabase_url
SUPABASE_ANON_KEY=your_staging_supabase_key
JWT_SECRET=staging-secret-key-change-in-production
LOG_LEVEL=info
CORS_ORIGINS=https://staging-yourdomain.vercel.app,https://staging.yourdomain.com,http://localhost:5173
`;
  fs.writeFileSync(stagingEnvPath, stagingEnvContent);
  console.log('✅ Created .env.staging');
  
  // Create .env.production
  const prodEnvPath = path.join(backendDir, '.env.production');
  const prodEnvContent = `# Production Environment
NODE_ENV=production
APP_ENV=production
PORT=3001
DATABASE_URL=your_production_supabase_url
REDIS_URL=your_production_upstash_url
HELIUS_API_KEY=your_production_helius_key
SUPABASE_URL=your_production_supabase_url
SUPABASE_ANON_KEY=your_production_supabase_key
JWT_SECRET=your_production_jwt_secret
LOG_LEVEL=warn
CORS_ORIGINS=https://yourdomain.vercel.app,https://yourdomain.com,https://www.yourdomain.com
`;
  fs.writeFileSync(prodEnvPath, prodEnvContent);
  console.log('✅ Created .env.production');
  
  // Create .env.example
  const exampleEnvPath = path.join(backendDir, '.env.example');
  const exampleEnvContent = `# Environment Configuration Example
# Copy this file to .env.{environment} and fill in your values

# Environment
NODE_ENV=development
APP_ENV=development
PORT=3001

# Database
DATABASE_URL=postgresql://username:password@localhost:5432/database_name

# Redis
REDIS_URL=redis://localhost:6379

# External Services
HELIUS_API_KEY=your_helius_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key

# Security
JWT_SECRET=your_jwt_secret_key

# Logging
LOG_LEVEL=debug

# CORS (comma-separated origins)
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
`;
  fs.writeFileSync(exampleEnvPath, exampleEnvContent);
  console.log('✅ Created .env.example');
}

console.log('\n🎉 Environment setup complete!');
console.log('\n📋 Next steps:');
console.log(`1. Update the backend .env.${env} file with your actual values`);
console.log(`2. Run 'npm run dev' to start development`);
console.log(`3. Run 'npm run build:${env}' to build for ${env}`);
console.log(`4. Deploy to your ${env} environment`);

// Validate configuration
console.log('\n🔍 Configuration validation:');
console.log(`   Environment: ${config.environment}`);
console.log(`   API Base: ${config.apiBaseUrl}`);
console.log(`   WebSocket: ${config.wsUrl}`);
console.log(`   Development: ${config.isDevelopment}`);
console.log(`   Staging: ${config.isStaging}`);
console.log(`   Production: ${config.isProduction}`); 