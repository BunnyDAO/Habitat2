import { Pool } from 'pg';
import { config } from '../config/environment';

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl,
  // Connection pool settings
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
});

// Log connection events
pool.on('connect', (client) => {
  if (config.isDevelopment) {
    console.log('🔌 New database client connected');
  }
});

pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle client', err);
});

pool.on('remove', (client) => {
  if (config.isDevelopment) {
    console.log('🔌 Database client removed from pool');
  }
});

export default pool; 