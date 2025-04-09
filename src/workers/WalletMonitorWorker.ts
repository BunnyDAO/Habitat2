import { PublicKey, Keypair, Message, VersionedMessage } from '@solana/web3.js';
import { BaseWorker } from './BaseWorker';
import { WalletMonitoringJob } from '../types/jobs';
import { SOL_MINT } from '../utils/tokens'; // Assuming SOL_MINT = 'So11111111111111111111111111111111111111112'
import { swapTokens } from '../utils/swap';
import { createRateLimitedConnection } from '../utils/connection';

const MAX_RECENT_TRANSACTIONS = 50;

export class WalletMonitorWorker extends BaseWorker {
  private subscription: number | undefined;
  private walletPubkey: PublicKey;
  private tradingWallet: PublicKey;
  private walletAddress: string;
  private percentage: number;
  private recentTransactions: Set<string> = new Set();
  private transactionTimestamps: Map<string, number> = new Map();
  private processingTransactions: Set<string> = new Set();
  private lastProcessedSignature: string | null = null;

  constructor(job: WalletMonitoringJob, endpoint: string, tradingWallet: PublicKey) {
    super(job, endpoint);
    this.walletPubkey = new PublicKey(job.walletAddress);
    this.tradingWallet = tradingWallet;
    this.walletAddress = job.walletAddress;
    this.percentage = job.percentage;

    if (job.recentTransactions) {
      try {
        this.recentTransactions = new Set(job.recentTransactions);
      } catch (e) {
        console.error('Error loading recent transactions:', e);
      }
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      // Create a new connection using the Helius endpoint
      this.connection = createRateLimitedConnection('https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a');
      
      // Subscribe to account changes
      this.subscription = this.connection.onLogs(
        this.walletPubkey,
        async (logs, ctx) => {
          if (logs.err) {
            console.error('Error in logs:', logs.err);
            return;
          }
          
          // Process the transaction
          await this.processTransaction(logs.signature);
        },
        'confirmed'
      );
      
      console.log(`Started monitoring wallet ${this.walletAddress}`);
    } catch (error) {
      console.error('Error starting wallet monitor:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning || this.subscription === undefined) return;

    await this.connection.removeOnLogsListener(this.subscription);
    this.subscription = undefined;
    this.isRunning = false;
  }

  private cleanupOldTransactions(): void {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    for (const [sig, ts] of this.transactionTimestamps) {
      if (ts < oneHourAgo) {
        this.transactionTimestamps.delete(sig);
        this.recentTransactions.delete(sig);
      }
    }

    if (this.recentTransactions.size > MAX_RECENT_TRANSACTIONS) {
      const sorted = [...this.transactionTimestamps.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, this.recentTransactions.size - MAX_RECENT_TRANSACTIONS);
      sorted.forEach(([sig]) => {
        this.transactionTimestamps.delete(sig);
        this.recentTransactions.delete(sig);
      });
    }

    (this.job as WalletMonitoringJob).recentTransactions = [...this.recentTransactions];
  }

  private async processTransaction(signature: string): Promise<void> {
    if (
      this.recentTransactions.has(signature) ||
      this.processingTransactions.has(signature) ||
      this.lastProcessedSignature === signature
    ) {
      console.log(`Skipping transaction ${signature}: already processed or in progress`);
      return;
    }

    this.processingTransactions.add(signature);
    this.recentTransactions.add(signature);
    this.transactionTimestamps.set(signature, Date.now());
    this.lastProcessedSignature = signature;
    (this.job as WalletMonitoringJob).recentTransactions = [...this.recentTransactions];

    try {
      this.cleanupOldTransactions();

      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0, // Explicitly support version 0 and legacy
      });

      if (!tx || !tx.meta) {
        console.log(`Transaction ${signature} not found or incomplete`);
        return;
      }

      console.log('Full transaction:', tx);
      console.log('Transaction details:', tx.meta.logMessages);

      // Log transaction version
      const message = tx.transaction.message;
      console.log('Transaction version:', 'version' in message ? message.version : 'legacy');

      // Handle account keys based on message type
      let accountKeys: PublicKey[];
      if ('accountKeys' in message) {
        // Legacy Message
        accountKeys = (message as Message).accountKeys;
        console.log('Detected legacy transaction');
      } else if ('version' in message) {
        // Versioned Message (e.g., MessageV0)
        accountKeys = (message as VersionedMessage).staticAccountKeys;
        console.log('Detected versioned transaction');
      } else {
        console.error(`Unknown message type for tx ${signature}`);
        return;
      }

      console.log('Account keys:', accountKeys.map((key) => key.toString()));

      // Check for Jupiter swap
      const jupiterLogs = tx.meta.logMessages?.filter((log) =>
        log.includes('Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke')
      ) || [];
      console.log('Jupiter swap logs:', jupiterLogs);

      // Log SOL balance changes (if wallet is in accountKeys)
      const walletIndex = accountKeys.findIndex((key) =>
        key.toString() === this.walletPubkey.toString()
      );
      let solChange = 0;
      let preSOLBalance = 0;
      let postSOLBalance = 0;
      if (walletIndex !== -1) {
        preSOLBalance = tx.meta.preBalances[walletIndex] / 1e9;
        postSOLBalance = tx.meta.postBalances[walletIndex] / 1e9;
        solChange = postSOLBalance - preSOLBalance;
        console.log('Monitored wallet SOL balance changes:', {
          preSOLBalance,
          postSOLBalance,
          solChange,
          monitoredWallet: this.walletPubkey.toString()
        });
      } else {
        console.log(`Monitored wallet ${this.walletPubkey.toString()} not found in accountKeys`);
      }

      // Check if SOL balance is below minimum threshold after swap
      const MIN_SOL_THRESHOLD = 0.002; // 0.002 SOL minimum for fees
      if (postSOLBalance < MIN_SOL_THRESHOLD) {
        console.log(`Warning: SOL balance after swap (${postSOLBalance.toFixed(6)} SOL) is below minimum threshold (${MIN_SOL_THRESHOLD} SOL)`);
      }

      // Get token balance changes
      const tokenChanges = this.getTokenChanges(tx);
      console.log('Token balance changes:', tokenChanges);
      console.log('Pre-token balances:', tx.meta.preTokenBalances);
      console.log('Post-token balances:', tx.meta.postTokenBalances);

      // Check if wallet is involved via token accounts
      const isWalletInvolvedInTokens =
        tx.meta.preTokenBalances?.some((b) => b.owner === this.walletPubkey.toString()) ||
        tx.meta.postTokenBalances?.some((b) => b.owner === this.walletPubkey.toString());

      if (walletIndex === -1 && !isWalletInvolvedInTokens) {
        console.log(`Monitored wallet ${this.walletPubkey.toString()} not involved in tx ${signature}`);
        return;
      }

      // Detect input and output tokens
      const inputToken = tokenChanges.find((t) => t.difference < -0.000001 && t.mint !== SOL_MINT); // Exclude WSOL
      const outputToken = tokenChanges.find((t) => t.difference > 0.000001);
      const isInputSOL = solChange < -0.001 && !inputToken && walletIndex !== -1; // Only if in accountKeys
      const isOutputSOL = solChange > 0.001 && !outputToken && walletIndex !== -1;

      console.log('Swap detection:', {
        isInputSOL,
        isOutputSOL,
        solChange,
        inputToken: inputToken ? inputToken.mint : null,
        outputToken: outputToken ? outputToken.mint : null,
        walletInvolvedInTokens: isWalletInvolvedInTokens,
      });

      if (!inputToken && !isInputSOL) {
        console.log(`No detectable input token or SOL change in tx ${signature}`);
        return;
      }

      const inputMint = isInputSOL ? SOL_MINT : inputToken!.mint;
      const outputMint = isOutputSOL ? SOL_MINT : outputToken?.mint;
      if (!outputMint) {
        console.log(`No detectable output mint in tx ${signature}`);
        return;
      }

      const theirAmount = isInputSOL ? Math.abs(solChange) : Math.abs(inputToken!.difference);
      const theirPreBalance = isInputSOL ? preSOLBalance : inputToken!.preAmount;
      const percentageOfTheirBalance = theirPreBalance > 0 ? (theirAmount / theirPreBalance) * 100 : 0;
      const ourBalance = await this.getBalance(inputMint);
      let ourAmount = 0;
      console.log(isInputSOL)
      
      // Check if they're selling more than 98% of their balance
      // If so, sell our entire balance to avoid dust amounts
      if (percentageOfTheirBalance > 98) {
        console.log(`Detected large sale (${percentageOfTheirBalance.toFixed(2)}% of balance). Selling entire balance to avoid dust.`);
        ourAmount = ourBalance;
      } else if (isInputSOL) {
        ourAmount = ourBalance * (this.percentage / 100) * (percentageOfTheirBalance / 100);
      } else {
        ourAmount = ourBalance * (percentageOfTheirBalance / 100);
      }
     

      console.log('Swap details:', {
        inputMint,
        outputMint,
        theirAmount,
        theirPreBalance,
        percentageOfTheirBalance: `${percentageOfTheirBalance.toFixed(2)}%`,
        ourBalance,
        ourAmount,
        sellingEntireBalance: percentageOfTheirBalance > 95
      });

      // Define minimum amounts based on token type
      const MIN_SOL_AMOUNT = 0.005; // 0.005 SOL minimum to cover rent + fees
      const MIN_TOKEN_AMOUNT = 0.1; // 0.1 USDC/USDT/etc minimum (adjust based on token decimals)

      // Check and adjust minimum amounts
      if (isInputSOL) {
        if (ourAmount < MIN_SOL_AMOUNT) {
          console.log(`Calculated amount ${ourAmount} SOL is below minimum ${MIN_SOL_AMOUNT} SOL. Adjusting to minimum.`);
          if (ourBalance >= MIN_SOL_AMOUNT) {
            ourAmount = MIN_SOL_AMOUNT;
          } else {
            console.log(`Insufficient balance for minimum SOL swap: ${ourBalance} SOL`);
            return;
          }
        }
      } else {
        // For non-SOL tokens, check if we have enough SOL for fees
        const solBalance = await this.connection.getBalance(this.tradingWallet);
        if (solBalance / 1e9 < 0.002) { // 0.002 SOL for fees
          console.log(`Insufficient SOL balance for fees: ${solBalance / 1e9} SOL`);
          return;
        }
        
        // Check token minimum
        if (ourAmount < MIN_TOKEN_AMOUNT) {
          console.log(`Calculated amount ${ourAmount} is below minimum ${MIN_TOKEN_AMOUNT}. Adjusting to minimum.`);
          if (ourBalance >= MIN_TOKEN_AMOUNT) {
            ourAmount = MIN_TOKEN_AMOUNT;
          } else {
            console.log(`Insufficient balance for minimum token swap: ${ourBalance}`);
            return;
          }
        }
      }

      // Check final SOL balance after swap
      const finalSolBalance = await this.connection.getBalance(this.tradingWallet) / 1e9;
      
      if (finalSolBalance < MIN_SOL_THRESHOLD) {
        console.log(`Warning: SOL balance after swap (${finalSolBalance.toFixed(6)} SOL) is below minimum threshold (${MIN_SOL_THRESHOLD} SOL)`);
      }

      if (ourAmount <= 0) {
        console.log(`Invalid amount for swap: ${ourAmount}`);
        return;
      }

      console.log(`Detected swap: ${inputMint} -> ${outputMint}, Amount: ${theirAmount}, Mirroring: ${ourAmount}`);
      await this.mirrorSwap(inputMint, outputMint, ourAmount);
      this.updateJobActivity();
    } catch (error) {
      console.error(`Error processing tx ${signature}:`, error);
    } finally {
      this.processingTransactions.delete(signature);
    }
  }

  private getTokenChanges(tx: any): Array<{ mint: string; preAmount: number; postAmount: number; difference: number; decimals: number }> {
    const changes: Array<{ mint: string; preAmount: number; postAmount: number; difference: number; decimals: number }> = [];

    tx.meta.preTokenBalances?.forEach((pre: any) => {
      if (pre.owner !== this.walletPubkey.toString()) return;
      const post = tx.meta.postTokenBalances?.find(
        (p: any) => p.mint === pre.mint && p.owner === pre.owner
      );
      changes.push({
        mint: pre.mint,
        preAmount: pre.uiTokenAmount.uiAmount || 0,
        postAmount: post?.uiTokenAmount.uiAmount || 0,
        difference: (post?.uiTokenAmount.uiAmount || 0) - (pre.uiTokenAmount.uiAmount || 0),
        decimals: pre.uiTokenAmount.decimals,
      });
    });

    tx.meta.postTokenBalances?.forEach((post: any) => {
      if (post.owner !== this.walletPubkey.toString() || changes.some((c) => c.mint === post.mint)) return;
      changes.push({
        mint: post.mint,
        preAmount: 0,
        postAmount: post.uiTokenAmount.uiAmount || 0,
        difference: post.uiTokenAmount.uiAmount || 0,
        decimals: post.uiTokenAmount.decimals,
      });
    });

    return changes;
  }

  private async getBalance(mint: string): Promise<number> {
    if (mint === SOL_MINT) {
      const balance = await this.connection.getBalance(this.tradingWallet);
      console.log(`Trading wallet SOL balance: ${balance / 1e9} SOL`);
      return balance / 1e9;
    }
    return await this.getTokenBalance(mint, this.tradingWallet);
  }

  private async getTokenBalance(mint: string, owner: PublicKey): Promise<number> {
    try {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(owner, {
        mint: new PublicKey(mint),
      });
      const balance = accounts.value.reduce((total, acc) => total + (acc.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
      console.log(`Trading wallet balance for ${mint}: ${balance}`);
      return balance;
    } catch (error) {
      console.error(`Error getting token balance for ${mint}:`, error);
      return 0;
    }
  }

  private async mirrorSwap(inputMint: string, outputMint: string, amount: number): Promise<void> {
    try {
      console.log(`Mirroring swap: ${inputMint} -> ${outputMint}, amount: ${amount}`);
      
      // Get private key from localStorage
      const privateKeyStr = localStorage.getItem(`wallet_${this.tradingWallet.toString()}`);
      if (!privateKeyStr) {
        throw new Error('Private key not found in localStorage');
      }
      
      // Create keypair from private key
      const tradingWalletKeypair = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(privateKeyStr))
      );
      
      await swapTokens({
        inputMint,
        outputMint,
        amount,
        slippageBps: 50,
        walletKeypair: tradingWalletKeypair,
        connection: this.connection,
        feeWalletPubkey: '89GiEjdEaeEaEgSVwnPmV1EP9qHjbQyXZy9RNuThZmnL',
        feeBps: 10  // 0.1% fee
      });
      
      console.log('Mirror swap completed successfully');
    } catch (error) {
      console.error('Error mirroring swap:', error);
      throw error;
    }
  }
}