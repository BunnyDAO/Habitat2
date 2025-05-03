import { WalletService } from '../services/wallet.service';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

async function testWalletCreation() {
  const walletService = WalletService.getInstance();
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );
  
  try {
    console.log('Creating test user in database...');
    const testUserId = 'test_user_' + Date.now();
    
    // Create user first
    const { error: userError } = await supabase
      .from('users')
      .insert({
        main_wallet_pubkey: testUserId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (userError) throw userError;
    console.log('Created test user:', testUserId);
    
    // Create a new wallet
    console.log('Creating new wallet...');
    const wallet = await walletService.createWallet(
      testUserId,
      'Test Wallet'
    );
    console.log('Created wallet:', wallet);

    // Wait a moment for all database operations to complete
    console.log('Waiting for database operations to complete...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check encrypted keys
    console.log('\nChecking encrypted_wallet_keys table...');
    const { data: encryptedKeys, error: keysError } = await supabase
      .from('encrypted_wallet_keys')
      .select('*')
      .eq('trading_wallet_id', wallet.id);

    if (keysError) throw keysError;
    console.log('Encrypted keys:', encryptedKeys);

    if (encryptedKeys && encryptedKeys.length > 0) {
      // Check audit logs using the encrypted key ID
      console.log('\nChecking key_operations_audit table...');
      const { data: auditLogs, error: auditError } = await supabase
        .from('key_operations_audit')
        .select('*')
        .eq('encrypted_key_id', encryptedKeys[0].id)
        .order('performed_at', { ascending: false });

      if (auditError) throw auditError;
      console.log('Audit logs:', auditLogs);
    }

  } catch (error) {
    console.error('Error testing wallet creation:', error);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  testWalletCreation().catch(console.error);
} 