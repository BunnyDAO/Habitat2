import { createClient } from '@supabase/supabase-js';
import { EncryptionService } from '../services/encryption.service';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function testDecrypt(tradingWalletId: number) {
  const encryptionService = EncryptionService.getInstance();

  const { data: walletData, error } = await supabase
    .from('encrypted_wallet_keys')
    .select('session_key_encrypted, wallet_keys_encrypted')
    .eq('trading_wallet_id', tradingWalletId)
    .single();

  if (error || !walletData) {
    console.error('Could not find encrypted key for trading wallet', tradingWalletId);
    return;
  }

  try {
    const secretKeyString = await encryptionService.getWalletPrivateKey(tradingWalletId);
    console.log('Decrypted secret key (hex):', secretKeyString);
    console.log('Length:', secretKeyString.length, 'Should be 128 for 64 bytes');
  } catch (e) {
    console.error('Decryption failed:', e);
  }
}

testDecrypt(92); 