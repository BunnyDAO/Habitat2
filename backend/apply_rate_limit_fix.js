const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function applyRateLimitFix() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    
    console.log('Reading SQL fix file...');
    const sqlFix = fs.readFileSync(path.join(__dirname, 'fix_rate_limit_function.sql'), 'utf8');
    
    console.log('Applying rate limit function fix...');
    await client.query(sqlFix);
    
    console.log('✅ Rate limit function fix applied successfully!');
    
    // Test the function
    console.log('Testing the fixed function...');
    const testResult = await client.query(
      "SELECT check_rate_limit('test_user', '/test-endpoint', 5, 60) as result"
    );
    console.log('✅ Function test result:', testResult.rows[0].result);
    
    client.release();
  } catch (error) {
    console.error('❌ Error applying rate limit fix:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyRateLimitFix();