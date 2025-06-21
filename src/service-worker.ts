/// <reference lib="webworker" />
import { JobType, WalletMonitoringJob, PriceMonitoringJob, VaultStrategy, LevelsStrategy, AnyJob, ensureUint8Array, ProfitSnapshot } from './types/jobs';
import { PublicKey, Connection, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { swapTokens } from './utils/swap';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { API_CONFIG } from './config/api';

declare const self: ServiceWorkerGlobalScope;

// IndexedDB setup
const DB_NAME = 'lackey-backpack-db';
const DB_VERSION = 1;
const JOBS_STORE = 'jobs';
const WALLETS_STORE = 'wallets';

let db: IDBDatabase | null = null;

// Initialize IndexedDB
async function initDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve();
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Create stores if they don't exist
      if (!db.objectStoreNames.contains(JOBS_STORE)) {
        db.createObjectStore(JOBS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(WALLETS_STORE)) {
        db.createObjectStore(WALLETS_STORE, { keyPath: 'publicKey' });
      }
    };
  });
}

// Store jobs in IndexedDB
async function storeJobs(jobs: AnyJob[]): Promise<void> {
  if (!db) await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db!.transaction(JOBS_STORE, 'readwrite');
    const store = transaction.objectStore(JOBS_STORE);
    
    // Clear existing jobs
    store.clear();
    
    // Add new jobs
    jobs.forEach(job => {
      store.add(job);
    });
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// Get all jobs from IndexedDB
async function getJobs(): Promise<AnyJob[]> {
  if (!db) await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db!.transaction(JOBS_STORE, 'readonly');
    const store = transaction.objectStore(JOBS_STORE);
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Store active jobs in memory for quick access
let activeJobs: Map<string, AnyJob> = new Map();
const CHECK_INTERVAL = 250; // Check every 0.25 seconds

// RPC endpoint for Solana connection - Use backend proxy for security
const SOLANA_RPC = API_CONFIG.RPC_BASE;
const connection = new Connection(SOLANA_RPC, 'confirmed');

// Update TokenBalance interface
interface TokenBalance {
  mint: string;
  symbol: string;
  balance: number;
  decimals: number;
  uiBalance: number;
}

// Store token balances in memory
const tokenBalances: Map<string, TokenBalance[]> = new Map();

interface WorkerMessage {
  type: 'ADD_JOB' | 'REMOVE_JOB' | 'UPDATE_JOB' | 'SYNC_JOBS';
  data: {
    job?: AnyJob;
    jobId?: string;
    jobs?: AnyJob[];
  };
}

interface ParsedTransaction {
  transaction: {
    message: any;
  };
  meta: {
    preTokenBalances: any[];
    postTokenBalances: any[];
  };
}

interface LevelConfig {
  price: number;
  percentage: number;
}

// Handle messages from the main app
self.addEventListener('message', async (event: ExtendableMessageEvent) => {
  const { type, data } = event.data as WorkerMessage;

  switch (type) {
    case 'ADD_JOB':
      if (data.job) {
        await handleAddJob(data.job);
      }
      break;
    case 'REMOVE_JOB':
      if (data.jobId) {
        await handleRemoveJob(data.jobId);
      }
      break;
    case 'UPDATE_JOB':
      if (data.job) {
        await handleUpdateJob(data.job);
      }
      break;
    case 'SYNC_JOBS':
      if (data.jobs) {
        await handleSyncJobs(data.jobs);
      }
      break;
  }
});

// Handle adding a new job
async function handleAddJob(job: AnyJob) {
  activeJobs.set(job.id, job);
  await storeJobs(Array.from(activeJobs.values()));
  startJobProcessing(job);
}

// Handle removing a job
async function handleRemoveJob(jobId: string) {
  activeJobs.delete(jobId);
  await storeJobs(Array.from(activeJobs.values()));
}

// Handle updating a job
async function handleUpdateJob(job: AnyJob) {
  activeJobs.set(job.id, job);
  await storeJobs(Array.from(activeJobs.values()));
}

// Handle syncing all jobs
async function handleSyncJobs(jobs: AnyJob[]) {
  activeJobs = new Map(jobs.map(job => [job.id, job]));
  await storeJobs(jobs);
  jobs.forEach(job => {
    if (job.isActive) {
      startJobProcessing(job);
    }
  });
}

// Start processing a job
function startJobProcessing(job: AnyJob) {
  if (!job.isActive) return;

  switch (job.type) {
    case JobType.WALLET_MONITOR:
      startWalletMonitoring(job as WalletMonitoringJob);
      break;
    case JobType.PRICE_MONITOR:
      startPriceMonitoring(job as PriceMonitoringJob);
      break;
    case JobType.VAULT:
      startVaultStrategy(job as VaultStrategy);
      break;
    case JobType.LEVELS:
      startLevelsStrategy(job as LevelsStrategy);
      break;
  }
}

// Wallet monitoring logic
function startWalletMonitoring(job: WalletMonitoringJob) {
  let subscription: number | undefined;

  const startMonitoring = async () => {
    if (subscription) {
      await connection.removeOnLogsListener(subscription);
    }

    const monitoredWallet = new PublicKey(job.walletAddress);
    const tradingWallet = new PublicKey(job.tradingWalletPublicKey);

    subscription = connection.onLogs(
      monitoredWallet,
      async (logs) => {
        if (!activeJobs.has(job.id)) {
          if (subscription) {
            await connection.removeOnLogsListener(subscription);
          }
          return;
        }

        try {
          const tx = await connection.getTransaction(logs.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });

          if (!tx || !tx.meta) return;

          // Process transaction and execute mirror trade if needed
          await processWalletTransaction(job, tx);
        } catch (error) {
          console.error('Error processing transaction:', error);
        }
      },
      'confirmed'
    );
  };

  // Start monitoring
  startMonitoring();
}

// Price monitoring logic
function startPriceMonitoring(job: PriceMonitoringJob) {
  let lastCheck = Date.now();
  
  const checkPrice = async () => {
    if (!activeJobs.has(job.id)) return;
    
    try {
      // Get SOL price
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const data = await response.json();
      const currentPrice = data.solana.usd;

      // Check if price condition is met
      const conditionMet = job.direction === 'above' 
        ? currentPrice >= job.targetPrice
        : currentPrice <= job.targetPrice;

      if (conditionMet && (!job.lastTriggerPrice || Date.now() - lastCheck > 300000)) { // 5 minutes cooldown
        lastCheck = Date.now();
        job.lastTriggerPrice = currentPrice;
        await executeTradeForPriceStrategy(job, currentPrice);
      }
    } catch (error) {
      console.error('Error in price monitoring:', error);
    }
  };

  // Start periodic checking
  setInterval(checkPrice, CHECK_INTERVAL);
}

// Vault strategy logic
function startVaultStrategy(job: VaultStrategy) {
  let lastCheck = Date.now();
  
  const checkVault = async () => {
    if (!activeJobs.has(job.id)) return;
    
    try {
      const tradingWallet = new PublicKey(job.tradingWalletPublicKey);
      const balance = await connection.getBalance(tradingWallet);
      const solBalance = balance / 1e9;

      // If balance is above threshold, move to vault
      if (solBalance > 0.1) { // Minimum 0.1 SOL to cover fees
        const amountToMove = (solBalance * job.vaultPercentage) / 100;
        await executeVaultTransfer(job, amountToMove);
      }
    } catch (error) {
      console.error('Error in vault strategy:', error);
    }
  };

  // Start periodic checking
  setInterval(checkVault, CHECK_INTERVAL);
}

// Levels strategy logic
function startLevelsStrategy(job: LevelsStrategy) {
  let lastCheck = Date.now();
  
  const checkLevels = async () => {
    if (!activeJobs.has(job.id)) return;
    
    try {
      // Get SOL price
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const data = await response.json();
      const currentPrice = data.solana.usd;

      // Check each level
      for (const level of job.levels) {
        if (currentPrice <= level.price && (!job.lastTriggerPrice || currentPrice < job.lastTriggerPrice)) {
          job.lastTriggerPrice = currentPrice;
          await executeLevelStrategy(job, level, currentPrice);
          break; // Only execute one level at a time
        }
      }
    } catch (error) {
      console.error('Error in levels strategy:', error);
    }
  };

  // Start periodic checking
  setInterval(checkLevels, CHECK_INTERVAL);
}

// Helper function to process wallet transactions
async function processWalletTransaction(job: WalletMonitoringJob, tx: ParsedTransaction) {
  try {
    const message = tx.transaction.message;
    const accountKeys = 'accountKeys' in message ? message.accountKeys : message.staticAccountKeys;
    const monitoredWallet = new PublicKey(job.walletAddress);

    // Check for Jupiter swap
    const jupiterLogs = tx.meta.logMessages?.filter((log: string) =>
      log.includes('Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke')
    ) || [];

    // Get token changes
    const tokenChanges = getTokenChanges(tx, monitoredWallet);
    const walletIndex = accountKeys.findIndex((key: PublicKey) =>
      key.toString() === monitoredWallet.toString()
    );

    // Calculate SOL changes
    let solChange = 0;
    let preSOLBalance = 0;
    if (walletIndex !== -1) {
      preSOLBalance = Number(tx.meta.preBalances[walletIndex]) / Number(1e9);
      const postSOLBalance = Number(tx.meta.postBalances[walletIndex]) / Number(1e9);
      solChange = postSOLBalance - preSOLBalance;
    }

    // Detect input and output tokens
    const inputToken = tokenChanges.find(t => t.difference < -0.000001);
    const outputToken = tokenChanges.find(t => t.difference > 0.000001);
    const isInputSOL = solChange < -0.001 && !inputToken;
    const isOutputSOL = solChange > 0.001 && !outputToken;

    if (!inputToken && !isInputSOL) return;

    const inputMint = isInputSOL ? 'So11111111111111111111111111111111111111112' : inputToken!.mint;
    const outputMint = isOutputSOL ? 'So11111111111111111111111111111111111111112' : outputToken?.mint;

    if (!outputMint) return;

    // Calculate amounts
    const theirAmount = isInputSOL ? Math.abs(solChange) : Math.abs(inputToken!.difference);
    const theirPreBalance = isInputSOL ? preSOLBalance : Number(inputToken!.preAmount);
    const percentageOfTheirBalance = theirPreBalance > 0 ? (theirAmount / theirPreBalance) * 100 : 0;

    // Get our balance
    const tradingWallet = new PublicKey(job.tradingWalletPublicKey);
    const ourBalance = await getTokenBalance(tradingWallet, inputMint);

    // Calculate our trade amount
    let ourAmount = 0;
    if (percentageOfTheirBalance > 98) {
      // If they're selling most of their balance, sell all of ours
      ourAmount = ourBalance.balance;
    } else {
      // Otherwise mirror their percentage
      ourAmount = ourBalance.balance * (Number(job.percentage) / 100) * (percentageOfTheirBalance / 100);
    }

    // Execute the trade
    if (ourAmount > 0) {
      await executeSwap(job, inputMint, outputMint, ourAmount);
    }
  } catch (error) {
    console.error('Error processing wallet transaction:', error);
  }
}

// Helper function to execute trades for price monitoring
async function executeTradeForPriceStrategy(job: PriceMonitoringJob, currentPrice: number) {
  try {
    const tradingWallet = new PublicKey(job.tradingWalletPublicKey);
    const balance = await connection.getBalance(tradingWallet);
    const solBalance = balance / 1e9;

    if (solBalance < 0.1) return; // Minimum balance check

    const amountToSell = (solBalance * job.percentageToSell) / 100;
    if (amountToSell <= 0) return;

    // Execute swap from SOL to USDC
    await executeSwap(
      job,
      'So11111111111111111111111111111111111111112', // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      amountToSell
    );
  } catch (error) {
    console.error('Error executing price strategy trade:', error);
  }
}

// Helper function to execute vault transfers
async function executeVaultTransfer(job: VaultStrategy, amount: number) {
  try {
    const tradingWalletKeypair = Keypair.fromSecretKey(
      ensureUint8Array(job.tradingWalletSecretKey)
    );

    const transaction = await createTransferTransaction(
      connection,
      tradingWalletKeypair.publicKey,
      new PublicKey(job.tradingWalletPublicKey), // vault address
      amount
    );

    const signature = await connection.sendTransaction(transaction, [tradingWalletKeypair]);
    await connection.confirmTransaction(signature);
  } catch (error) {
    console.error('Error executing vault transfer:', error);
  }
}

// Helper function to execute level-based trades
async function executeLevelStrategy(job: LevelsStrategy, level: LevelConfig, currentPrice: number) {
  try {
    const tradingWallet = new PublicKey(job.tradingWalletPublicKey);
    const balance = await connection.getBalance(tradingWallet);
    const solBalance = balance / 1e9;

    if (solBalance < 0.1) return; // Minimum balance check

    const amountToSell = (solBalance * level.percentage) / 100;
    if (amountToSell <= 0) return;

    // Execute swap from SOL to USDC
    await executeSwap(
      job,
      'So11111111111111111111111111111111111111112', // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      amountToSell
    );
  } catch (error) {
    console.error('Error executing level strategy trade:', error);
  }
}

// Helper function to execute swaps
async function executeSwap(job: AnyJob, inputMint: string, outputMint: string, amount: number) {
  try {
    const tradingWalletKeypair = Keypair.fromSecretKey(
      ensureUint8Array(job.tradingWalletSecretKey)
    );

    await swapTokens({
      inputMint,
      outputMint,
      amount,
      slippageBps: 50,
      walletKeypair: tradingWalletKeypair,
      connection,
      feeWalletPubkey: 'HFTWr46ZdZTEoMwHPHvpvXviTCthUTpjQMbvRnFPVHb1',
      feeBps: 10
    });
  } catch (error) {
    console.error('Error executing swap:', error);
  }
}

// Helper function to get token balance
async function getTokenBalance(wallet: PublicKey, mint: string): Promise<TokenBalance> {
  const defaultBalance: TokenBalance = {
    mint,
    symbol: 'Unknown',
    balance: 0,
    decimals: 0,
    uiBalance: 0
  };

  // Check if we have cached balance
  const walletBalances = tokenBalances.get(wallet.toString());
  const cachedBalance = walletBalances?.find(b => b.mint === mint) || defaultBalance;

  try {
    if (mint === 'So11111111111111111111111111111111111111112') {
      const balance = await connection.getBalance(wallet);
      const solBalance = Number(balance.toString()) / Number(1e9);
      
      const tokenBalance: TokenBalance = {
        mint,
        symbol: 'SOL',
        balance: Number(balance),
        decimals: 9,
        uiBalance: solBalance
      };
      
      // Update cache
      if (!walletBalances) {
        tokenBalances.set(wallet.toString(), [tokenBalance]);
      } else {
        const index = walletBalances.findIndex(b => b.mint === mint);
        if (index >= 0) {
          walletBalances[index] = tokenBalance;
        } else {
          walletBalances.push(tokenBalance);
        }
      }
      
      return tokenBalance;
    } else {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet, {
        mint: new PublicKey(mint)
      });
      
      if (tokenAccounts.value.length === 0) {
        const metadata = await getTokenMetadata(mint);
        const tokenBalance: TokenBalance = {
          mint,
          symbol: metadata.symbol,
          balance: 0,
          decimals: metadata.decimals,
          uiBalance: 0
        };

        // Update cache
        if (!walletBalances) {
          tokenBalances.set(wallet.toString(), [tokenBalance]);
        } else {
          const index = walletBalances.findIndex(b => b.mint === mint);
          if (index >= 0) {
            walletBalances[index] = tokenBalance;
          } else {
            walletBalances.push(tokenBalance);
          }
        }

        return tokenBalance;
      }
      
      const parsedInfo = tokenAccounts.value[0].account.data.parsed.info;
      const metadata = await getTokenMetadata(mint);
      const tokenBalance: TokenBalance = {
        mint,
        symbol: metadata.symbol,
        balance: Number(parsedInfo.tokenAmount.amount),
        decimals: metadata.decimals,
        uiBalance: Number(parsedInfo.tokenAmount.uiAmount) || 0
      };
      
      // Update cache
      if (!walletBalances) {
        tokenBalances.set(wallet.toString(), [tokenBalance]);
      } else {
        const index = walletBalances.findIndex(b => b.mint === mint);
        if (index >= 0) {
          walletBalances[index] = tokenBalance;
        } else {
          walletBalances.push(tokenBalance);
        }
      }
      
      return tokenBalance;
    }
  } catch (error) {
    console.error('Error getting token balance:', error);
    return cachedBalance;
  }
}

// Helper function to get token changes from a transaction
function getTokenChanges(tx: any, wallet: PublicKey): any[] {
  const changes: any[] = [];
  const walletStr = wallet.toString();

  if (!tx.meta.preTokenBalances || !tx.meta.postTokenBalances) return changes;

  const preBalances = new Map(
    tx.meta.preTokenBalances
      .filter((b: any) => b.owner === walletStr)
      .map((b: any) => [b.mint, Number(b.uiTokenAmount.uiAmount) || 0])
  );

  const postBalances = new Map(
    tx.meta.postTokenBalances
      .filter((b: any) => b.owner === walletStr)
      .map((b: any) => [b.mint, Number(b.uiTokenAmount.uiAmount) || 0])
  );

  // Track all mints
  const mints = new Set([...preBalances.keys(), ...postBalances.keys()]);

  mints.forEach(mint => {
    const pre = Number(preBalances.get(mint)) || 0;
    const post = Number(postBalances.get(mint)) || 0;
    const difference = Number(post) - Number(pre);

    if (difference !== 0) {
      changes.push({
        mint,
        preAmount: pre,
        postAmount: post,
        difference
      });
    }
  });

  return changes;
}

// Helper function to create transfer transaction
async function createTransferTransaction(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  amount: number
) {
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports: Math.floor(amount * 1e9) // Convert SOL to lamports and ensure integer
    })
  );
  
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = from;
  
  return transaction;
}

// Token metadata cache
const TOKEN_METADATA: Record<string, { symbol: string; decimals: number }> = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9 },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6 },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', decimals: 6 },
  // Add more known tokens here
};

// Helper function to get token metadata
async function getTokenMetadata(mint: string): Promise<{ symbol: string; decimals: number }> {
  // Try to get from cache first
  const cachedMetadata = TOKEN_METADATA[mint];
  if (cachedMetadata) {
    return cachedMetadata;
  }

  try {
    // Try to get from token account info
    const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(mint));
    if (
      tokenInfo.value && 
      'parsed' in tokenInfo.value.data && 
      tokenInfo.value.data.parsed.type === 'mint'
    ) {
      const { decimals } = tokenInfo.value.data.parsed.info;
      TOKEN_METADATA[mint] = {
        symbol: mint.slice(0, 4), // Use first 4 chars as symbol if we don't know it
        decimals
      };
      return TOKEN_METADATA[mint];
    }
  } catch (error) {
    console.error('Error fetching token metadata:', error);
  }

  // Return default if we couldn't get metadata
  return {
    symbol: mint.slice(0, 4),
    decimals: 0
  };
}

// Helper function to update profit tracking for a job
async function updateJobProfitTracking(job: AnyJob, currentBalance: number, currentPrice: number) {
  const initialValue = job.profitTracking.initialBalance * job.profitTracking.initialPrice;
  const currentValue = currentBalance * currentPrice;
  const currentProfit = ((currentValue - initialValue) / initialValue) * 100;

  // Create a new snapshot
  const snapshot: ProfitSnapshot = {
    timestamp: new Date().toISOString(),
    balance: currentBalance,
    price: currentPrice,
    profit: currentProfit
  };

  // Update the job's profit tracking
  job.profitTracking = {
    ...job.profitTracking,
    currentBalance,
    currentPrice,
    currentProfit,
    lastUpdated: new Date().toISOString(),
    history: [...job.profitTracking.history, snapshot]
  };

  // Update the job in the active jobs map
  activeJobs.set(job.id, job);

  // Store updated jobs
  await storeJobs(Array.from(activeJobs.values()));

  // Notify main app of the update
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'JOB_UPDATE',
      data: { job }
    });
  });
}

// Helper function to check if balances have significantly changed
function hasSignificantChange(oldBalances: TokenBalance[] | undefined, newBalances: TokenBalance[]): boolean {
  if (!oldBalances || !newBalances) return true;
  if (oldBalances.length !== newBalances.length) return true;

  for (const newBalance of newBalances) {
    const oldBalance = oldBalances.find(b => b.mint === newBalance.mint);
    if (!oldBalance) return true;
    
    // For SOL, consider changes greater than 0.0001 SOL significant
    if (newBalance.mint === 'So11111111111111111111111111111111111111112') {
      if (Math.abs(newBalance.uiBalance - oldBalance.uiBalance) > 0.0001) return true;
    } else {
      // For other tokens, consider changes greater than 0.1% significant
      if (oldBalance.uiBalance === 0 && newBalance.uiBalance === 0) continue;
      const change = Math.abs(newBalance.uiBalance - oldBalance.uiBalance) / (oldBalance.uiBalance || 1);
      if (change > 0.001) return true;
    }
  }
  return false;
}

// Helper function to update all token balances for a wallet
async function updateWalletBalances(wallet: PublicKey): Promise<void> {
  try {
    const currentBalances = tokenBalances.get(wallet.toString());
    const balances: TokenBalance[] = [];
    
    // Get SOL balance first
    const solBalance = await connection.getBalance(wallet);
    const solUiBalance = Number(solBalance) / Number(1e9);
    balances.push({
      mint: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      balance: Number(solBalance),
      decimals: 9,
      uiBalance: solUiBalance
    });

    // Get SOL price
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await response.json();
    const currentPrice = data.solana.usd;
    
    // Get all token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet, {
      programId: TOKEN_PROGRAM_ID
    });
    
    // Process each token account
    for (const { account } of tokenAccounts.value) {
      if ('parsed' in account.data) {
        const parsedData = account.data.parsed;
        if (parsedData.type === 'account') {
          const { mint, tokenAmount } = parsedData.info;
          const metadata = await getTokenMetadata(mint);
          
          balances.push({
            mint,
            symbol: metadata.symbol,
            balance: Number(tokenAmount.amount),
            decimals: metadata.decimals,
            uiBalance: Number(tokenAmount.uiAmount) || 0
          });
        }
      }
    }

    // Check if balances have significantly changed
    if (!hasSignificantChange(currentBalances, balances)) {
      console.log('No significant balance changes detected, skipping update');
      return;
    }
    
    // Store balances in memory
    tokenBalances.set(wallet.toString(), balances);
    
    // Update profit tracking for all jobs associated with this wallet
    const walletStr = wallet.toString();
    for (const job of activeJobs.values()) {
      if (job.tradingWalletPublicKey === walletStr) {
        await updateJobProfitTracking(job, solUiBalance, currentPrice);
      }
    }
    
    // Log balances for debugging
    console.log('Updated balances for wallet:', wallet.toString(), balances);
    
    // Notify main app of balance update
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'BALANCE_UPDATE',
        data: {
          wallet: wallet.toString(),
          balances
        }
      });
    });
  } catch (error) {
    console.error('Error updating wallet balances:', error);
  }
}

// Update balances more frequently initially
const updateInterval = 10000; // 10 seconds
let updateCount = 0;
const maxUpdates = 6; // Update 6 times at 10-second intervals

const updateBalances = () => {
  activeJobs.forEach(job => {
    const tradingWallet = new PublicKey(job.tradingWalletPublicKey);
    updateWalletBalances(tradingWallet);
  });

  updateCount++;
  if (updateCount >= maxUpdates) {
    // Switch to normal 30-second interval after initial frequent updates
    setInterval(() => {
      activeJobs.forEach(job => {
        const tradingWallet = new PublicKey(job.tradingWalletPublicKey);
        updateWalletBalances(tradingWallet);
      });
    }, 30000);
  }
};

// Start frequent updates
const initialUpdateInterval = setInterval(() => {
  updateBalances();
  if (updateCount >= maxUpdates) {
    clearInterval(initialUpdateInterval);
  }
}, updateInterval);

// Service worker installation
self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    Promise.all([
      initDB(),
      self.skipWaiting()
    ])
  );
});

// Service worker activation
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Load existing jobs from IndexedDB
      getJobs().then(jobs => {
        activeJobs = new Map(jobs.map(job => [job.id, job]));
        jobs.forEach(job => {
          if (job.isActive) {
            startJobProcessing(job);
          }
        });
      })
    ])
  );
}); 