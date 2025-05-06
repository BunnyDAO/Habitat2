import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export class EncryptionService {
  private static instance: EncryptionService;
  private supabase: SupabaseClient;
  private appSecret: string;

  private constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );
    this.appSecret = process.env.APP_SECRET!;
  }

  public static getInstance(): EncryptionService {
    if (!EncryptionService.instance) {
      EncryptionService.instance = new EncryptionService();
    }
    return EncryptionService.instance;
  }

  private async generateSessionKey(): Promise<string> {
    return crypto.randomBytes(32).toString('hex');
  }

  private async encryptWithKey(data: string, key: string): Promise<string> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, encrypted, authTag]).toString('base64');
  }

  private async decryptWithKey(encryptedData: string, key: string): Promise<string> {
    const buffer = Buffer.from(encryptedData, 'base64');
    const iv = buffer.subarray(0, 16);
    const authTag = buffer.subarray(buffer.length - 16);
    const encrypted = buffer.subarray(16, buffer.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  public async storeWalletKeys(
    userId: string,
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

      // Store encrypted keys
      const { data: storedKey, error: keysError } = await this.supabase
        .from('encrypted_wallet_keys')
        .upsert([{
          user_id: userId,
          trading_wallet_id: tradingWalletId,
          session_key_encrypted: encryptedSessionKey,
          wallet_keys_encrypted: encryptedWalletKey,
          last_used: new Date().toISOString(),
          version: 1
        }], {
          onConflict: 'trading_wallet_id'
        })
        .select('id')
        .single();

      if (keysError) {
        console.error('Error storing encrypted keys:', keysError);
        throw keysError;
      }

      if (!storedKey) {
        throw new Error('Failed to store encrypted keys');
      }

      return storedKey.id;
    } catch (error) {
      console.error('Error storing wallet keys:', error);
      throw error;
    }
  }

  public async getWalletPrivateKey(tradingWalletId: number): Promise<string> {
    try {
      const { data: keys, error: keysError } = await this.supabase
        .from('encrypted_wallet_keys')
        .select('session_key_encrypted, wallet_keys_encrypted')
        .eq('trading_wallet_id', tradingWalletId)
        .eq('is_active', true)
        .single();

      if (keysError) {
        console.error('Error fetching encrypted keys:', keysError);
        throw keysError;
      }

      if (!keys) {
        throw new Error('No active encrypted keys found for wallet');
      }

      // Decrypt session key with APP_SECRET
      const sessionKey = await this.decryptWithKey(keys.session_key_encrypted, this.appSecret);

      // Decrypt wallet private key with session key
      const walletPrivateKey = await this.decryptWithKey(keys.wallet_keys_encrypted, sessionKey);

      // Update last used timestamp
      const { error: updateError } = await this.supabase
        .from('encrypted_wallet_keys')
        .update({ last_used: new Date().toISOString() })
        .eq('trading_wallet_id', tradingWalletId);

      if (updateError) {
        console.error('Error updating last used timestamp:', updateError);
        throw updateError;
      }

      return walletPrivateKey;
    } catch (error) {
      console.error('Error getting wallet private key:', error);
      throw error;
    }
  }

  public async rotateKeys(tradingWalletId: number): Promise<void> {
    try {
      // Get current wallet private key
      const currentPrivateKey = await this.getWalletPrivateKey(tradingWalletId);

      // Generate new session key
      const newSessionKey = await this.generateSessionKey();

      // Encrypt new session key with APP_SECRET
      const newEncryptedSessionKey = await this.encryptWithKey(newSessionKey, this.appSecret);

      // Encrypt wallet private key with new session key
      const newEncryptedWalletKey = await this.encryptWithKey(currentPrivateKey, newSessionKey);

      // Get current version
      const { data: currentKeys, error: fetchError } = await this.supabase
        .from('encrypted_wallet_keys')
        .select('version')
        .eq('trading_wallet_id', tradingWalletId)
        .single();

      if (fetchError) {
        console.error('Error fetching current version:', fetchError);
        throw fetchError;
      }

      // Update encrypted keys
      const { error: updateError } = await this.supabase
        .from('encrypted_wallet_keys')
        .update({
          session_key_encrypted: newEncryptedSessionKey,
          wallet_keys_encrypted: newEncryptedWalletKey,
          last_used: new Date().toISOString(),
          version: (currentKeys?.version || 0) + 1
        })
        .eq('trading_wallet_id', tradingWalletId);

      if (updateError) {
        console.error('Error updating encrypted keys:', updateError);
        throw updateError;
      }
    } catch (error) {
      console.error('Error rotating keys:', error);
      throw error;
    }
  }
}

// Standalone decryptSecretKey function for daemon usage
export async function decryptSecretKey(encrypted: string, appSecret: string): Promise<Uint8Array> {
  const buffer = Buffer.from(encrypted, 'base64');
  const iv = buffer.subarray(0, 16);
  const authTag = buffer.subarray(buffer.length - 16);
  const encryptedData = buffer.subarray(16, buffer.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(appSecret, 'hex'), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return new Uint8Array(decrypted);
} 