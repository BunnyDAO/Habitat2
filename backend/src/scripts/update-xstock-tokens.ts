import { config } from 'dotenv';
import { Pool } from 'pg';
import { createClient } from 'redis';

// Load environment variables
config();

// xStock tokens we want to support for pair trading
const XSTOCK_TOKENS = [
  'TSLAx',
  'AAPLx', 
  'NVDAx',
  'METAx',
  'COINx',
  'GOOGLx',
  'MSFTx',
  'AMZNx',
  'SPYx',
  'QQQx'
];

// Major crypto and stablecoin tokens for pair trading
const CRYPTO_TOKENS = [
  'So11111111111111111111111111111111111111112', // SOL
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', // wBTC
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'  // USDT
];

interface JupiterTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
  daily_volume?: number;
  created_at?: string;
  freeze_authority?: string | null;
  mint_authority?: string | null;
  permanent_delegate?: string | null;
  minted_at?: string;
  extensions?: any;
}

async function fetchJupiterTokenList(): Promise<JupiterTokenInfo[]> {
  console.log('🔍 Fetching Jupiter token list...');
  
  const response = await fetch('https://token.jup.ag/all');
  if (!response.ok) {
    throw new Error(`Failed to fetch Jupiter tokens: ${response.statusText}`);
  }
  
  const tokens = await response.json();
  console.log(`✅ Fetched ${tokens.length} tokens from Jupiter`);
  return tokens;
}

async function findTokensBySymbol(tokens: JupiterTokenInfo[], symbols: string[]): Promise<JupiterTokenInfo[]> {
  const foundTokens: JupiterTokenInfo[] = [];
  const notFound: string[] = [];
  
  for (const symbol of symbols) {
    const token = tokens.find(t => t.symbol === symbol);
    if (token) {
      foundTokens.push(token);
      console.log(`✅ Found ${symbol}: ${token.address}`);
    } else {
      notFound.push(symbol);
      console.log(`❌ Not found: ${symbol}`);
    }
  }
  
  if (notFound.length > 0) {
    console.log(`⚠️  Missing tokens: ${notFound.join(', ')}`);
  }
  
  return foundTokens;
}

async function findTokensByMint(tokens: JupiterTokenInfo[], mints: string[]): Promise<JupiterTokenInfo[]> {
  const foundTokens: JupiterTokenInfo[] = [];
  const notFound: string[] = [];
  
  for (const mint of mints) {
    const token = tokens.find(t => t.address === mint);
    if (token) {
      foundTokens.push(token);
      console.log(`✅ Found ${token.symbol}: ${mint}`);
    } else {
      notFound.push(mint);
      console.log(`❌ Not found: ${mint}`);
    }
  }
  
  if (notFound.length > 0) {
    console.log(`⚠️  Missing mints: ${notFound.join(', ')}`);
  }
  
  return foundTokens;
}

async function updateTokensInDatabase(pool: Pool, tokens: JupiterTokenInfo[]): Promise<void> {
  console.log(`🔄 Updating ${tokens.length} tokens in database...`);
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    for (const token of tokens) {
      await client.query(`
        INSERT INTO tokens (mint_address, name, symbol, decimals, logo_uri, last_updated)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        ON CONFLICT (mint_address) DO UPDATE SET
          name = EXCLUDED.name,
          symbol = EXCLUDED.symbol,
          decimals = EXCLUDED.decimals,
          logo_uri = EXCLUDED.logo_uri,
          last_updated = CURRENT_TIMESTAMP
      `, [
        token.address,
        token.name,
        token.symbol,
        token.decimals,
        token.logoURI
      ]);
      
      console.log(`✅ Updated ${token.symbol} (${token.address})`);
    }
    
    await client.query('COMMIT');
    console.log('✅ All tokens updated successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error updating tokens:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  console.log('🚀 Starting selective xStock token update...');
  
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
  
  // Test database connection
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Connected to database at:', result.rows[0].now);
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    process.exit(1);
  }
  
  try {
    // Fetch all tokens from Jupiter
    const allTokens = await fetchJupiterTokenList();
    
    // Find xStock tokens by symbol
    console.log('\n🔍 Looking for xStock tokens...');
    const xstockTokens = await findTokensBySymbol(allTokens, XSTOCK_TOKENS);
    
    // Find crypto tokens by mint address
    console.log('\n🔍 Looking for crypto/stablecoin tokens...');
    const cryptoTokens = await findTokensByMint(allTokens, CRYPTO_TOKENS);
    
    // Combine all tokens
    const tokensToUpdate = [...xstockTokens, ...cryptoTokens];
    
    console.log(`\n📊 Summary:`);
    console.log(`- xStock tokens found: ${xstockTokens.length}/${XSTOCK_TOKENS.length}`);
    console.log(`- Crypto tokens found: ${cryptoTokens.length}/${CRYPTO_TOKENS.length}`);
    console.log(`- Total tokens to update: ${tokensToUpdate.length}`);
    
    if (tokensToUpdate.length === 0) {
      console.log('⚠️  No tokens to update');
      return;
    }
    
    // Update tokens in database
    await updateTokensInDatabase(pool, tokensToUpdate);
    
    // Verify the update
    const result = await pool.query(`
      SELECT symbol, name, mint_address, logo_uri, last_updated
      FROM tokens 
      WHERE symbol = ANY($1) OR mint_address = ANY($2)
      ORDER BY 
        CASE WHEN symbol LIKE '%x' THEN 1 ELSE 2 END,
        symbol
    `, [XSTOCK_TOKENS, CRYPTO_TOKENS]);
    
    console.log(`\n✅ Verification: ${result.rows.length} tokens in database:`);
    result.rows.forEach(token => {
      console.log(`- ${token.symbol}: ${token.name} (${token.mint_address.slice(0, 8)}...)`);
    });
    
    console.log('\n🎉 xStock token update completed successfully!');
    
  } catch (error) {
    console.error('❌ Error during token update:', error);
    process.exit(1);
  } finally {
    await pool.end();
    console.log('🔌 Database connection closed');
  }
}

// Run the script
main().catch(error => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});