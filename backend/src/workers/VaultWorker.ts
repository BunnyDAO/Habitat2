import { BaseWorker } from './BaseWorker';
import { VaultStrategy } from '../types/jobs';
import { PublicKey, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { SwapService } from '../services/swap.service';

export class VaultWorker extends BaseWorker {
  private tradingWalletPublicKey: string;
  private tradingWalletSecretKey: Uint8Array;
  private vaultPercentage: number;
  private mainWalletPublicKey: string;
  private tradingWalletKeypair: Keypair;
  private swapService: SwapService;
  private lastCheck: number = 0;
  private checkInterval: number = 3600000; // 1 hour
  
  // Constants
  private readonly MAX_VAULT_PERCENTAGE = 5; // 5% maximum
  private readonly MIN_TRANSFER_AMOUNT = 0.01; // 0.01 SOL minimum
  private readonly WSOL_MINT = 'So11111111111111111111111111111111111111112';

  constructor(job: VaultStrategy, endpoint: string, swapService?: SwapService) {
    super(job, endpoint);
    this.tradingWalletPublicKey = job.tradingWalletPublicKey;
    this.tradingWalletSecretKey = job.tradingWalletSecretKey;
    this.mainWalletPublicKey = job.mainWalletPublicKey;
    this.tradingWalletKeypair = Keypair.fromSecretKey(this.tradingWalletSecretKey);
    
    // Validate and cap percentage
    this.vaultPercentage = this.validateAndCapPercentage(job.vaultPercentage);
    
    // Initialize swap service (will be provided in production, mocked in tests)
    this.swapService = swapService || new SwapService(
      // These would be injected in real implementation
      null as any, this.connection, null
    );
    
    console.log(`VaultWorker initialized: ${this.vaultPercentage}% allocation to vault`);
    console.log(`Main wallet: ${this.mainWalletPublicKey}`);
  }

  private validateAndCapPercentage(percentage: number): number {
    if (percentage < 0) {
      throw new Error('Vault percentage cannot be negative');
    }
    if (percentage > this.MAX_VAULT_PERCENTAGE) {
      console.warn(`Vault percentage ${percentage}% exceeds maximum ${this.MAX_VAULT_PERCENTAGE}%. Capping at ${this.MAX_VAULT_PERCENTAGE}%`);
      return this.MAX_VAULT_PERCENTAGE;
    }
    return percentage;
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
      const mainWallet = new PublicKey(this.mainWalletPublicKey);
      
      // Get trading wallet balance
      const tradingBalance = await this.connection.getBalance(tradingWallet);
      const tradingSolBalance = tradingBalance / 1e9; // Convert lamports to SOL

      // Get main wallet balance (this is our "vault")
      const mainBalance = await this.connection.getBalance(mainWallet);
      const mainSolBalance = mainBalance / 1e9;

      console.log(`Trading wallet balance: ${tradingSolBalance} SOL`);
      console.log(`Main wallet balance: ${mainSolBalance} SOL`);

      // Calculate total portfolio value
      const totalPortfolioValue = await this.calculateTotalPortfolioValue(tradingWallet);
      console.log(`Total portfolio value: ${totalPortfolioValue} SOL`);

      // Calculate target vault amount (% of total portfolio)
      const targetVaultAmount = (totalPortfolioValue * this.vaultPercentage) / 100;
      console.log(`Target vault amount: ${targetVaultAmount} SOL (${this.vaultPercentage}%)`);

      // Calculate difference (main wallet IS the vault)
      const difference = targetVaultAmount - mainSolBalance;
      console.log(`Vault difference: ${difference} SOL`);

      // Only rebalance if difference is significant
      if (Math.abs(difference) > this.MIN_TRANSFER_AMOUNT) {
        if (difference > 0) {
          // Need to move funds TO main wallet (vault)
          await this.moveToVault(difference);
        } else {
          // Need to move funds FROM main wallet back to trading
          await this.moveFromVault(Math.abs(difference));
        }

        // Update job status
        (this.job as VaultStrategy).lastActivity = new Date().toISOString();
        console.log('✅ Vault rebalancing completed');
      } else {
        console.log(`✅ Vault is balanced (difference ${difference} SOL < ${this.MIN_TRANSFER_AMOUNT} SOL threshold)`);
      }

    } catch (error) {
      console.error('❌ Error checking and rebalancing vault:', error);
      throw error;
    }
  }

  private async calculateTotalPortfolioValue(tradingWallet: PublicKey): Promise<number> {
    // Get SOL balance
    const solBalance = await this.connection.getBalance(tradingWallet);
    let totalValue = solBalance / 1e9;

    // TODO: Add token holdings value calculation
    // For now, just use SOL balance as total portfolio value
    // In production, you'd iterate through all token accounts and calculate USD value
    
    return totalValue;
  }

  private async moveToVault(amount: number): Promise<void> {
    console.log(`📤 Moving ${amount} SOL from trading wallet to vault (main wallet)`);
    
    try {
      // Step 1: Swap any tokens to SOL if needed
      await this.swapTokensToSol();
      
      // Step 2: Transfer SOL to main wallet
      await this.transferSolToMainWallet(amount);
      
      console.log(`✅ Successfully moved ${amount} SOL to vault`);
    } catch (error) {
      console.error(`❌ Failed to move ${amount} SOL to vault:`, error);
      throw error;
    }
  }

  private async moveFromVault(amount: number): Promise<void> {
    console.log(`📥 Moving ${amount} SOL from vault (main wallet) to trading wallet`);
    
    try {
      // Note: This would require the main wallet to also be controlled
      // For now, we'll just log this operation
      // In production, you'd need user approval or a separate mechanism
      console.log(`⚠️  Vault withdrawal requires main wallet signature - operation logged only`);
      
      // TODO: Implement vault withdrawal mechanism
      // This might require user interaction or a separate approval process
      
    } catch (error) {
      console.error(`❌ Failed to move ${amount} SOL from vault:`, error);
      throw error;
    }
  }

  private async swapTokensToSol(): Promise<void> {
    // TODO: Implement token-to-SOL swapping
    // For now, we assume the trading wallet primarily holds SOL
    console.log('📊 Checking for tokens to swap to SOL...');
    // In production: query all token accounts, swap non-SOL tokens to SOL
  }

  private async transferSolToMainWallet(amount: number): Promise<void> {
    const lamports = Math.floor(amount * 1e9); // Convert SOL to lamports
    
    const transferInstruction = SystemProgram.transfer({
      fromPubkey: this.tradingWalletKeypair.publicKey,
      toPubkey: new PublicKey(this.mainWalletPublicKey),
      lamports: lamports,
    });

    const transaction = new Transaction().add(transferInstruction);
    
    // Get recent blockhash
    const { blockhash } = await this.connection.getRecentBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.tradingWalletKeypair.publicKey;

    // Sign and send transaction
    transaction.sign(this.tradingWalletKeypair);
    const signature = await this.connection.sendRawTransaction(transaction.serialize());
    
    // Confirm transaction
    await this.connection.confirmTransaction(signature, 'confirmed');
    
    console.log(`✅ SOL transfer completed - Signature: ${signature}`);
  }
} 