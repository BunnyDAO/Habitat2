import { createClient } from '@supabase/supabase-js';
import { WalletEncryptionService } from '../services/wallet-encryption.service';
import dotenv from 'dotenv';

dotenv.config();

async function storeWalletKey() {
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
      .eq('id', 35)
      .single();

    if (walletError || !wallet) {
      console.error('Error fetching wallet:', walletError);
      return;
    }

    console.log('Found wallet:', wallet);

    // Get the private key from localStorage
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      console.error('WALLET_PRIVATE_KEY environment variable is required');
      return;
    }

    // Store the private key
    const walletEncryptionService = WalletEncryptionService.getInstance();
    await walletEncryptionService.encryptAndStoreWallet(
      wallet.main_wallet_pubkey,
      wallet.id,
      privateKey
    );

    console.log('Successfully stored wallet key');
  } catch (error) {
    console.error('Error storing wallet key:', error);
  }
}

storeWalletKey(); 