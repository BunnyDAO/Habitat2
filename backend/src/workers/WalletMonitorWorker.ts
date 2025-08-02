import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { BaseWorker } from './BaseWorker';
import { WalletMonitoringJob } from '../types/jobs';
import { createRateLimitedConnection } from '../utils/connection';
import { API_CONFIG } from '../config/api';
import { SwapService } from '../services/swap.service';

const MAX_RECENT_TRANSACTIONS = 50;

// Jupiter Lite API Configuration
const JUPITER_PLATFORM_FEE_BPS = 20; // 0.2% platform fee
const JUPITER_FEE_ACCOUNT = '2yrLVmLcMyZyKaV8cZKkk79zuvMPqhVjLMWkQFQtj4g6';

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
  private swapService: SwapService;

  constructor(job: WalletMonitoringJob, endpoint: string, tradingWallet: PublicKey, swapService: SwapService) {
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
    this.swapService = swapService;
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
      const preBalances = meta.preBalances || [];
      const postBalances = meta.postBalances || [];
      
      console.log('[Mirror] Wallet being monitored:', this.walletPubkey.toString());
      console.log('[Mirror] Trading wallet:', this.tradingWallet.toString());
      console.log('[Mirror] Pre-token balances:', preTokenBalances);
      console.log('[Mirror] Post-token balances:', postTokenBalances);
      console.log('[Mirror] Pre-balances (SOL):', preBalances);
      console.log('[Mirror] Post-balances (SOL):', postBalances);
      
      // Find the token changes (including wrapped SOL)
      const tokenChanges = new Map<string, { pre: number; post: number }>();
      
      // Handle account keys based on message type
      let accountKeys: string[] = [];
      if ('accountKeys' in message) {
        // Legacy Message
        accountKeys = message.accountKeys.map(key => key.toString());
        console.log('[Mirror] Legacy transaction - accountKeys count:', accountKeys.length);
      } else if ('version' in message && message.staticAccountKeys) {
        // Versioned Message
        accountKeys = [...message.staticAccountKeys.map(key => key.toString())];
        console.log('[Mirror] Versioned transaction - staticAccountKeys count:', message.staticAccountKeys.length);
        
        // Also include loaded addresses for versioned transactions
        if (meta.loadedAddresses) {
          if (meta.loadedAddresses.readonly) {
            accountKeys.push(...meta.loadedAddresses.readonly.map(key => key.toString()));
            console.log('[Mirror] Added readonly loaded addresses:', meta.loadedAddresses.readonly.length);
          }
          if (meta.loadedAddresses.writable) {
            accountKeys.push(...meta.loadedAddresses.writable.map(key => key.toString()));
            console.log('[Mirror] Added writable loaded addresses:', meta.loadedAddresses.writable.length);
          }
        }
        console.log('[Mirror] Total accountKeys after including loaded addresses:', accountKeys.length);
      }
      
      console.log('[Mirror] Looking for monitored wallet:', this.walletPubkey.toString());
      console.log('[Mirror] Account keys:', accountKeys.slice(0, 10), accountKeys.length > 10 ? '...' : '');
      console.log('[Mirror] preBalances length:', preBalances.length);
      console.log('[Mirror] postBalances length:', postBalances.length);
      
      // Check for native SOL balance changes
      const walletIndex = accountKeys.indexOf(this.walletPubkey.toString());
      console.log('[Mirror] Wallet index in accountKeys:', walletIndex);
      
      if (walletIndex !== -1 && walletIndex < preBalances.length && walletIndex < postBalances.length) {
        const preSOLBalance = preBalances[walletIndex] / 1e9; // Convert lamports to SOL
        const postSOLBalance = postBalances[walletIndex] / 1e9;
        
        console.log('[Mirror] Native SOL balance change detected:', {
          walletIndex,
          preSOL: preSOLBalance,
          postSOL: postSOLBalance,
          difference: postSOLBalance - preSOLBalance,
          absoluteDifference: Math.abs(postSOLBalance - preSOLBalance)
        });
        
        // Only count significant SOL balance changes (not just transaction fees)
        // Use a smaller threshold to capture micro-swaps but ignore pure fee transactions
        const SOL_THRESHOLD = 0.0001; // 0.0001 SOL threshold to capture very small trades
        if (Math.abs(postSOLBalance - preSOLBalance) > SOL_THRESHOLD) {
          console.log(`[Mirror] SOL balance change above threshold (${SOL_THRESHOLD}), adding to tokenChanges`);
          tokenChanges.set('So11111111111111111111111111111111111111112', { // SOL mint address
            pre: preSOLBalance,
            post: postSOLBalance
          });
        } else {
          console.log(`[Mirror] SOL balance change below threshold (${SOL_THRESHOLD}), ignoring (likely just fees)`);
        }
      } else {
        console.log('[Mirror] Monitored wallet not found in account keys or balance arrays');
        console.log('[Mirror] walletIndex:', walletIndex);
        console.log('[Mirror] preBalances.length:', preBalances.length);
        console.log('[Mirror] postBalances.length:', postBalances.length);
      }
      
      // Check for SPL token balance changes (including wrapped SOL)
      preTokenBalances.forEach(balance => {
        console.log('[Mirror] Checking pre-balance owner:', balance.owner, 'vs monitored wallet:', this.walletPubkey.toString());
        if (balance.owner === this.walletPubkey.toString()) {
          console.log('[Mirror] Found pre-balance for monitored wallet:', balance);
          
          // For wrapped SOL, check if there's already a native SOL entry and replace it
          if (balance.mint === 'So11111111111111111111111111111111111111112') {
            console.log('[Mirror] Found wrapped SOL pre-balance:', balance.uiTokenAmount.uiAmount);
            tokenChanges.set(balance.mint, {
              pre: Number(balance.uiTokenAmount.uiAmount),
              post: 0
            });
          } else {
            tokenChanges.set(balance.mint, {
              pre: Number(balance.uiTokenAmount.uiAmount),
              post: 0
            });
          }
        }
      });

      postTokenBalances.forEach(balance => {
        console.log('[Mirror] Checking post-balance owner:', balance.owner, 'vs monitored wallet:', this.walletPubkey.toString());
        if (balance.owner === this.walletPubkey.toString()) {
          console.log('[Mirror] Found post-balance for monitored wallet:', balance);
          
          const existing = tokenChanges.get(balance.mint);
          if (existing) {
            existing.post = Number(balance.uiTokenAmount.uiAmount);
          } else {
            tokenChanges.set(balance.mint, {
              pre: 0,
              post: Number(balance.uiTokenAmount.uiAmount)
            });
          }
          
          // For wrapped SOL, add special logging
          if (balance.mint === 'So11111111111111111111111111111111111111112') {
            console.log('[Mirror] Found wrapped SOL post-balance:', balance.uiTokenAmount.uiAmount);
          }
        }
      });
      
      console.log('[Mirror] Token changes map (including SOL):', Array.from(tokenChanges.entries()));

      // Find input and output tokens
      let inputToken = '';
      let outputToken = '';
      let inputAmount = 0;
      let outputAmount = 0;

      tokenChanges.forEach((change, mint) => {
        const difference = change.post - change.pre;
        console.log(`[Mirror] Token ${mint} change: ${change.pre} -> ${change.post} (diff: ${difference})`);
        
        if (difference < 0) {
          inputToken = mint;
          inputAmount = Math.abs(difference);
          console.log(`[Mirror] Found input token: ${mint}, amount: ${inputAmount}`);
        } else if (difference > 0) {
          outputToken = mint;
          outputAmount = difference;
          console.log(`[Mirror] Found output token: ${mint}, amount: ${outputAmount}`);
        }
      });

      // Special case: If we only found one token change, check if it's a SOL -> SPL token swap
      // In this case, SOL decrease might not be captured properly due to small amounts or fee confusion
      if (!inputToken && outputToken && outputToken !== 'So11111111111111111111111111111111111111112') {
        // Assume SOL was the input token for SOL -> SPL token swaps
        inputToken = 'So11111111111111111111111111111111111111112';
        inputAmount = outputAmount; // Use output amount as estimation
        console.log(`[Mirror] Detected SOL -> SPL token swap. Assuming SOL input: ${inputAmount}`);
      } else if (inputToken && !outputToken && inputToken !== 'So11111111111111111111111111111111111111112') {
        // Assume SOL was the output token for SPL token -> SOL swaps
        outputToken = 'So11111111111111111111111111111111111111112';
        outputAmount = inputAmount; // Use input amount as estimation
        console.log(`[Mirror] Detected SPL token -> SOL swap. Assuming SOL output: ${outputAmount}`);
      }

      console.log(`[Mirror] Final detection - Input: ${inputToken}, Output: ${outputToken}`);

      // Validate that we found valid tokens before proceeding
      if (!inputToken || !outputToken) {
        console.log(`[Mirror] Skipping transaction - missing valid tokens. Input: ${inputToken}, Output: ${outputToken}`);
        return {
          status: 'failed',
          error: 'No valid token swap detected in transaction'
        };
      }

      // Additional validation for public key format (skip for SOL native token)
      if (!this.isValidTokenAddress(inputToken) || !this.isValidTokenAddress(outputToken)) {
        console.log(`[Mirror] Skipping transaction - invalid token addresses. Input: ${inputToken}, Output: ${outputToken}`);
        return {
          status: 'failed',
          error: 'Invalid token addresses detected'
        };
      }

      // Convert amounts to proper scale for Jupiter API
      let scaledInputAmount = inputAmount;
      let scaledOutputAmount = outputAmount;
      
      // Get proper decimal scaling for each token
      const inputDecimals = await this.getTokenDecimals(inputToken);
      const outputDecimals = await this.getTokenDecimals(outputToken);
      
      // Scale amounts based on actual token decimals
      // For wrapped SOL: token balances are already in UI amount (SOL units), multiply by 10^9 to get lamports
      // For SPL tokens: balance changes are in UI amount, so multiply by 10^decimals to get raw amount
      if (inputToken === 'So11111111111111111111111111111111111111112') {
        scaledInputAmount = Math.floor(inputAmount * Math.pow(10, inputDecimals)); // Wrapped SOL to lamports
        console.log('[Mirror] Scaled wrapped SOL input amount:', scaledInputAmount);
      } else {
        scaledInputAmount = Math.floor(inputAmount * Math.pow(10, inputDecimals)); // UI to raw amount
      }
      
      if (outputToken === 'So11111111111111111111111111111111111111112') {
        scaledOutputAmount = Math.floor(outputAmount * Math.pow(10, outputDecimals)); // Wrapped SOL to lamports
        console.log('[Mirror] Scaled wrapped SOL output amount:', scaledOutputAmount);
      } else {
        scaledOutputAmount = Math.floor(outputAmount * Math.pow(10, outputDecimals)); // UI to raw amount
      }
      
      // Before calling mirrorSwap, add a log
      console.log(`[Mirror] Attempting to mirror swap: ${inputToken} -> ${outputToken}`);
      console.log(`[Mirror] Original amounts - input: ${inputAmount}, output: ${outputAmount}`);
      console.log(`[Mirror] Token decimals - input: ${inputDecimals}, output: ${outputDecimals}`);
      console.log(`[Mirror] Scaled amounts - input: ${scaledInputAmount}, output: ${scaledOutputAmount}`);
      
      // Use input amount for the swap (what we're selling), not output amount (what we expect to receive)
      await this.mirrorSwap(inputToken, outputToken, scaledInputAmount);
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
      // Ensure token accounts exist for both input and output tokens
      if (this.tradingWalletKeypair) {
        await this.ensureTokenAccount(inputMint, this.tradingWalletKeypair.publicKey);
        await this.ensureTokenAccount(outputMint, this.tradingWalletKeypair.publicKey);
      }
      
      // Execute swap using SwapService
      const swapResult = await this.swapService.executeSwap({
        inputMint,
        outputMint,
        amount,
        slippageBps: 50, // 0.5% slippage
        walletKeypair: {
          publicKey: this.tradingWalletKeypair?.publicKey.toString() || '',
          secretKey: Array.from(this.tradingWalletKeypair?.secretKey || [])
        },
        feeWalletPubkey: JUPITER_FEE_ACCOUNT
      });

      progress.quoteReceived = true;
      progress.swapInitiated = true;
      progress.swapConfirmed = true;

      console.log(`[WalletMonitor] Mirror swap completed: ${swapResult.signature}`);

      return {
        status: 'completed',
        progress,
        tradeDetails: {
          signature: swapResult.signature,
          inputAmount: amount,
          outputAmount: parseFloat(swapResult.outputAmount),
          timestamp: Date.now()
        }
      };

    } catch (error) {
      console.error('[WalletMonitor] Error in mirroring process:', error);
      return {
        status: 'failed',
        progress,
        error: error instanceof Error ? error.message : 'Unknown error'
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

  private isValidTokenAddress(address: string): boolean {
    try {
      // SOL native token is always valid
      if (address === 'So11111111111111111111111111111111111111112') {
        return true;
      }
      
      // Check if it's a valid public key format
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  private async getTokenDecimals(mintAddress: string): Promise<number> {
    try {
      // SOL has 9 decimals
      if (mintAddress === 'So11111111111111111111111111111111111111112') {
        return 9;
      }

      // Get token mint info to determine decimals
      const mint = new PublicKey(mintAddress);
      const mintInfo = await this.connection.getParsedAccountInfo(mint);
      
      if (mintInfo.value && mintInfo.value.data && 'parsed' in mintInfo.value.data) {
        const parsed = mintInfo.value.data.parsed;
        if (parsed.info && typeof parsed.info.decimals === 'number') {
          return parsed.info.decimals;
        }
      }

      // Default to 6 decimals if we can't determine
      console.warn(`[Mirror] Could not determine decimals for token ${mintAddress}, defaulting to 6`);
      return 6;
    } catch (error) {
      console.error(`[Mirror] Error getting token decimals for ${mintAddress}:`, error);
      return 6; // Default fallback
    }
  }

  private async ensureTokenAccount(mintAddress: string, wallet: PublicKey): Promise<PublicKey> {
    try {
      // Skip for SOL (native token)
      if (mintAddress === 'So11111111111111111111111111111111111111112') {
        return wallet; // SOL uses the wallet's main account
      }

      const mint = new PublicKey(mintAddress);
      const associatedTokenAddress = await getAssociatedTokenAddress(
        mint,
        wallet,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Check if the account already exists
      const accountInfo = await this.connection.getAccountInfo(associatedTokenAddress);
      
      if (!accountInfo) {
        console.log(`[Mirror] Creating token account for ${mintAddress} on wallet ${wallet.toString()}`);
        
        // Create the associated token account
        const createAccountInstruction = createAssociatedTokenAccountInstruction(
          wallet, // payer
          associatedTokenAddress, // associated token account
          wallet, // owner
          mint, // mint
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const transaction = new Transaction().add(createAccountInstruction);
        const { blockhash } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = wallet;

        if (this.tradingWalletKeypair) {
          transaction.sign(this.tradingWalletKeypair);
          const signature = await this.connection.sendTransaction(transaction, [this.tradingWalletKeypair]);
          await this.connection.confirmTransaction(signature);
          console.log(`[Mirror] Token account created: ${signature}`);
        } else {
          console.error('[Mirror] Cannot create token account: trading wallet keypair not available');
        }
      }

      return associatedTokenAddress;
    } catch (error) {
      console.error(`[Mirror] Error ensuring token account for ${mintAddress}:`, error);
      throw error;
    }
  }

  private async mirrorSwap(inputMint: string, outputMint: string, amount: number): Promise<void> {
    try {
      console.log(`[Mirror] Mirroring swap: ${inputMint} -> ${outputMint}, amount: ${amount}`);
      
      // Validate amount before swapping
      if (amount <= 0) {
        throw new Error(`Invalid swap amount: ${amount}. Amount must be positive.`);
      }
      
      // Add safety check for extremely large amounts (might indicate calculation error)
      const MAX_REASONABLE_AMOUNT = 1e15; // 1 million tokens with 9 decimals
      if (amount > MAX_REASONABLE_AMOUNT) {
        console.warn(`[Mirror] WARNING: Very large swap amount detected: ${amount}. This might indicate a calculation error.`);
      }

      console.log(`[Mirror] Executing swap with validated parameters:`, {
        inputMint,
        outputMint,
        amount,
        amountFormatted: amount / 1e9, // Assuming 9 decimals for logging
        tradingWallet: this.tradingWalletKeypair?.publicKey.toString()
      });
      
      // Ensure token accounts exist for both input and output tokens
      if (this.tradingWalletKeypair) {
        await this.ensureTokenAccount(inputMint, this.tradingWalletKeypair.publicKey);
        await this.ensureTokenAccount(outputMint, this.tradingWalletKeypair.publicKey);
      }
      
      // Execute swap using SwapService
      const swapResult = await this.swapService.executeSwap({
        inputMint,
        outputMint,
        amount,
        slippageBps: 50, // 0.5% slippage
        walletKeypair: {
          publicKey: this.tradingWalletKeypair?.publicKey.toString() || '',
          secretKey: Array.from(this.tradingWalletKeypair?.secretKey || [])
        },
        feeWalletPubkey: JUPITER_FEE_ACCOUNT
      });

      console.log('[Mirror] Mirror swap completed successfully:', swapResult.signature);
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