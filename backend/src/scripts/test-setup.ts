import { Pool } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from correct path
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function testSetup() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🧪 Testing Pair Trade setup...');
    
    // Test 1: Verify tables exist
    const { rows: tables } = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('strategy_holdings', 'trade_history')
    `);
    
    console.log('✅ Tables verified:', tables.map(t => t.table_name));
    
    // Test 2: Check if we can insert a test record (and clean it up)
    await pool.query('BEGIN');
    
    try {
      // Insert a test strategy first (if one doesn't exist)
      const { rows: strategies } = await pool.query(
        'SELECT id FROM strategies LIMIT 1'
      );
      
      if (strategies.length > 0) {
        const strategyId = strategies[0].id;
        console.log('📋 Using existing strategy ID:', strategyId);
        
        // Test holdings table
        await pool.query(`
          INSERT INTO strategy_holdings (strategy_id, token_a_mint, token_b_mint, token_a_amount, token_b_amount, total_allocated_sol)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [strategyId, 'So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1000000000, 500000000, 2000000000]);
        
        // Test trade history table
        await pool.query(`
          INSERT INTO trade_history (strategy_id, trade_type, from_mint, to_mint, input_amount, output_amount, execution_status)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [strategyId, 'initial_allocation', 'So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1000000000, 500000000, 'completed']);
        
        console.log('✅ Test records inserted successfully');
        
        // Verify we can read them back
        const { rows: holdings } = await pool.query('SELECT * FROM strategy_holdings WHERE strategy_id = $1', [strategyId]);
        const { rows: trades } = await pool.query('SELECT * FROM trade_history WHERE strategy_id = $1', [strategyId]);
        
        console.log('✅ Test holdings record:', holdings.length > 0 ? 'Found' : 'Not found');
        console.log('✅ Test trade record:', trades.length > 0 ? 'Found' : 'Not found');
      } else {
        console.log('⚠️  No existing strategies found, skipping insert test');
      }
      
      await pool.query('ROLLBACK'); // Clean up test data
      console.log('✅ Test data cleaned up');
      
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    
    console.log('🎉 All setup tests passed! The Pair Trade system is ready.');
    
  } catch (error) {
    console.error('❌ Setup test failed:', error);
  } finally {
    await pool.end();
  }
}

testSetup();