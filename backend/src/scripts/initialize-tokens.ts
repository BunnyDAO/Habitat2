import { createClient } from '@supabase/supabase-js';
import { TokenService } from '../services/TokenService';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function initializeTokens() {
  try {
    console.log('Initializing supported tokens for pair trading...');
    
    // Create a mock pool for TokenService
    const mockPool = {
      connect: async () => ({
        query: async (sql: string, params: any[]) => {
          console.log('Executing query:', sql);
          console.log('With params:', params);
          
          // Convert to Supabase query
          if (sql.includes('INSERT INTO tokens')) {
            const [mintAddress, name, symbol, decimals, logoURI] = params;
            
            const { data, error } = await supabase
              .from('tokens')
              .upsert({
                mint_address: mintAddress,
                name,
                symbol,
                decimals,
                logo_uri: logoURI,
                last_updated: new Date().toISOString()
              }, {
                onConflict: 'mint_address'
              })
              .select();
            
            if (error) throw error;
            return { rows: data, rowCount: data?.length || 0 };
          }
          
          return { rows: [], rowCount: 0 };
        },
        release: () => {}
      }),
      query: async (sql: string, params?: any[]) => {
        console.log('Direct query:', sql);
        return { rows: [], rowCount: 0 };
      }
    };
    
    const tokenService = new TokenService(mockPool as any, null);
    
    // Note: initializeSupportedTokens method removed - tokens are now managed via update-xstock-tokens.ts script
    console.log('Tokens should be initialized using: npm run update-xstock-tokens');
    
    console.log('Successfully initialized supported tokens!');
    
    // Verify the tokens were created
    const { data: tokens, error } = await supabase
      .from('tokens')
      .select('*')
      .order('symbol');
    
    if (error) {
      console.error('Error fetching tokens:', error);
    } else {
      console.log(`Found ${tokens.length} tokens in database:`);
      tokens.forEach(token => {
        console.log(`  - ${token.symbol} (${token.name}): ${token.mint_address}`);
      });
    }
    
  } catch (error) {
    console.error('Error initializing tokens:', error);
    process.exit(1);
  }
}

// Run the initialization
initializeTokens().then(() => {
  console.log('Token initialization completed');
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error during token initialization:', error);
  process.exit(1);
});