/**
 * Type definitions for wallet-related functionality
 */
import { Strategy } from '../services/api/strategy.service';

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
  strategies?: Strategy[];  // Array of strategies associated with this wallet
}

/**
 * Represents stored trading wallets mapped by owner address
 */
export interface StoredTradingWallets {
  [ownerAddress: string]: TradingWallet[];  // Map of owner's address to their trading wallets
} 