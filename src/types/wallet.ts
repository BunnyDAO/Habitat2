/**
 * Type definitions for wallet-related functionality
 */

/**
 * Represents a trading wallet
 */
export interface TradingWallet {
  id?: string;
  publicKey: string;
  secretKey?: Uint8Array; // optional, may be undefined
  mnemonic?: string;
  name?: string;  // Optional name for the trading wallet
  createdAt: string;  // Timestamp when wallet was created (ISO string)
}

/**
 * Represents stored trading wallets mapped by owner address
 */
export interface StoredTradingWallets {
  [ownerAddress: string]: TradingWallet[];  // Map of owner's address to their trading wallets
} 