import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

async function createStrategy() {
  try {
    // Initialize Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );

    // Create the strategy
    const { data: strategy, error } = await supabase
      .from('strategies')
      .insert([{
        trading_wallet_id: 35,
        main_wallet_pubkey: 'D2eAfBM3mnC7rAAwFbuy5eHJ8wkayNi6JTfcbFHiVNmN',
        strategy_type: 'wallet-monitor',
        config: {
          walletAddress: 'D2eAfBM3mnC7rAAwFbuy5eHJ8wkayNi6JTfcbFHiVNmN',
          percentage: 100
        },
        is_active: true,
        name: 'Mirror Trading Wallet 3'
      }])
      .select('*')
      .single();

    if (error) {
      console.error('Error creating strategy:', error);
      return;
    }

    console.log('Strategy created:', strategy);
  } catch (error) {
    console.error('Error creating strategy:', error);
  }
}

createStrategy(); 