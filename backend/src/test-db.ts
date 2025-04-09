import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

console.log('Attempting to connect with URL:', process.env.DATABASE_URL?.replace(/:.*@/, ':****@'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function testConnection() {
  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    console.log('Successfully connected to Supabase!');
    
    // Test a simple query
    console.log('Testing query...');
    const result = await client.query('SELECT NOW()');
    console.log('Current database time:', result.rows[0].now);
    
    client.release();
    await pool.end();
  } catch (error: any) {
    console.error('Error connecting to database:', error);
    if (error.code === 'ETIMEDOUT') {
      console.log('Connection timed out. This might be due to:');
      console.log('1. IP restrictions - check Supabase dashboard for IP allow list');
      console.log('2. Incorrect port - some projects use 6543 for connection pooling');
      console.log('3. Network issues - check if you can ping the host');
    }
  }
}

testConnection(); 