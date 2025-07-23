import { config } from 'dotenv';
import { Pool } from 'pg';

// Load environment variables
config();

async function testTokenQuery() {
  console.log('🔍 Testing updated token query...');
  
  // Initialize database connection
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  
  try {
    // Test the updated query
    const result = await pool.query(`
      SELECT mint_address, name, symbol, decimals, logo_uri, last_updated
      FROM tokens
      WHERE (
        -- All xStocks (tokenized stocks) - now includes all 61+ tokens from xstocks.com
        (symbol LIKE '%x' AND mint_address LIKE 'Xs%') OR
        -- Legacy xStocks with other patterns (for backward compatibility)
        symbol IN ('TSLAx', 'AAPLx', 'NVDAx', 'METAx', 'COINx', 'GOOGLx', 'MSFTx', 'AMZNx', 'SPYx', 'QQQx')
      ) OR (
        -- Major crypto tokens
        mint_address = 'So11111111111111111111111111111111111111112' OR -- SOL
        mint_address = '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh' OR -- wBTC
        mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' OR -- USDC
        mint_address = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'    -- USDT
      )
      ORDER BY 
        CASE 
          WHEN symbol LIKE '%x' THEN 1 
          WHEN symbol IN ('SOL', 'wBTC') THEN 2
          WHEN symbol IN ('USDC', 'USDT') THEN 3
          ELSE 4
        END,
        symbol ASC
    `);

    console.log(`\n✅ Query returned ${result.rows.length} tokens`);
    
    // Group by type
    const xStocks = result.rows.filter(r => r.symbol.endsWith('x'));
    const cryptoTokens = result.rows.filter(r => !r.symbol.endsWith('x'));
    
    console.log(`📊 xStock tokens: ${xStocks.length}`);
    console.log(`📊 Crypto tokens: ${cryptoTokens.length}`);
    
    console.log(`\n🪙 First 20 xStock tokens:`);
    xStocks.slice(0, 20).forEach((token, index) => {
      console.log(`${(index + 1).toString().padStart(2, ' ')}. ${token.symbol}: ${token.name} (${token.mint_address.slice(0, 8)}...)`);
    });
    
    if (xStocks.length > 20) {
      console.log(`... and ${xStocks.length - 20} more xStock tokens`);
    }
    
    console.log(`\n💰 Crypto tokens:`);
    cryptoTokens.forEach((token, index) => {
      console.log(`${(index + 1).toString().padStart(2, ' ')}. ${token.symbol}: ${token.name} (${token.mint_address.slice(0, 8)}...)`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

testTokenQuery().catch(console.error);