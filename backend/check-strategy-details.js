const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.SUPABASE_HOST,
  port: 5432,
  database: process.env.SUPABASE_DB_NAME,
  user: process.env.SUPABASE_USER,
  password: process.env.SUPABASE_PASSWORD,
  ssl: false
});

async function checkStrategies() {
  try {
    const result = await pool.query(`
      SELECT id, allocation_percentage, trading_wallet_id 
      FROM strategies 
      WHERE job_type = 'drift-perp' 
      ORDER BY id DESC 
      LIMIT 5
    `);
    
    console.log('Recent Drift strategies:');
    result.rows.forEach(row => {
      console.log(`Strategy ${row.id}: Allocation ${row.allocation_percentage}%, Wallet: ${row.trading_wallet_id}`);
    });
    
    // Also check SOL balance for the most recent strategy
    if (result.rows.length > 0) {
      const latestStrategy = result.rows[0];
      console.log(`\nChecking SOL balance for wallet ${latestStrategy.trading_wallet_id}...`);
      
      const walletResult = await pool.query(`
        SELECT balance 
        FROM wallet_balances 
        WHERE wallet_id = $1 AND token_symbol = 'SOL' 
        ORDER BY updated_at DESC 
        LIMIT 1
      `, [latestStrategy.trading_wallet_id]);
      
      if (walletResult.rows.length > 0) {
        const solBalance = walletResult.rows[0].balance;
        const allocation = latestStrategy.allocation_percentage / 100;
        const solToUse = solBalance * allocation;
        
        console.log(`SOL Balance: ${solBalance} SOL`);
        console.log(`Allocation: ${latestStrategy.allocation_percentage}%`);
        console.log(`SOL to use: ${solToUse} SOL`);
        console.log(`Threshold: 0.1 SOL`);
        console.log(`Sufficient? ${solToUse >= 0.1 ? 'YES' : 'NO'}`);
      } else {
        console.log('No SOL balance found in wallet_balances table');
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkStrategies();
