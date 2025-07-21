import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from correct path
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function tryConnection(config: any): Promise<Pool | null> {
  try {
    const pool = new Pool(config);
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful with config:', JSON.stringify(config, null, 2));
    return pool;
  } catch (error) {
    console.log('❌ Connection failed with config:', JSON.stringify(config, null, 2));
    console.log('Error:', (error as Error).message);
    return null;
  }
}

async function runMigrationsRobust() {
  const baseConfig = {
    connectionString: process.env.DATABASE_URL
  };

  // Try different connection configurations
  const configs = [
    baseConfig,
    { ...baseConfig, ssl: false },
    { ...baseConfig, ssl: { rejectUnauthorized: false } },
    { ...baseConfig, ssl: { rejectUnauthorized: true } },
    { ...baseConfig, ssl: true }
  ];

  let pool: Pool | null = null;

  console.log('🔍 Testing database connection configurations...');
  
  for (const config of configs) {
    pool = await tryConnection(config);
    if (pool) break;
  }

  if (!pool) {
    console.error('❌ Could not establish database connection with any configuration');
    process.exit(1);
  }

  try {
    console.log('🚀 Running Pair Trade migrations...');

    // Create migrations tracking table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Check if migrations already applied
    const { rows: appliedMigrations } = await pool.query(
      'SELECT name FROM migrations WHERE name IN ($1, $2)',
      ['011_create_strategy_holdings.sql', '012_create_trade_history.sql']
    );

    const appliedNames = appliedMigrations.map(m => m.name);

    // Run migration 011 if not applied
    if (!appliedNames.includes('011_create_strategy_holdings.sql')) {
      console.log('📝 Running migration 011: Create strategy_holdings table...');
      const migration011Path = path.join(__dirname, '../database/migrations/011_create_strategy_holdings.sql');
      const migration011 = fs.readFileSync(migration011Path, 'utf8');
      
      await pool.query('BEGIN');
      try {
        await pool.query(migration011);
        await pool.query('INSERT INTO migrations (name) VALUES ($1)', ['011_create_strategy_holdings.sql']);
        await pool.query('COMMIT');
        console.log('✅ Migration 011 completed successfully!');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    } else {
      console.log('⏭️  Migration 011 already applied, skipping...');
    }

    // Run migration 012 if not applied
    if (!appliedNames.includes('012_create_trade_history.sql')) {
      console.log('📝 Running migration 012: Create trade_history table...');
      const migration012Path = path.join(__dirname, '../database/migrations/012_create_trade_history.sql');
      const migration012 = fs.readFileSync(migration012Path, 'utf8');
      
      await pool.query('BEGIN');
      try {
        await pool.query(migration012);
        await pool.query('INSERT INTO migrations (name) VALUES ($1)', ['012_create_trade_history.sql']);
        await pool.query('COMMIT');
        console.log('✅ Migration 012 completed successfully!');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    } else {
      console.log('⏭️  Migration 012 already applied, skipping...');
    }

    console.log('🎉 All Pair Trade migrations completed successfully!');

    // Verify tables exist
    const { rows: tables } = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('strategy_holdings', 'trade_history')
    `);
    
    console.log('📋 Verified tables created:', tables.map(t => t.table_name));

  } catch (error) {
    console.error('❌ Error running migrations:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
runMigrationsRobust();