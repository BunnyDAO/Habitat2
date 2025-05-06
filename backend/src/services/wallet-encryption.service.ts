import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EncryptionService } from './encryption.service';

export class WalletEncryptionService {
  private static instance: WalletEncryptionService;
  private supabase: SupabaseClient;
  private encryptionService: EncryptionService;

  private constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );
    this.encryptionService = EncryptionService.getInstance();
  }

  public static getInstance(): WalletEncryptionService {
    if (!WalletEncryptionService.instance) {
      WalletEncryptionService.instance = new WalletEncryptionService();
    }
    return WalletEncryptionService.instance;
  }

  public async encryptAndStoreWallet(
    userId: string,
    tradingWalletId: number,
    privateKey: string
  ): Promise<void> {
    console.log('Starting wallet encryption process...');
    console.log('User ID:', userId);
    console.log('Trading Wallet ID:', tradingWalletId);
    
    try {
      // Store encrypted keys first and get the encrypted key ID
      console.log('Calling encryption service to store wallet keys...');
      const encryptedKeyId = await this.encryptionService.storeWalletKeys(
        userId,
        tradingWalletId,
        privateKey
      );
      console.log('Successfully stored encrypted wallet keys with ID:', encryptedKeyId);

      // Now that we have stored the keys, we can log the successful operation
      console.log('Logging successful encryption to audit table...');
      const { error: auditError } = await this.supabase
        .from('key_operations_audit')
        .insert([{
          encrypted_key_id: encryptedKeyId,
          operation_type: 'initial_encryption',
          status: 'success',
          metadata: { userId, tradingWalletId }
        }]);

      if (auditError) {
        console.error('Error logging to audit table:', auditError);
        // Don't throw here, as the encryption was successful
        // Just log the error and continue
      } else {
        console.log('Successfully logged encryption to audit table');
      }
    } catch (error) {
      console.error('Error during wallet encryption:', error);
      
      // Only try to log the error if it's not a foreign key constraint error
      if (!(error instanceof Error && error.message.includes('violates foreign key constraint'))) {
        try {
          // Log failed operation
          console.log('Logging failed operation to audit table...');
          const { error: auditError } = await this.supabase
            .from('key_operations_audit')
            .insert([{
              encrypted_key_id: tradingWalletId,
              operation_type: 'initial_encryption',
              status: 'error',
              error_message: error instanceof Error ? error.message : 'Unknown error',
              metadata: { userId, tradingWalletId }
            }]);

          if (auditError) {
            console.error('Error logging to audit table:', auditError);
          } else {
            console.log('Successfully logged error to audit table');
          }
        } catch (auditError) {
          console.error('Error logging to audit table:', auditError);
        }
      }

      throw error;
    }
  }

  public async encryptAndStoreMultipleWallets(
    userId: string,
    wallets: Array<{ tradingWalletId: number; privateKey: string }>
  ): Promise<void> {
    console.log('Starting multiple wallet encryption process...');
    console.log('User ID:', userId);
    console.log('Number of wallets:', wallets.length);
    
    try {
      for (const wallet of wallets) {
        console.log('Processing wallet with ID:', wallet.tradingWalletId);
        await this.encryptAndStoreWallet(
          userId,
          wallet.tradingWalletId,
          wallet.privateKey
        );
      }
      console.log('Successfully committed all wallet encryptions');
    } catch (error) {
      console.error('Error during multiple wallet encryption:', error);
      throw error;
    }
  }
} 