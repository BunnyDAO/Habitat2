import { config } from 'dotenv';
import { Pool } from 'pg';

// Load environment variables
config();

async function checkXStockTokens() {
  console.log('🔍 Checking xStock tokens in database...');
  
  // Validate environment variables
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  
  // Initialize database connection
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: {
      rejectUnauthorized: false
    }
  });
  
  try {
    // Test database connection
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Connected to database at:', result.rows[0].now);
    
    // Check for xStock tokens (tokens ending in 'x')
    const xStockQuery = await pool.query(`
      SELECT 
        symbol, 
        name, 
        mint_address, 
        logo_uri, 
        decimals,
        last_updated
      FROM tokens 
      WHERE symbol LIKE '%x' 
      ORDER BY symbol
    `);
    
    console.log(`\n📊 Found ${xStockQuery.rows.length} xStock tokens:`);
    console.log('=' .repeat(80));
    
    if (xStockQuery.rows.length === 0) {
      console.log('❌ No xStock tokens found in database!');
      console.log('💡 Please run: npm run update-xstock-tokens');
    } else {
      xStockQuery.rows.forEach((token, index) => {
        console.log(`${index + 1}. ${token.symbol} - ${token.name}`);
        console.log(`   Mint: ${token.mint_address}`);
        console.log(`   Logo URI: ${token.logo_uri || 'NOT SET'}`);
        console.log(`   Decimals: ${token.decimals}`);
        console.log(`   Last Updated: ${token.last_updated}`);
        console.log('   ' + '-'.repeat(60));
      });
    }
    
    // Also check some known xStock symbols specifically
    const knownXStocks = ['TSLAx', 'AAPLx', 'NVDAx', 'METAx', 'COINx', 'GOOGLx', 'MSFTx', 'AMZNx', 'SPYx', 'QQQx'];
    
    console.log(`\n🔍 Checking for specific known xStock tokens:`);
    console.log('=' .repeat(80));
    
    for (const symbol of knownXStocks) {
      const specificQuery = await pool.query(`
        SELECT symbol, name, mint_address, logo_uri
        FROM tokens 
        WHERE symbol = $1
      `, [symbol]);
      
      if (specificQuery.rows.length > 0) {
        const token = specificQuery.rows[0];
        console.log(`✅ ${symbol}: Found`);
        console.log(`   Name: ${token.name}`);
        console.log(`   Mint: ${token.mint_address}`);
        console.log(`   Logo: ${token.logo_uri || 'NOT SET'}`);
      } else {
        console.log(`❌ ${symbol}: Not found`);
      }
    }
    
    // Show a few examples of logo URIs that are set
    const tokensWithLogos = await pool.query(`
      SELECT symbol, name, logo_uri
      FROM tokens 
      WHERE logo_uri IS NOT NULL AND logo_uri != ''
      AND symbol LIKE '%x'
      LIMIT 5
    `);
    
    if (tokensWithLogos.rows.length > 0) {
      console.log(`\n🖼️  Sample xStock tokens with logos:`);
      console.log('=' .repeat(80));
      tokensWithLogos.rows.forEach((token) => {
        console.log(`${token.symbol} (${token.name}):`);
        console.log(`  ${token.logo_uri}`);
      });
    }
    
    // Show overall statistics
    const statsQuery = await pool.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN symbol LIKE '%x' THEN 1 END) as xstock_tokens,
        COUNT(CASE WHEN symbol LIKE '%x' AND logo_uri IS NOT NULL AND logo_uri != '' THEN 1 END) as xstock_with_logos
      FROM tokens
    `);
    
    const stats = statsQuery.rows[0];
    console.log(`\n📈 Database Statistics:`);
    console.log('=' .repeat(80));
    console.log(`Total tokens: ${stats.total_tokens}`);
    console.log(`xStock tokens: ${stats.xstock_tokens}`);
    console.log(`xStock tokens with logos: ${stats.xstock_with_logos}`);
    console.log(`xStock logo coverage: ${stats.xstock_tokens > 0 ? Math.round((stats.xstock_with_logos / stats.xstock_tokens) * 100) : 0}%`);
    
  } catch (error) {
    console.error('❌ Error checking xStock tokens:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the script
checkXStockTokens().catch(error => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});