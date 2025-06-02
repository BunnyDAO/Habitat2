import { PublicKey, Keypair } from '@solana/web3.js';
import { BaseWorker } from './BaseWorker';
import { WalletMonitoringJob } from '../types/jobs';
import { createRateLimitedConnection } from '../utils/connection';
import { API_CONFIG } from '../config/api';

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
          } catch {
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
      } catch (error) {
        console.error('Error loading recent transactions:', error);
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
        async (logs) => {
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

  private async processTransaction(signature: string): Promise<{
    status: 'confirmed' | 'failed';
    error?: string;
    details?: {
      inputToken: string;
      outputToken: string;
      inputAmount: number;
      outputAmount: number;
      timestamp: number;
    };
  }> {
    if (
      this.recentTransactions.has(signature) ||
      this.processingTransactions.has(signature) ||
      this.lastProcessedSignature === signature
    ) {
      console.log(`[Mirror] Skipping transaction ${signature}: already processed or in progress`);
      return {
        status: 'failed',
        error: 'Transaction already processed or in progress'
      };
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
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        console.log(`[Mirror] Transaction ${signature} not found`);
        return {
          status: 'failed',
          error: 'Transaction not found'
        };
      }

      const meta = tx.meta;
      if (!meta) {
        console.log(`[Mirror] Transaction ${signature} metadata is missing`);
        return {
          status: 'failed',
          error: 'Transaction metadata is missing'
        };
      }

      console.log('Full transaction:', tx);
      console.log('Transaction details:', meta.logMessages);

      // Log transaction version
      const message = tx.transaction.message;
      console.log('Transaction version:', 'version' in message ? message.version : 'legacy');

      // Handle account keys based on message type
      if ('accountKeys' in message) {
        // Legacy Message
        console.log('Detected legacy transaction');
      } else if ('version' in message) {
        // Versioned Message
        console.log('Detected versioned transaction');
      } else {
        console.error('Unknown message type:', message);
        return {
          status: 'failed',
          error: 'Unknown message type'
        };
      }

      // Extract trade details from transaction
      const preTokenBalances = meta.preTokenBalances || [];
      const postTokenBalances = meta.postTokenBalances || [];
      
      // Find the token changes
      const tokenChanges = new Map<string, { pre: number; post: number }>();
      
      preTokenBalances.forEach(balance => {
        if (balance.owner === this.tradingWallet.toString()) {
          tokenChanges.set(balance.mint, {
            pre: Number(balance.uiTokenAmount.uiAmount),
            post: 0
          });
        }
      });

      postTokenBalances.forEach(balance => {
        if (balance.owner === this.tradingWallet.toString()) {
          const existing = tokenChanges.get(balance.mint);
          if (existing) {
            existing.post = Number(balance.uiTokenAmount.uiAmount);
          } else {
            tokenChanges.set(balance.mint, {
              pre: 0,
              post: Number(balance.uiTokenAmount.uiAmount)
            });
          }
        }
      });

      // Find input and output tokens
      let inputToken = '';
      let outputToken = '';
      let inputAmount = 0;
      let outputAmount = 0;

      tokenChanges.forEach((change, mint) => {
        const difference = change.post - change.pre;
        if (difference < 0) {
          inputToken = mint;
          inputAmount = Math.abs(difference);
        } else if (difference > 0) {
          outputToken = mint;
          outputAmount = difference;
        }
      });

      // Before calling mirrorSwap, add a log
      console.log(`[Mirror] Attempting to mirror swap: ${inputToken} -> ${outputToken}, amount: ${outputAmount}`);
      await this.mirrorSwap(inputToken, outputToken, outputAmount);
      this.updateJobActivity();

      return {
        status: 'confirmed',
        details: {
          inputToken,
          outputToken,
          inputAmount,
          outputAmount,
          timestamp: tx.blockTime || Date.now() / 1000
        }
      };
    } catch (error) {
      console.error(`[Mirror] Error in processTransaction for ${signature}:`, error);
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      this.processingTransactions.delete(signature);
    }
  }

  private async verifyTradingStatus(): Promise<{
    hasSufficientBalance: boolean;
    lastMirrorTrade: string | null;
    lastTradeStatus: 'success' | 'failed' | 'none';
    balanceDetails: {
      sol: number;
      tokenBalances: { [mint: string]: number };
    };
  }> {
    try {
      // Check SOL balance
      const solBalance = await this.connection.getBalance(this.tradingWallet) / 1e9;
      const hasSufficientBalance = solBalance >= 0.002; // Minimum 0.002 SOL for fees

      // Get token balances
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(this.tradingWallet, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      });

      const tokenBalances: { [mint: string]: number } = {};
      tokenAccounts.value.forEach(account => {
        const parsedInfo = account.account.data.parsed.info;
        tokenBalances[parsedInfo.mint] = parsedInfo.tokenAmount.uiAmount;
      });

      // Get last mirror trade from recent transactions
      const lastMirrorTrade = this.recentTransactions.size > 0 
        ? Array.from(this.recentTransactions)[this.recentTransactions.size - 1]
        : null;

      // Check last trade status
      let lastTradeStatus: 'success' | 'failed' | 'none' = 'none';
      if (lastMirrorTrade) {
        try {
          const tx = await this.connection.getTransaction(lastMirrorTrade, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
          if (!tx || !tx.meta) {
            lastTradeStatus = 'failed';
          } else {
            lastTradeStatus = tx.meta.err ? 'failed' : 'success';
          }
        } catch (error) {
          console.error('Error checking last trade status:', error);
          lastTradeStatus = 'failed';
        }
      }

      return {
        hasSufficientBalance,
        lastMirrorTrade,
        lastTradeStatus,
        balanceDetails: {
          sol: solBalance,
          tokenBalances
        }
      };
    } catch (error) {
      console.error('Error verifying trading status:', error);
      throw error;
    }
  }

  public async getTradingStatus(): Promise<{
    hasSufficientBalance: boolean;
    lastMirrorTrade: string | null;
    lastTradeStatus: 'success' | 'failed' | 'none';
    balanceDetails: {
      sol: number;
      tokenBalances: { [mint: string]: number };
    };
  }> {
    return this.verifyTradingStatus();
  }

  private async checkTradeExecution(signature: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    error?: string;
    details?: {
      inputToken: string;
      outputToken: string;
      inputAmount: number;
      outputAmount: number;
      timestamp: number;
    };
  }> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        return {
          status: 'failed',
          error: 'Transaction not found'
        };
      }

      const meta = tx.meta;
      if (!meta) {
        return {
          status: 'failed',
          error: 'Transaction metadata is missing'
        };
      }

      if (meta.err) {
        return {
          status: 'failed',
          error: JSON.stringify(meta.err)
        };
      }

      // Extract trade details from transaction
      const preTokenBalances = meta.preTokenBalances || [];
      const postTokenBalances = meta.postTokenBalances || [];
      
      // Find the token changes
      const tokenChanges = new Map<string, { pre: number; post: number }>();
      
      preTokenBalances.forEach(balance => {
        if (balance.owner === this.tradingWallet.toString()) {
          tokenChanges.set(balance.mint, {
            pre: Number(balance.uiTokenAmount.uiAmount),
            post: 0
          });
        }
      });

      postTokenBalances.forEach(balance => {
        if (balance.owner === this.tradingWallet.toString()) {
          const existing = tokenChanges.get(balance.mint);
          if (existing) {
            existing.post = Number(balance.uiTokenAmount.uiAmount);
          } else {
            tokenChanges.set(balance.mint, {
              pre: 0,
              post: Number(balance.uiTokenAmount.uiAmount)
            });
          }
        }
      });

      // Find input and output tokens
      let inputToken = '';
      let outputToken = '';
      let inputAmount = 0;
      let outputAmount = 0;

      tokenChanges.forEach((change, mint) => {
        const difference = change.post - change.pre;
        if (difference < 0) {
          inputToken = mint;
          inputAmount = Math.abs(difference);
        } else if (difference > 0) {
          outputToken = mint;
          outputAmount = difference;
        }
      });

      return {
        status: 'confirmed',
        details: {
          inputToken,
          outputToken,
          inputAmount,
          outputAmount,
          timestamp: tx.blockTime || Date.now() / 1000
        }
      };
    } catch (error) {
      console.error('Error checking trade execution:', error);
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  public async getTradeStatus(signature: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    error?: string;
    details?: {
      inputToken: string;
      outputToken: string;
      inputAmount: number;
      outputAmount: number;
      timestamp: number;
    };
  }> {
    return this.checkTradeExecution(signature);
  }

  private async monitorMirroringProcess(inputMint: string, outputMint: string, amount: number): Promise<{
    status: 'monitoring' | 'completed' | 'failed';
    progress: {
      detected: boolean;
      quoteReceived: boolean;
      swapInitiated: boolean;
      swapConfirmed: boolean;
    };
    error?: string;
    tradeDetails?: {
      signature?: string;
      inputAmount: number;
      outputAmount?: number;
      timestamp: number;
    };
  }> {
    const startTime = Date.now();
    const maxWaitTime = 60000; // 1 minute timeout
    const checkInterval = 2000; // Check every 2 seconds

    const progress = {
      detected: true, // We already detected the trade
      quoteReceived: false,
      swapInitiated: false,
      swapConfirmed: false
    };

    try {
      // Get quote
      const queryString = `inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippageBps=50&platformFeeBps=10`;
      const quoteResponse = await fetch(API_CONFIG.JUPITER.QUOTE + queryString);

      if (!quoteResponse.ok) {
        throw new Error(`Failed to get quote: ${await quoteResponse.text()}`);
      }

      progress.quoteReceived = true;
      const quote = await quoteResponse.json();

      // Execute swap
      const swapResponse = await fetch(API_CONFIG.JUPITER.SWAP, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: this.tradingWalletKeypair?.publicKey.toString() || '',
          feeAccount: '2yrLVmLcMyZyKaV8cZKkk79zuvMPqhVjLMWkQFQtj4g6'
        }),
      });

      if (!swapResponse.ok) {
        const errorData = await swapResponse.json();
        throw new Error(`Swap failed: ${JSON.stringify(errorData)}`);
      }

      progress.swapInitiated = true;
      const swapResult = await swapResponse.json();
      const signature = swapResult.signature;

      // Monitor transaction confirmation
      while (Date.now() - startTime < maxWaitTime) {
        const tx = await this.connection.getTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });

        if (!tx) {
          await new Promise(resolve => setTimeout(resolve, checkInterval));
          continue;
        }

        const meta = tx.meta;
        if (!meta) {
          return {
            status: 'failed',
            progress,
            error: 'Transaction metadata is missing',
            tradeDetails: {
              signature,
              inputAmount: amount,
              timestamp: Date.now() / 1000
            }
          };
        }

        if (meta.err) {
          return {
            status: 'failed',
            progress,
            error: JSON.stringify(meta.err),
            tradeDetails: {
              signature,
              inputAmount: amount,
              timestamp: tx.blockTime || Date.now() / 1000
            }
          };
        }

        progress.swapConfirmed = true;
        return {
          status: 'completed',
          progress,
          tradeDetails: {
            signature,
            inputAmount: amount,
            timestamp: tx.blockTime || Date.now() / 1000
          }
        };
      }

      return {
        status: 'failed',
        progress,
        error: 'Transaction confirmation timeout',
        tradeDetails: {
          signature,
          inputAmount: amount,
          timestamp: Date.now() / 1000
        }
      };

    } catch (error) {
      return {
        status: 'failed',
        progress,
        error: error instanceof Error ? error.message : 'Unknown error',
        tradeDetails: {
          inputAmount: amount,
          timestamp: Date.now() / 1000
        }
      };
    }
  }

  public async monitorMirroring(inputMint: string, outputMint: string, amount: number): Promise<{
    status: 'monitoring' | 'completed' | 'failed';
    progress: {
      detected: boolean;
      quoteReceived: boolean;
      swapInitiated: boolean;
      swapConfirmed: boolean;
    };
    error?: string;
    tradeDetails?: {
      signature?: string;
      inputAmount: number;
      outputAmount?: number;
      timestamp: number;
    };
  }> {
    return this.monitorMirroringProcess(inputMint, outputMint, amount);
  }

  private async mirrorSwap(inputMint: string, outputMint: string, amount: number): Promise<void> {
    try {
      console.log(`[Mirror] Mirroring swap: ${inputMint} -> ${outputMint}, amount: ${amount}`);
      // First get a quote from Jupiter
      const queryString = `inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippageBps=50&platformFeeBps=10`;
      const quoteResponse = await fetch(API_CONFIG.JUPITER.QUOTE + queryString, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!quoteResponse.ok) {
        throw new Error(`Failed to get quote: ${await quoteResponse.text()}`);
      }

      const quote = await quoteResponse.json();

      // Execute the swap using the quote
      const response = await fetch(API_CONFIG.JUPITER.SWAP, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: this.tradingWalletKeypair?.publicKey.toString() || '',
          feeAccount: '2yrLVmLcMyZyKaV8cZKkk79zuvMPqhVjLMWkQFQtj4g6'
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Swap failed: ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      console.log('[Mirror] Mirror swap completed successfully:', result);
    } catch (error) {
      console.error('[Mirror] Error mirroring swap:', error);
      throw error;
    }
  }

  protected updateJobActivity() {
    if (this.job) {
      this.job.lastActivity = new Date().toISOString();
    }
  }

  // Additional methods (e.g., getTokenChanges, getBalance, getTokenBalance, mirrorSwap) can be added here if needed.
} 