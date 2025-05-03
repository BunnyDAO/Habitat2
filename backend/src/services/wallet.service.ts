import { createClient } from '@supabase/supabase-js';
import { Keypair } from '@solana/web3.js';
import { WalletEncryptionService } from './wallet-encryption.service';
import { TradingWallet } from '../types/wallet';

interface WalletRow {
  id: number;
  main_wallet_pubkey: string;
  wallet_pubkey: string;
  name: string;
  created_at: string;
}

export class WalletService {
  private static instance: WalletService;
  private supabase;
  private walletEncryptionService: WalletEncryptionService;

  private constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY environment variables must be set');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
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
      // Generate new wallet
      const keypair = Keypair.generate();
      const publicKey = keypair.publicKey.toString();
      const privateKey = Buffer.from(keypair.secretKey).toString('base64');
      console.log('Generated new wallet with public key:', publicKey);

      // Store wallet in database
      const { data: wallet, error: walletError } = await this.supabase
        .from('trading_wallets')
        .insert({
          main_wallet_pubkey: userId,
          wallet_pubkey: publicKey,
          name: name || 'New Wallet',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (walletError) throw walletError;

      const tradingWalletId = wallet.id;
      console.log('Stored wallet in database with ID:', tradingWalletId);

      // Encrypt and store private key
      console.log('Encrypting and storing private key...');
      await this.walletEncryptionService.encryptAndStoreWallet(
        userId,
        tradingWalletId,
        privateKey
      );
      console.log('Successfully encrypted and stored private key');

      console.log('Wallet creation completed successfully');

      return {
        id: tradingWalletId,
        publicKey,
        name: name || 'New Wallet',
        createdAt: new Date().toISOString()
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

      if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is "not found" error
        throw checkError;
      }

      if (existingWallet) {
        console.log('Wallet already exists with public key:', publicKey);
        throw new Error('Wallet already exists');
      }

      // Store wallet in database
      const { data: wallet, error: walletError } = await this.supabase
        .from('trading_wallets')
        .insert({
          main_wallet_pubkey: userId,
          wallet_pubkey: publicKey,
          name: name || 'Imported Wallet',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (walletError) throw walletError;

      const tradingWalletId = wallet.id;
      console.log('Stored wallet in database with ID:', tradingWalletId);

      // Encrypt and store private key
      console.log('Encrypting and storing private key...');
      await this.walletEncryptionService.encryptAndStoreWallet(
        userId,
        tradingWalletId,
        privateKey
      );
      console.log('Successfully encrypted and stored private key');

      console.log('Wallet import completed successfully');

      return {
        id: tradingWalletId,
        publicKey,
        name: name || 'Imported Wallet',
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error importing wallet:', error);
      throw error;
    }
  }

  public async deleteWallet(tradingWalletId: number): Promise<void> {
    try {
      // Delete wallet
      const { error: walletError } = await this.supabase
        .from('trading_wallets')
        .delete()
        .eq('id', tradingWalletId);

      if (walletError) throw walletError;

      // Delete encrypted keys
      const { error: keyError } = await this.supabase
        .from('encrypted_wallet_keys')
        .delete()
        .eq('trading_wallet_id', tradingWalletId);

      if (keyError) throw keyError;
    } catch (error) {
      console.error('Error deleting wallet:', error);
      throw error;
    }
  }
} 