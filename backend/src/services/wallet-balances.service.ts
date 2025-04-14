import { Pool } from 'pg';
import { TokenBalance, WalletBalanceResponse } from '../types';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export class WalletBalancesService {
  private connection: Connection;

  constructor(
    private pool: Pool,
    rpcUrl: string = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async getBalances(walletAddress: string): Promise<WalletBalanceResponse> {
    const query = `
      SELECT wb.mint_address, wb.amount, wb.decimals, wb.last_updated,
             t.logo_uri, t.name, t.symbol
      FROM wallet_balances wb
      LEFT JOIN tokens t ON wb.mint_address = t.mint_address
      WHERE wb.wallet_address = $1
    `;

    try {
      const result = await this.pool.query(query, [walletAddress]);
      
      const balances: TokenBalance[] = result.rows.map(row => ({
        mint: row.mint_address,
        balance: parseFloat(row.amount),
        decimals: row.decimals,
        lastUpdated: row.last_updated,
        logoURI: row.logo_uri,
        name: row.name,
        symbol: row.symbol
      }));

      return {
        walletAddress,
        balances
      };
    } catch (error) {
      console.error('Error fetching wallet balances:', error);
      throw error;
    }
  }

  async updateBalance(
    walletAddress: string,
    mintAddress: string,
    amount: number,
    decimals: number,
    lastUpdated: number
  ): Promise<void> {
    const query = `
      INSERT INTO wallet_balances (wallet_address, mint_address, amount, decimals, last_updated)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (wallet_address, mint_address)
      DO UPDATE SET
        amount = EXCLUDED.amount,
        decimals = EXCLUDED.decimals,
        last_updated = EXCLUDED.last_updated
    `;

    try {
      await this.pool.query(query, [
        walletAddress,
        mintAddress,
        amount,
        decimals,
        new Date(lastUpdated)
      ]);
    } catch (error) {
      console.error('Error updating wallet balance:', error);
      throw error;
    }
  }

  async deleteBalances(walletAddress: string): Promise<void> {
    const query = `
      DELETE FROM wallet_balances
      WHERE wallet_address = $1
    `;

    try {
      await this.pool.query(query, [walletAddress]);
    } catch (error) {
      console.error('Error deleting wallet balances:', error);
      throw error;
    }
  }

  async populateWalletBalances(walletAddress: string): Promise<void> {
    try {
      // First get SOL balance
      const solBalance = await this.connection.getBalance(new PublicKey(walletAddress));
      const solBalanceInSol = solBalance / 1e9;
      
      // Update SOL balance
      if (solBalanceInSol > 0) {
        await this.updateBalance(
          walletAddress,
          'So11111111111111111111111111111111111111112', // Native SOL mint address
          solBalanceInSol,
          9, // SOL decimals
          Date.now()
        );
      }

      // Get token accounts
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(walletAddress),
        { programId: TOKEN_PROGRAM_ID }
      );

      // Process each token account
      for (const { account } of tokenAccounts.value) {
        const parsedInfo = account.data.parsed.info;
        const tokenMint = parsedInfo.mint;
        const tokenAmount = parsedInfo.tokenAmount;
        
        // Only include tokens with non-zero balance
        if (tokenAmount.uiAmount > 0) {
          await this.updateBalance(
            walletAddress,
            tokenMint,
            tokenAmount.uiAmount,
            tokenAmount.decimals,
            Date.now()
          );
        }
      }
    } catch (error) {
      console.error('Error populating wallet balances:', error);
      throw error;
    }
  }
} 