import { createClient } from '@supabase/supabase-js';
import { EncryptionService } from './encryption.service';

export class WalletEncryptionService {
  private static instance: WalletEncryptionService;
  private supabase;
  private encryptionService: EncryptionService;

  private constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY environment variables must be set');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.encryptionService = EncryptionService.getInstance();
  }

  public static getInstance(): WalletEncryptionService {
    if (!WalletEncryptionService.instance) {
      WalletEncryptionService.instance = new WalletEncryptionService();
    }
    return WalletEncryptionService.instance;
  }

  public async encryptAndStoreWallet(
    mainWalletPubkey: string,
    tradingWalletId: number,
    privateKey: string
  ): Promise<void> {
    console.log('Starting wallet encryption process...');
    console.log('Main wallet pubkey:', mainWalletPubkey);
    console.log('Trading Wallet ID:', tradingWalletId);
    
    try {
      // Store encrypted keys
      console.log('Calling encryption service to store wallet keys...');
      const encryptedKeyId = await this.encryptionService.storeWalletKeys(
        mainWalletPubkey,
        tradingWalletId,
        privateKey
      );
      console.log('Successfully stored encrypted wallet keys');

      // Log successful encryption
      console.log('Logging successful encryption to audit table...');
      const { error: auditError } = await this.supabase
        .from('key_operations_audit')
        .insert({
          encrypted_key_id: encryptedKeyId,
          operation_type: 'initial_encryption',
          status: 'success',
          metadata: { mainWalletPubkey, tradingWalletId }
        });

      if (auditError) throw auditError;
      console.log('Successfully logged encryption to audit table');

    } catch (error) {
      console.error('Error during wallet encryption:', error);
      
      // Log failed operation
      console.log('Logging failed operation to audit table...');
      await this.supabase
        .from('key_operations_audit')
        .insert({
          encrypted_key_id: null, // Set to null for failed operations
          operation_type: 'initial_encryption',
          status: 'error',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          metadata: { mainWalletPubkey, tradingWalletId }
        });
      console.log('Successfully logged error to audit table');

      throw error;
    }
  }

  public async encryptAndStoreMultipleWallets(
    mainWalletPubkey: string,
    wallets: Array<{ tradingWalletId: number; privateKey: string }>
  ): Promise<void> {
    console.log('Starting multiple wallet encryption process...');
    console.log('Main wallet pubkey:', mainWalletPubkey);
    console.log('Number of wallets:', wallets.length);
    
    try {
      for (const wallet of wallets) {
        console.log('Processing wallet with ID:', wallet.tradingWalletId);
        await this.encryptAndStoreWallet(
          mainWalletPubkey,
          wallet.tradingWalletId,
          wallet.privateKey
        );
      }
      console.log('Successfully encrypted all wallets');
    } catch (error) {
      console.error('Error during multiple wallet encryption:', error);
      throw error;
    }
  }
} 