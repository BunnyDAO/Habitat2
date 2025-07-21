import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function runPairTradeMigrations() {
  // Create database connection
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('Running Pair Trade migrations...');

    // Read and execute migration 011
    const migration011Path = path.join(__dirname, '../database/migrations/011_create_strategy_holdings.sql');
    const migration011 = fs.readFileSync(migration011Path, 'utf8');
    
    console.log('Running migration 011: Create strategy_holdings table...');
    await pool.query(migration011);
    console.log('✅ Migration 011 completed successfully!');

    // Read and execute migration 012
    const migration012Path = path.join(__dirname, '../database/migrations/012_create_trade_history.sql');
    const migration012 = fs.readFileSync(migration012Path, 'utf8');
    
    console.log('Running migration 012: Create trade_history table...');
    await pool.query(migration012);
    console.log('✅ Migration 012 completed successfully!');

    console.log('🎉 All Pair Trade migrations completed successfully!');

  } catch (error) {
    console.error('❌ Error running migrations:', error);
  } finally {
    // Close the connection
    await pool.end();
  }
}

// Run the script
runPairTradeMigrations();