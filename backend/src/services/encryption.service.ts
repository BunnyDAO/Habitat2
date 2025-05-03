import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

interface OperationMetadata {
  mainWalletPubkey?: string;
  tradingWalletId: number;
}

export class EncryptionService {
  private static instance: EncryptionService;
  private supabase;
  private appSecret: string;

  private constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY environment variables must be set');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
    
    const appSecret = process.env.APP_SECRET;
    if (!appSecret) {
      throw new Error('APP_SECRET environment variable is not set');
    }
    this.appSecret = appSecret;
  }

  public static getInstance(): EncryptionService {
    if (!EncryptionService.instance) {
      EncryptionService.instance = new EncryptionService();
    }
    return EncryptionService.instance;
  }

  private async generateSessionKey(): Promise<string> {
    return crypto.randomBytes(32).toString('base64');
  }

  private deriveKey(key: string): Buffer {
    // Use PBKDF2 to derive a 32-byte key
    const salt = Buffer.from('salt', 'utf8'); // Use a constant salt for reproducibility
    return crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha256');
  }

  private async encryptWithKey(data: string, key: string): Promise<string> {
    // Derive a proper length key
    const derivedKey = this.deriveKey(key);
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    // Combine IV, encrypted data, and auth tag
    return JSON.stringify({
      iv: iv.toString('base64'),
      data: encrypted,
      authTag: authTag.toString('base64')
    });
  }

  private async decryptWithKey(encryptedData: string, key: string): Promise<string> {
    // Derive a proper length key
    const derivedKey = this.deriveKey(key);
    
    const { iv, data, authTag } = JSON.parse(encryptedData);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      derivedKey,
      Buffer.from(iv, 'base64')
    );
    
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    
    let decrypted = decipher.update(data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  private async logOperation(
    operation: {
      operation_type: string;
      status: 'success' | 'error';
      error_message?: string;
      metadata: OperationMetadata;
    },
    encryptedKeyId?: number
  ): Promise<void> {
    try {
      const { error: auditError } = await this.supabase
        .from('key_operations_audit')
        .insert({
          encrypted_key_id: encryptedKeyId,
          operation_type: operation.operation_type,
          status: operation.status,
          error_message: operation.error_message,
          metadata: operation.metadata,
          performed_at: new Date().toISOString()
        });

      if (auditError) {
        console.error('Failed to log operation:', auditError);
      }
    } catch (error) {
      console.error('Failed to log operation:', error);
    }
  }

  public async storeWalletKeys(
    mainWalletPubkey: string,
    tradingWalletId: number,
    walletPrivateKey: string
  ): Promise<number> {
    try {
      // Generate session key
      const sessionKey = await this.generateSessionKey();

      // Encrypt session key with APP_SECRET
      const encryptedSessionKey = await this.encryptWithKey(sessionKey, this.appSecret);

      // Encrypt wallet private key with session key
      const encryptedWalletKey = await this.encryptWithKey(walletPrivateKey, sessionKey);

      // Store encrypted keys using Supabase
      const { data: encryptedKey, error: storeError } = await this.supabase
        .from('encrypted_wallet_keys')
        .upsert({
          user_id: mainWalletPubkey,
          trading_wallet_id: tradingWalletId,
          session_key_encrypted: encryptedSessionKey,
          wallet_keys_encrypted: encryptedWalletKey,
          last_used: new Date().toISOString(),
          version: 1,
          is_active: true
        }, {
          onConflict: 'trading_wallet_id'
        })
        .select()
        .single();

      if (storeError) throw storeError;

      // Create audit log entry
      const { error: auditError } = await this.supabase
        .from('key_operations_audit')
        .insert({
          encrypted_key_id: encryptedKey.id,
          operation_type: 'store_keys',
          status: 'success',
          metadata: { mainWalletPubkey, tradingWalletId },
          performed_at: new Date().toISOString()
        });

      if (auditError) {
        console.error('Failed to create audit log:', auditError);
      }

      return encryptedKey.id;

    } catch (error) {
      // Create audit log for failure
      await this.supabase
        .from('key_operations_audit')
        .insert({
          encrypted_key_id: null,
          operation_type: 'store_keys',
          status: 'error',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          metadata: { mainWalletPubkey, tradingWalletId },
          performed_at: new Date().toISOString()
        });

      throw error;
    }
  }

  public async getWalletPrivateKey(tradingWalletId: number): Promise<string> {
    try {
      const { data, error } = await this.supabase
        .from('encrypted_wallet_keys')
        .select('id, session_key_encrypted, wallet_keys_encrypted')
        .eq('trading_wallet_id', tradingWalletId)
        .eq('is_active', true)
        .single();

      if (error) throw error;
      if (!data) throw new Error('No active encrypted keys found for wallet');

      const { id, session_key_encrypted, wallet_keys_encrypted } = data;

      // Decrypt session key with APP_SECRET
      const sessionKey = await this.decryptWithKey(session_key_encrypted, this.appSecret);

      // Decrypt wallet private key with session key
      const walletPrivateKey = await this.decryptWithKey(wallet_keys_encrypted, sessionKey);

      // Update last used timestamp
      await this.supabase
        .from('encrypted_wallet_keys')
        .update({ last_used: new Date().toISOString() })
        .eq('id', id);

      return walletPrivateKey;
    } catch (error) {
      // Get the encrypted key ID if available
      const { data: encryptedKey } = await this.supabase
        .from('encrypted_wallet_keys')
        .select('id')
        .eq('trading_wallet_id', tradingWalletId)
        .single();

      // Log failed operation
      await this.logOperation({
        operation_type: 'retrieve_keys',
        status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        metadata: { tradingWalletId }
      }, encryptedKey?.id);

      throw error;
    }
  }

  public async rotateKeys(tradingWalletId: number): Promise<void> {
    try {
      // Get current wallet private key and encrypted key ID
      const { data: encryptedKey, error: keyError } = await this.supabase
        .from('encrypted_wallet_keys')
        .select('id')
        .eq('trading_wallet_id', tradingWalletId)
        .single();

      if (keyError) throw keyError;

      const currentPrivateKey = await this.getWalletPrivateKey(tradingWalletId);

      // Generate new session key
      const newSessionKey = await this.generateSessionKey();

      // Encrypt new session key with APP_SECRET
      const newEncryptedSessionKey = await this.encryptWithKey(newSessionKey, this.appSecret);

      // Encrypt wallet private key with new session key
      const newEncryptedWalletKey = await this.encryptWithKey(currentPrivateKey, newSessionKey);

      // Update encrypted keys
      const { error: updateError } = await this.supabase
        .from('encrypted_wallet_keys')
        .update({
          session_key_encrypted: newEncryptedSessionKey,
          wallet_keys_encrypted: newEncryptedWalletKey,
          last_used: new Date().toISOString(),
          version: this.supabase.rpc('increment_version', { wallet_id: tradingWalletId })
        })
        .eq('id', encryptedKey.id);

      if (updateError) throw updateError;

      // Wait a moment for the record to be committed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Log successful operation
      await this.logOperation({
        operation_type: 'rotate_keys',
        status: 'success',
        metadata: { tradingWalletId }
      }, encryptedKey.id);

    } catch (error) {
      // Get the encrypted key ID if available
      const { data: encryptedKey } = await this.supabase
        .from('encrypted_wallet_keys')
        .select('id')
        .eq('trading_wallet_id', tradingWalletId)
        .single();

      // Log failed operation
      await this.logOperation({
        operation_type: 'rotate_keys',
        status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        metadata: { tradingWalletId }
      }, encryptedKey?.id);

      throw error;
    }
  }
} 