export interface TradingWallet {
  id: string;
  publicKey: string;
  name?: string;
  createdAt: string;
  secretKey?: string; // base64-encoded secret key
} 