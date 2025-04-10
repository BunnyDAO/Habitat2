/**
 * Type definitions for wallet-related functionality
 */

/**
 * Represents a trading wallet
 */
export interface TradingWallet {
  publicKey: string;
  name?: string;
  createdAt: number;
}

/**
 * Represents stored trading wallets mapped by owner address
 */
export interface StoredTradingWallets {
  [ownerAddress: string]: TradingWallet[];  // Map of owner's address to their trading wallets
} 