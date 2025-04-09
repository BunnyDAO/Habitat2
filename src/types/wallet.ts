/**
 * Type definitions for wallet-related functionality
 */

/**
 * Represents a trading wallet
 */
export interface TradingWallet {
  publicKey: string;
  secretKey: number[];
  mnemonic: string;
  name?: string;  // Optional name for the trading wallet
  createdAt: number;  // Timestamp when wallet was created
}

/**
 * Represents stored trading wallets mapped by owner address
 */
export interface StoredTradingWallets {
  [ownerAddress: string]: TradingWallet[];  // Map of owner's address to their trading wallets
} 