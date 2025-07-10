import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  const client = await pool.connect();

  try {
    console.log('🚀 Starting strategy publishing migration...');

    // Read the migration file
    const migrationPath = path.resolve(__dirname, '../database/migrations/009_add_strategy_publishing.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute the migration
    await client.query('BEGIN');
    
    console.log('📝 Executing migration SQL...');
    await client.query(migrationSQL);
    
    await client.query('COMMIT');
    
    console.log('✅ Strategy publishing migration completed successfully!');
    
    // Verify tables were created
    console.log('🔍 Verifying tables...');
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN (
        'published_strategies',
        'strategy_adoptions',
        'strategy_reviews',
        'strategy_performance_history',
        'strategy_wallet_requirements'
      )
      ORDER BY table_name
    `);

    console.log('📊 Created tables:');
    tableCheck.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });

    // Check indexes
    const indexCheck = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename IN (
        'published_strategies',
        'strategy_adoptions',
        'strategy_reviews',
        'strategy_performance_history',
        'strategy_wallet_requirements'
      )
      ORDER BY indexname
    `);

    console.log('🔍 Created indexes:');
    indexCheck.rows.forEach(row => {
      console.log(`  ✓ ${row.indexname}`);
    });

    // Check views
    const viewCheck = await client.query(`
      SELECT table_name as view_name
      FROM information_schema.views 
      WHERE table_schema = 'public' 
      AND table_name IN (
        'published_strategies_with_metrics',
        'strategy_adoption_stats'
      )
      ORDER BY table_name
    `);

    console.log('👁️  Created views:');
    viewCheck.rows.forEach(row => {
      console.log(`  ✓ ${row.view_name}`);
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('🎉 Migration process completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration process failed:', error);
      process.exit(1);
    });
}

export { runMigration };