import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

async function checkWallet() {
  try {
    // Initialize Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );

    // Get the wallet data
    const { data: wallet, error: walletError } = await supabase
      .from('trading_wallets')
      .select('*')
      .eq('id', 92)
      .single();

    if (walletError || !wallet) {
      console.error('Error fetching wallet:', walletError);
      return;
    }

    console.log('Found wallet:', wallet);

    // Check if there are any encrypted keys
    const { data: keys, error: keysError } = await supabase
      .from('encrypted_wallet_keys')
      .select('*')
      .eq('trading_wallet_id', 92)
      .single();

    if (keysError) {
      console.error('Error fetching encrypted keys:', keysError);
    } else {
      console.log('Found encrypted keys:', keys);
    }

    // Check if there are any strategies
    const { data: strategies, error: strategyError } = await supabase
      .from('strategies')
      .select('*')
      .eq('trading_wallet_id', 92);

    if (strategyError) {
      console.error('Error fetching strategies:', strategyError);
    } else {
      console.log('Found strategies:', strategies);
    }
  } catch (error) {
    console.error('Error checking wallet:', error);
  }
}

checkWallet(); 