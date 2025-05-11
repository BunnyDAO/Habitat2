import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const environments = {
  development: {
    apiBaseUrl: 'http://localhost:3001',
    wsUrl: 'ws://localhost:3001',
    apiVersion: 'v1',
    isDevelopment: true
  },
  staging: {
    apiBaseUrl: 'https://staging-api.yourdomain.com',
    wsUrl: 'wss://staging-api.yourdomain.com',
    apiVersion: 'v1',
    isDevelopment: false
  },
  production: {
    apiBaseUrl: 'https://api.yourdomain.com',
    wsUrl: 'wss://api.yourdomain.com',
    apiVersion: 'v1',
    isDevelopment: false
  }
};

// Get environment from command line argument or default to development
const env = process.argv[2] || 'development';
const config = environments[env];

if (!config) {
  console.error(`Invalid environment: ${env}`);
  console.error('Available environments:', Object.keys(environments).join(', '));
  process.exit(1);
}

// Ensure public directory exists
const publicDir = path.join(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Write config file
const configPath = path.join(publicDir, 'config.json');
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

console.log(`Created ${env} configuration at ${configPath}`); 