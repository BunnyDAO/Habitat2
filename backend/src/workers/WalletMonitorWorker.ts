import { PublicKey, Keypair, Message, VersionedMessage } from '@solana/web3.js';
import { BaseWorker } from './BaseWorker';
import { WalletMonitoringJob } from '../types/jobs';
import { createRateLimitedConnection } from '../utils/connection';

const MAX_RECENT_TRANSACTIONS = 50;

interface TokenBalance {
  mint: string;
  uiTokenAmount: {
    uiAmount: number;
    decimals: number;
  };
  owner: string;
}

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
  private tradingWalletKeypair: Keypair | null = null;

  constructor(job: WalletMonitoringJob, endpoint: string, tradingWallet: PublicKey) {
    super(job, endpoint);
    this.walletPubkey = new PublicKey(job.walletAddress);
    this.tradingWallet = tradingWallet;
    this.walletAddress = job.walletAddress;
    this.percentage = job.percentage;
    
    // Only initialize keypair if secret key is provided
    if (job.tradingWalletSecretKey) {
      let secretKey: Uint8Array;
      try {
        if (job.tradingWalletSecretKey instanceof Uint8Array) {
          secretKey = job.tradingWalletSecretKey;
        } else if (Array.isArray(job.tradingWalletSecretKey)) {
          secretKey = new Uint8Array(job.tradingWalletSecretKey);
        } else if (typeof job.tradingWalletSecretKey === 'string') {
          // Handle base64 encoded secret key
          try {
            const decoded = Buffer.from(job.tradingWalletSecretKey, 'base64');
            if (decoded.length !== 64) {
              throw new Error(`Invalid secret key size: expected 64 bytes, got ${decoded.length}`);
            }
            secretKey = new Uint8Array(decoded);
          } catch (e) {
            throw new Error('Invalid secret key format: not a valid base64 string');
          }
        } else {
          throw new Error('Invalid secret key format: must be Uint8Array, number[], or base64 string');
        }
        
        // Validate secret key size
        if (secretKey.length !== 64) {
          throw new Error(`Invalid secret key size: expected 64 bytes, got ${secretKey.length}`);
        }
        
        this.tradingWalletKeypair = Keypair.fromSecretKey(secretKey);
      } catch (error) {
        console.error('Error initializing trading wallet keypair:', error);
        // Don't throw, just set keypair to null
        this.tradingWalletKeypair = null;
      }
    }

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
        async (logs: { err: any; signature: string }, ctx: any) => {
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
        // Versioned Message
        accountKeys = (message as VersionedMessage).staticAccountKeys;
        console.log('Detected versioned transaction');
      } else {
        console.error('Unknown message type:', message);
        return;
      }

      // Process transaction logic here...
      // (e.g., mirror swaps, balance checks, etc.)

    } catch (error) {
      console.error(`Error processing transaction ${signature}:`, error);
    } finally {
      this.processingTransactions.delete(signature);
    }
  }

  // Additional methods (e.g., getTokenChanges, getBalance, getTokenBalance, mirrorSwap) can be added here if needed.
} 