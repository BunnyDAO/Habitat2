import { Connection, PublicKey } from '@solana/web3.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const isSOLToken = (mint: string): boolean => 
  mint === SOL_MINT || mint === WSOL_MINT; 

export async function getTokenBalance(
  connection: Connection,
  tokenMint: string,
  owner: PublicKey
): Promise<number> {
  try {
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
      mint: new PublicKey(tokenMint),
    });
    
    const balance = accounts.value.reduce((total, acc) => {
      const amount = acc.account.data.parsed.info.tokenAmount.uiAmount || 0;
      return total + amount;
    }, 0);
    
    return balance;
  } catch (error) {
    console.error(`Error getting token balance for ${tokenMint}:`, error);
    return 0;
  }
} 