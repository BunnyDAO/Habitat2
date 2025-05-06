import { BaseWorker } from './BaseWorker';
import { VaultStrategy } from '../types/jobs';
import { PublicKey, Keypair } from '@solana/web3.js';

export class VaultWorker extends BaseWorker {
  private tradingWalletPublicKey: string;
  private tradingWalletSecretKey: Uint8Array;
  private vaultPercentage: number;
  private tradingWalletKeypair: Keypair;
  private lastCheck: number = 0;
  private checkInterval: number = 3600000; // 1 hour

  constructor(job: VaultStrategy, endpoint: string) {
    super(job, endpoint);
    this.tradingWalletPublicKey = job.tradingWalletPublicKey;
    this.tradingWalletSecretKey = job.tradingWalletSecretKey;
    this.vaultPercentage = job.vaultPercentage;
    this.tradingWalletKeypair = Keypair.fromSecretKey(this.tradingWalletSecretKey);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      this.isRunning = true;
      await this.monitorVault();
    } catch (error) {
      console.error('Error starting vault monitor:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
  }

  private async monitorVault(): Promise<void> {
    while (this.isRunning) {
      try {
        const now = Date.now();
        if (now - this.lastCheck >= this.checkInterval) {
          await this.checkAndRebalance();
          this.lastCheck = now;
        }

        // Wait 10 minutes before next check
        await new Promise(resolve => setTimeout(resolve, 600000));
      } catch (error) {
        console.error('Error monitoring vault:', error);
        await new Promise(resolve => setTimeout(resolve, 1800000)); // Wait 30 minutes on error
      }
    }
  }

  private async checkAndRebalance(): Promise<void> {
    try {
      const tradingWallet = new PublicKey(this.tradingWalletPublicKey);
      const balance = await this.connection.getBalance(tradingWallet);
      const solBalance = balance / 1e9; // Convert lamports to SOL

      // Calculate target vault amount
      const targetVaultAmount = (solBalance * this.vaultPercentage) / 100;

      // Get current vault balance
      // TODO: Implement vault balance check
      const currentVaultBalance = 0; // Placeholder

      // Calculate difference
      const difference = targetVaultAmount - currentVaultBalance;

      if (Math.abs(difference) > 0.01) { // Only rebalance if difference is more than 0.01 SOL
        if (difference > 0) {
          // Need to move funds to vault
          console.log(`Moving ${difference} SOL to vault`);
          // TODO: Implement vault deposit
        } else {
          // Need to withdraw funds from vault
          console.log(`Withdrawing ${Math.abs(difference)} SOL from vault`);
          // TODO: Implement vault withdrawal
        }

        // Update job status
        (this.job as VaultStrategy).lastActivity = new Date().toISOString();
      }

    } catch (error) {
      console.error('Error checking and rebalancing vault:', error);
      throw error;
    }
  }
} 