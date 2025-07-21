import { Pool } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from correct path
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function checkStrategiesTable() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔍 Checking strategies table structure...');
    
    const { rows } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'strategies' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    console.log('📋 Strategies table columns:');
    rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });

  } catch (error) {
    console.error('❌ Error checking table:', error);
  } finally {
    await pool.end();
  }
}

checkStrategiesTable();