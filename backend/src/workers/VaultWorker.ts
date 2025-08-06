import { BaseWorker } from './BaseWorker';
import { VaultStrategy } from '../types/jobs';
import { PublicKey, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { SwapService } from '../services/swap.service';
import { tradeEventsService, TradeSuccessEvent } from '../services/trade-events.service';

export class VaultWorker extends BaseWorker {
  private tradingWalletPublicKey: string;
  private tradingWalletSecretKey: Uint8Array;
  private vaultPercentage: number;
  private mainWalletPublicKey: string;
  private tradingWalletKeypair: Keypair;
  private swapService: SwapService;
  private tradeSuccessListener: ((event: TradeSuccessEvent) => void) | null = null;
  
  // Constants
  private readonly MAX_VAULT_PERCENTAGE = 50; // 50% maximum - increased from original 5%
  private readonly MIN_TRANSFER_AMOUNT = 0.001; // 0.001 SOL minimum (200x transaction cost)
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
    
    console.log(`VaultWorker initialized: ${this.vaultPercentage}% profit capture on successful trades`);
    console.log(`Trading wallet: ${this.tradingWalletPublicKey}`);
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
      this.startListeningForTrades();
      console.log(`✅ VaultWorker started monitoring trades for wallet ${this.tradingWalletPublicKey}`);
    } catch (error) {
      console.error('Error starting vault monitor:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    this.stopListeningForTrades();
    console.log(`✅ VaultWorker stopped for wallet ${this.tradingWalletPublicKey}`);
  }

  /**
   * Start listening for trade success events from other strategies on the same trading wallet
   */
  private startListeningForTrades(): void {
    this.tradeSuccessListener = (event: TradeSuccessEvent) => {
      // Only process events for our trading wallet and ignore vault strategy events
      if (event.tradingWalletAddress === this.tradingWalletPublicKey && 
          event.strategyType !== 'vault') {
        this.handleTradeSuccess(event);
      }
    };

    tradeEventsService.onTradeSuccess(this.tradeSuccessListener);
    console.log(`[Vault] Listening for trade success events on wallet ${this.tradingWalletPublicKey}`);
  }

  /**
   * Stop listening for trade success events
   */
  private stopListeningForTrades(): void {
    if (this.tradeSuccessListener) {
      tradeEventsService.removeTradeSuccessListener(this.tradeSuccessListener);
      this.tradeSuccessListener = null;
    }
  }

  /**
   * Handle a successful trade from another strategy
   */
  private async handleTradeSuccess(event: TradeSuccessEvent): Promise<void> {
    try {
      console.log(`[Vault] Trade success detected: ${event.strategyType} strategy on wallet ${event.tradingWalletAddress}`);
      console.log(`[Vault] Transaction signature: ${event.signature}`);
      
      // Get current SOL balance of trading wallet
      const tradingWallet = new PublicKey(this.tradingWalletPublicKey);
      const balance = await this.connection.getBalance(tradingWallet);
      const solBalance = balance / 1e9; // Convert lamports to SOL
      
      console.log(`[Vault] Current trading wallet balance: ${solBalance} SOL`);
      
      // Calculate amount to vault (percentage of current balance)
      const amountToVault = (solBalance * this.vaultPercentage) / 100;
      
      console.log(`[Vault] Calculated vault amount: ${amountToVault} SOL (${this.vaultPercentage}% of ${solBalance} SOL)`);
      
      // Only transfer if amount is significant
      if (amountToVault >= this.MIN_TRANSFER_AMOUNT) {
        await this.captureProfit(amountToVault, event);
      } else {
        console.log(`[Vault] Amount ${amountToVault} SOL below minimum transfer threshold ${this.MIN_TRANSFER_AMOUNT} SOL`);
      }
      
    } catch (error) {
      console.error(`[Vault] Error handling trade success:`, error);
    }
  }

  /**
   * Capture profit by transferring SOL from trading wallet to main wallet
   */
  private async captureProfit(amount: number, triggerEvent: TradeSuccessEvent): Promise<void> {
    try {
      console.log(`[Vault] 📤 Capturing ${amount} SOL profit from trading wallet to vault`);
      console.log(`[Vault] Triggered by: ${triggerEvent.strategyType} strategy (${triggerEvent.signature})`);
      
      // Step 1: Swap any tokens to SOL if needed (future enhancement)
      await this.swapTokensToSol();
      
      // Step 2: Transfer SOL to main wallet
      await this.transferSolToMainWallet(amount);
      
      // Update job status
      (this.job as VaultStrategy).lastActivity = new Date().toISOString();
      
      console.log(`✅ [Vault] Successfully captured ${amount} SOL profit`);
      
    } catch (error) {
      console.error(`❌ [Vault] Failed to capture ${amount} SOL profit:`, error);
      throw error;
    }
  }

  private async swapTokensToSol(): Promise<void> {
    // TODO: Implement token-to-SOL swapping for future enhancement
    // For now, we assume the trading wallet primarily holds SOL
    console.log('[Vault] 📊 Checking for tokens to swap to SOL...');
    // In production: query all token accounts, swap non-SOL tokens to SOL before capturing
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
    
    console.log(`✅ [Vault] SOL transfer completed - Signature: ${signature}`);
  }
} 