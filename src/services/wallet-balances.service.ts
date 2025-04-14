import { Pool } from 'pg';
import { TokenBalance, WalletBalanceResponse } from '../types/balance';
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
      SELECT 
        mint_address,
        amount,
        decimals,
        name,
        symbol,
        logo_uri,
        ui_amount,
        usd_value,
        last_updated
      FROM wallet_portfolio_view
      WHERE wallet_address = $1
    `;

    try {
      const result = await this.pool.query(query, [walletAddress]);
      
      const balances: TokenBalance[] = result.rows.map(row => ({
        mintAddress: row.mint_address,
        amount: parseFloat(row.amount),
        decimals: row.decimals,
        name: row.name,
        symbol: row.symbol,
        logoURI: row.logo_uri,
        uiAmount: parseFloat(row.ui_amount),
        usdValue: parseFloat(row.usd_value),
        lastUpdated: row.last_updated
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

  async createBalancesTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS wallet_balances (
        wallet_address TEXT NOT NULL,
        mint_address TEXT NOT NULL,
        amount DECIMAL NOT NULL,
        decimals INTEGER NOT NULL,
        last_updated TIMESTAMP NOT NULL,
        PRIMARY KEY (wallet_address, mint_address)
      )
    `;

    try {
      await this.pool.query(query);
    } catch (error) {
      console.error('Error creating wallet_balances table:', error);
      throw error;
    }
  }

  async populateWalletBalances(walletAddress: string): Promise<void> {
    try {
      // Get all token accounts owned by this wallet
      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(walletAddress),
        { programId: TOKEN_PROGRAM_ID }
      );

      // Process each token account
      for (const { account } of accounts.value) {
        const parsedInfo = account.data.parsed.info;
        const mintAddress = parsedInfo.mint;
        const amount = Number(parsedInfo.tokenAmount.amount);
        const decimals = parsedInfo.tokenAmount.decimals;

        // Update the balance in the database
        await this.updateBalance(
          walletAddress,
          mintAddress,
          amount,
          decimals,
          Date.now()
        );
      }
    } catch (error) {
      console.error('Error populating wallet balances:', error);
      throw error;
    }
  }
} 