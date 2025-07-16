import { Keypair } from '@solana/web3.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { WalletEncryptionService } from './wallet-encryption.service';
import { TradingWallet } from '../../src/types/wallet';

interface DatabaseRow {
  id: string;
  wallet_pubkey: string;
  name: string;
  created_at: string;
}

export class WalletService {
  private static instance: WalletService;
  private supabase: SupabaseClient;
  private walletEncryptionService: WalletEncryptionService;

  private constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );
    this.walletEncryptionService = WalletEncryptionService.getInstance();
  }

  public static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }

  public async createWallet(
    userId: string,
    name?: string
  ): Promise<TradingWallet> {
    console.log('Creating new wallet for user:', userId);
    
    try {
      // First check if user exists
      const { data: existingUser, error: userError } = await this.supabase
        .from('users')
        .select('main_wallet_pubkey')
        .eq('main_wallet_pubkey', userId)
        .single();

      if (userError && userError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
        console.error('Error checking user:', userError);
        throw userError;
      }

      if (!existingUser) {
        // Insert user if not exists
        console.log('User does not exist, creating new user');
        const { error: insertError } = await this.supabase
          .from('users')
          .insert([{ main_wallet_pubkey: userId }]);

        if (insertError) {
          console.error('Error creating user:', insertError);
          throw insertError;
        }
        console.log('Created new user');
      }

      // Generate new wallet
      const keypair = Keypair.generate();
      const publicKey = keypair.publicKey.toString();
      const privateKey = Buffer.from(keypair.secretKey).toString('base64');
      console.log('Generated new wallet with public key:', publicKey);

      // Store wallet in database
      const { data: newWallet, error: walletError } = await this.supabase
        .from('trading_wallets')
        .insert([{
          main_wallet_pubkey: userId,
          wallet_pubkey: publicKey,
          name: name || 'New Wallet',
          created_at: new Date().toISOString()
        }])
        .select('id, wallet_pubkey, name, created_at')
        .single();

      if (walletError) {
        console.error('Error storing wallet:', walletError);
        throw walletError;
      }

      if (!newWallet) {
        throw new Error('Failed to create wallet');
      }

      const tradingWalletId = newWallet.id;
      console.log('Stored wallet in database with ID:', tradingWalletId);

      // Encrypt and store private key
      console.log('Encrypting and storing private key...');
      await this.walletEncryptionService.encryptAndStoreWallet(
        userId,
        parseInt(tradingWalletId),
        privateKey
      );
      console.log('Successfully encrypted and stored private key');

      return {
        id: tradingWalletId,
        publicKey: newWallet.wallet_pubkey,
        secretKey: privateKey,
        name: newWallet.name,
        createdAt: newWallet.created_at
      };
    } catch (error) {
      console.error('Error creating wallet:', error);
      throw error;
    }
  }

  public async importWallet(
    userId: string,
    privateKey: string,
    name?: string
  ): Promise<TradingWallet> {
    console.log('Importing wallet for user:', userId);
    
    try {
      // Convert private key to keypair
      const secretKey = Buffer.from(privateKey, 'base64');
      const keypair = Keypair.fromSecretKey(secretKey);
      const publicKey = keypair.publicKey.toString();
      console.log('Converted private key to wallet with public key:', publicKey);

      // Check if wallet already exists
      const { data: existingWallet, error: checkError } = await this.supabase
        .from('trading_wallets')
        .select('id')
        .eq('wallet_pubkey', publicKey)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking existing wallet:', checkError);
        throw checkError;
      }

      if (existingWallet) {
        console.log('Wallet already exists with public key:', publicKey);
        throw new Error('Wallet already exists');
      }

      // Store wallet in database
      const { data: newWallet, error: walletError } = await this.supabase
        .from('trading_wallets')
        .insert([{
          main_wallet_pubkey: userId,
          wallet_pubkey: publicKey,
          name: name || 'Imported Wallet',
          created_at: new Date().toISOString()
        }])
        .select('id, wallet_pubkey, name, created_at')
        .single();

      if (walletError) {
        console.error('Error storing wallet:', walletError);
        throw walletError;
      }

      if (!newWallet) {
        throw new Error('Failed to create wallet');
      }

      const tradingWalletId = newWallet.id;
      console.log('Stored wallet in database with ID:', tradingWalletId);

      // Encrypt and store private key
      console.log('Encrypting and storing private key...');
      await this.walletEncryptionService.encryptAndStoreWallet(
        userId,
        parseInt(tradingWalletId),
        privateKey
      );
      console.log('Successfully encrypted and stored private key');

      return {
        id: tradingWalletId,
        publicKey: newWallet.wallet_pubkey,
        secretKey: privateKey,
        name: newWallet.name,
        createdAt: newWallet.created_at
      };
    } catch (error) {
      console.error('Error importing wallet:', error);
      throw error;
    }
  }

  public async getWallets(userId: string): Promise<TradingWallet[]> {
    try {
      const { data: wallets, error } = await this.supabase
        .from('trading_wallets')
        .select('id, wallet_pubkey, name, created_at')
        .eq('main_wallet_pubkey', userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching wallets:', error);
        throw error;
      }

      return (wallets || []).map((row: DatabaseRow) => ({
        id: row.id,
        publicKey: row.wallet_pubkey,
        name: row.name,
        createdAt: row.created_at
      }));
    } catch (error) {
      console.error('Error getting wallets:', error);
      throw error;
    }
  }

  public async deleteWallet(tradingWalletId: string): Promise<void> {
    try {
      // Delete wallet
      const { error: walletError } = await this.supabase
        .from('trading_wallets')
        .delete()
        .eq('id', tradingWalletId);

      if (walletError) {
        console.error('Error deleting wallet:', walletError);
        throw walletError;
      }

      // Delete encrypted keys
      const { error: keysError } = await this.supabase
        .from('encrypted_wallet_keys')
        .delete()
        .eq('trading_wallet_id', parseInt(tradingWalletId));

      if (keysError) {
        console.error('Error deleting encrypted keys:', keysError);
        throw keysError;
      }
    } catch (error) {
      console.error('Error deleting wallet:', error);
      throw error;
    }
  }

  public async updateWalletName(walletPublicKey: string, newName: string, userId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('trading_wallets')
        .update({ name: newName })
        .eq('wallet_pubkey', walletPublicKey)
        .eq('main_wallet_pubkey', userId);

      if (error) {
        console.error('Error updating wallet name:', error);
        throw error;
      }

      console.log(`Successfully updated wallet name for ${walletPublicKey} to "${newName}"`);
    } catch (error) {
      console.error('Error updating wallet name:', error);
      throw error;
    }
  }
} 