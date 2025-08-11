const { Pool } = require('pg');
require('dotenv').config();

async function runPositionTrackingMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    console.log('🚀 Starting position tracking migration...');
    
    // Add the new columns if they don't exist
    console.log('📝 Adding is_position_open column...');
    await pool.query(`
      ALTER TABLE strategies 
      ADD COLUMN IF NOT EXISTS is_position_open BOOLEAN DEFAULT false;
    `);
    
    console.log('📝 Adding current_position column...');
    await pool.query(`
      ALTER TABLE strategies 
      ADD COLUMN IF NOT EXISTS current_position JSONB;
    `);
    
    console.log('📝 Adding position_last_updated column...');
    await pool.query(`
      ALTER TABLE strategies 
      ADD COLUMN IF NOT EXISTS position_last_updated TIMESTAMP WITH TIME ZONE;
    `);
    
    // Add index for position queries
    console.log('📝 Creating index for position queries...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_strategies_position_open 
      ON strategies(is_position_open) 
      WHERE is_position_open = true;
    `);
    
    // Add comments for clarity
    console.log('📝 Adding column comments...');
    await pool.query(`
      COMMENT ON COLUMN strategies.is_position_open IS 'Whether the strategy currently has an open position on Drift';
    `);
    
    await pool.query(`
      COMMENT ON COLUMN strategies.current_position IS 'JSON object containing current position details (direction, size, entry price, etc.)';
    `);
    
    await pool.query(`
      COMMENT ON COLUMN strategies.position_last_updated IS 'Timestamp when position information was last updated';
    `);
    
    // Verify the columns were added
    console.log('🔍 Verifying migration...');
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'strategies' 
      AND column_name IN ('is_position_open', 'current_position', 'position_last_updated')
      ORDER BY column_name;
    `);
    
    console.log('✅ Migration completed successfully!');
    console.log('📋 Added columns:');
    result.rows.forEach(row => {
      console.log(`   - ${row.column_name} (${row.data_type})`);
    });
    
    // Show current strategy count for reference
    const strategyCount = await pool.query('SELECT COUNT(*) FROM strategies');
    console.log(`📊 Total strategies in database: ${strategyCount.rows[0].count}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await pool.end();
    console.log('🔒 Database connection closed');
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n⚠️  Migration interrupted by user');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Migration terminated');
  process.exit(1);
});

console.log('🎯 Drift Position Tracking Migration');
console.log('=====================================');
runPositionTrackingMigration();
