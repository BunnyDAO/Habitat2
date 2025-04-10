import React, { useEffect, useState, useRef, ReactElement, useCallback, useMemo } from 'react';
import './App.css';
import styles from './styles/Wallet.module.css';
import { ConnectionProvider, WalletProvider, useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, Keypair, Transaction, TransactionInstruction, TransactionExpiredBlockheightExceededError } from '@solana/web3.js';
import { JobManager } from './managers/JobManager';
import { JobType, WalletMonitoringJob, AnyJob, PriceMonitoringJob, VaultStrategy, LevelsStrategy, Level, ensureUint8Array } from './types/jobs';
import { Buffer } from 'buffer';
import { PriceFeedService } from './services/PriceFeedService';
import PasswordModal from './components/PasswordModal';
import ImportWalletModal from './components/ImportWalletModal';
import Notification from './components/Notification';
import { WhaleTracker } from './components/WhaleTracker/WhaleTracker';
import { exportWallets } from './utils/walletExportImport';
import { importLackeys, mergeLackeys } from './utils/lackeyExportImport';
import WalletLimitDialog from './components/WalletLimitDialog';
import DeleteWalletDialog from './components/DeleteWalletDialog';
import LackeyImportExport from './components/LackeyImportExport';
import { Graphs } from './pages/Graphs';
import { WalletMonitorIcon } from './components/WalletMonitorIcon';
import { TradingWalletIcon, LackeyIcon, PriceMonitorIcon, VaultIcon, LevelsIcon } from './components/StrategyIcons';
import OverrideLackeyModal from './components/OverrideLackeyModal';
import bs58 from 'bs58';
import { createRateLimitedConnection } from './utils/connection';
import { tradingWalletService } from './services/tradingWalletService';

// Add SelectedToken interface
interface SelectedToken {
  mintAddress: string;
  symbol: string;
}

// Add at the top with other imports and constants
const JUPITER_API_BASE = 'https://api.jup.ag/swap/v1';
const HELIUS_API_KEY = 'dd2b28a0-d00e-44f1-bbda-23c042d7476a';
const HELIUS_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a';

interface JupiterConfig {
    endpoint: string;
    displayMode: string;
    integratedTargetId: string;
    defaultExplorer: string;
    wallet: {
      name: string;
      url: string;
      connect: () => Promise<{
        publicKey: PublicKey;
        signTransaction: (tx: Transaction) => Promise<Transaction>;
        signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
      }>;
    };
  platformFeeAndAccounts?: {
    feeBps: number;
    feeAccounts: Record<string, never>;
  };
  onSuccess?: (data: { 
    txid: string; 
    outputAmount?: string; 
    outputMint?: string;
    inputAmount?: string;
    inputMint?: string;
  }) => void;
  onError?: (error: Error) => void;
}

interface JupiterAPI {
  init: (config: JupiterConfig) => void;
  openModal: (params: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    amount: string;
    slippage: number;
  }) => void;
}

declare global {
  interface Window {
    Jupiter: JupiterAPI;
  }
}

// Simplified to just use Helius RPC
const RPC_ENDPOINTS = [
  'https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a'
];

// Define the transaction event type
interface TransactionEventDetail {
  transaction: string;
  lastValidBlockHeight: number;
  computeUnitLimit: number;
  prioritizationFeeLamports: number;
  walletAddress?: string;
}

// Add token metadata mapping
const TOKEN_METADATA: { [key: string]: { symbol: string; decimals: number } } = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6 },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', decimals: 6 },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', decimals: 5 },
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9 },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', decimals: 9 },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': { symbol: 'JUP', decimals: 6 }
};

// Add interface for Jupiter token info
interface JupiterTokenInfo {
  address: string;
  chainId: number;
  decimals: number;
  name: string;
  symbol: string;
  logoURI?: string;
  tags?: string[];
}

// Add a function to control logging verbosity
const DEBUG_MODE = false;

const log = (message: string, ...args: unknown[]) => {
  if (DEBUG_MODE) {
    console.log(message, ...args);
  }
};

const logError = (message: string, ...args: unknown[]) => {
  console.error(message, ...args);
};

// Cache for token metadata
const tokenMetadataCache = new Map<string, { symbol: string; decimals: number }>();

// Initialize token metadata cache from localStorage
(() => {
  try {
    const cachedMetadata = localStorage.getItem('token_metadata_cache');
    if (cachedMetadata) {
      const parsedCache = JSON.parse(cachedMetadata);
      Object.entries(parsedCache).forEach(([mint, metadata]) => {
        tokenMetadataCache.set(mint, metadata as { symbol: string; decimals: number });
      });
      log(`Loaded ${tokenMetadataCache.size} tokens from metadata cache`);
    }
  } catch (error) {
    logError('Error loading token metadata cache:', error);
  }
})();

// Function to save token metadata cache to localStorage
const saveTokenMetadataCache = () => {
  try {
    const cacheObject = Object.fromEntries(tokenMetadataCache.entries());
    localStorage.setItem('token_metadata_cache', JSON.stringify(cacheObject));
  } catch (error) {
    logError('Error saving token metadata cache:', error);
  }
};

// Function to fetch token metadata
const fetchTokenMetadata = async (mint: string, connection?: Connection): Promise<{ symbol: string; decimals: number }> => {
  log('Fetching metadata for mint:', mint);

  // Check cache first
  if (tokenMetadataCache.has(mint)) {
    log('Found in cache:', tokenMetadataCache.get(mint));
    return tokenMetadataCache.get(mint)!;
  }

  // Check hardcoded metadata
  if (TOKEN_METADATA[mint]) {
    log('Found in hardcoded metadata:', TOKEN_METADATA[mint]);
    tokenMetadataCache.set(mint, TOKEN_METADATA[mint]);
    saveTokenMetadataCache(); // Save to localStorage
    return TOKEN_METADATA[mint];
  }

  try {
    // Fetch from Jupiter API
    log('Fetching from Jupiter main list...');
    const response = await fetch('https://token.jup.ag/all');
    
    if (!response.ok) {
      logError('Jupiter API error:', response.status, response.statusText);
      throw new Error(`Jupiter API error: ${response.status} ${response.statusText}`);
    }
    
    const tokens: JupiterTokenInfo[] = await response.json();
    log(`Received ${tokens.length} tokens from Jupiter main list`);
    
    // Log exact search parameters
    log('Searching for mint address:', mint);
    log('First token that matches:', tokens.find(t => t.address.toLowerCase() === mint.toLowerCase()));
    
    const token = tokens.find(t => t.address === mint);
    
    if (token) {
      log('Found token in Jupiter main list:', token);
      const metadata = { symbol: token.symbol, decimals: token.decimals };
      tokenMetadataCache.set(mint, metadata);
      saveTokenMetadataCache(); // Save to localStorage
      return metadata;
    }

    // If not found in Jupiter's list, try strict list
    log('Token not found in main list, trying strict list...');
    const strictResponse = await fetch('https://token.jup.ag/strict');
    
    if (!strictResponse.ok) {
      logError('Jupiter strict API error:', strictResponse.status, strictResponse.statusText);
      throw new Error(`Jupiter strict API error: ${strictResponse.status} ${strictResponse.statusText}`);
    }
    
    const strictTokens: JupiterTokenInfo[] = await strictResponse.json();
    log(`Received ${strictTokens.length} tokens from strict list`);
    
    // Log the first matching token in strict list
    log('First strict token that matches:', strictTokens.find(t => t.address.toLowerCase() === mint.toLowerCase()));
    
    const strictToken = strictTokens.find(t => t.address === mint);
    
    if (strictToken) {
      log('Found token in strict list:', strictToken);
      const metadata = { symbol: strictToken.symbol, decimals: strictToken.decimals };
      tokenMetadataCache.set(mint, metadata);
      saveTokenMetadataCache(); // Save to localStorage
      return metadata;
    }

    log('Token not found in any Jupiter list, trying on-chain metadata...');
    throw new Error('Token not found in Jupiter lists');
  } catch (error) {
    logError('Error fetching token metadata:', error);
    // Try to get metadata from the token's on-chain account
    if (connection) {
      try {
        // First get decimals from token account
        const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(mint));
        if (tokenInfo.value?.data && 'parsed' in tokenInfo.value.data) {
          const decimals = tokenInfo.value.data.parsed.info.decimals;
          log('Found decimals from token account:', decimals);

          // Try to get metadata from Metaplex
          try {
            const metaplexKey = PublicKey.findProgramAddressSync(
              [
                Buffer.from('metadata'),
                new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
                new PublicKey(mint).toBuffer(),
              ],
              new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
            )[0];

            const metaplexAccount = await connection.getAccountInfo(metaplexKey);
            if (metaplexAccount && metaplexAccount.data) {
              let offset = 1 + 32 + 32; // Skip key, update authority, and mint

              // Helper function to read string
              const readString = () => {
                const length = metaplexAccount.data[offset];
                offset += 1;
                const str = metaplexAccount.data.slice(offset, offset + length).toString('utf8').replace(/\0/g, '');
                offset += length;
                return str;
              };

              try {
                const name = readString();
                const symbol = readString();
                
                log('Found on-chain metadata:', { name, symbol });
                if (symbol || name) {
                  const metadata = { symbol: symbol || name || 'Unknown', decimals };
                  tokenMetadataCache.set(mint, metadata);
                  saveTokenMetadataCache(); // Save to localStorage
                  return metadata;
                }
              } catch (e) {
                logError('Error parsing Metaplex strings:', e);
              }
            }
          } catch (e) {
            logError('Error getting Metaplex metadata:', e);
          }

          // If we couldn't get the symbol from Metaplex, return Unknown with the correct decimals
          const metadata = { symbol: 'Unknown', decimals };
          tokenMetadataCache.set(mint, metadata);
          saveTokenMetadataCache(); // Save to localStorage
          return metadata;
        }
      } catch (e) {
        logError('Error getting token decimals:', e);
      }
    }
    
    // If all else fails, return a default
    const defaultMetadata = { symbol: 'Unknown', decimals: 9 };
    tokenMetadataCache.set(mint, defaultMetadata);
    saveTokenMetadataCache(); // Save to localStorage
    return defaultMetadata;
  }
};

// Add interface for trading wallet
interface TradingWallet {
  publicKey: string;
  secretKey: number[];
  mnemonic: string;
  name?: string;  // Optional name for the trading wallet
  createdAt: number;  // Timestamp when wallet was created
}

interface StoredTradingWallets {
  [ownerAddress: string]: TradingWallet[];  // Map of owner's address to their trading wallets
}

// Add error type definition
type TransactionError = {
  name?: string;
  message: string;
  stack?: string;
  constructor?: { name: string };
};

// Add Tooltip component at the top level
const Tooltip: React.FC<{ content: string; children: React.ReactNode }> = ({ content, children }) => {
  return (
    <div className={styles.tooltip}>
      {children}
      <div className={styles.tooltipContent}>
        {content}
        <div className={styles.tooltipArrow} />
      </div>
    </div>
  );
};

interface TokenBalance {
  mint: string;
  symbol: string;
  balance: number;
  decimals: number;
  uiBalance: number;
  usdValue?: number;
  logoURI?: string;  // Add logoURI field
}

interface ParsedTokenInfo {
  mint: string;
  tokenSymbol?: string;
  tokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number;
  };
}

// Navigation type
type Page = 'dashboard' | 'whale-tracker' | 'graphs';

// Whale Tracker Component
const WhaleTrackerPage: React.FC<{ onRpcError: () => void; currentEndpoint: string }> = ({ onRpcError, currentEndpoint }) => {
  return (
    <div style={{
      backgroundColor: '#0f172a',
      minHeight: '100vh',
      padding: '2rem',
      margin: 0,
      boxSizing: 'border-box',
      isolation: 'isolate',
      position: 'relative',
      zIndex: 1
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{
          backgroundColor: '#1e293b',
          padding: '1.5rem',
          borderRadius: '1rem',
          marginBottom: '2rem',
          isolation: 'isolate'
        }}>
          <h2 style={{ 
            color: '#60a5fa',
            marginTop: 0,
            marginBottom: '1rem',
            fontSize: '1.5rem'
          }}>Whale Tracker</h2>
          <WhaleTracker
            heliusApiKey={HELIUS_API_KEY}
            endpoint={HELIUS_ENDPOINT}
          />
        </div>
      </div>
    </div>
  );
};

// Navigation Bar Component
const NavigationBar: React.FC<{ currentPage: Page; onPageChange: (page: Page) => void }> = ({ currentPage, onPageChange }) => {
  const [solPrice, setSolPrice] = useState<number>(0);

  useEffect(() => {
    const priceFeed = PriceFeedService.getInstance();
    const handlePriceUpdate = (prices: { sol: number }) => {
      setSolPrice(prices.sol);
    };

    priceFeed.on('price_update', handlePriceUpdate);
    priceFeed.start();

    return () => {
      priceFeed.removeListener('price_update', handlePriceUpdate);
    };
  }, []);

  return (
    <div style={{
      backgroundColor: '#1e293b',
      padding: '1rem 2rem',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottom: '1px solid #2d3748'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              position: 'relative',
              cursor: 'pointer',
            }}
            className="mascot-container"
          >
            <img 
              src="/assets/images/mascot.png" 
              alt="Lackey Mascot" 
              className="mascot-image"
              style={{ 
                height: '4.2rem', // Increased from 3.5rem to 4.2rem (20% larger)
                width: 'auto',
                borderRadius: '1rem',
                filter: 'drop-shadow(0 0 10px rgba(96, 165, 250, 0.3))',
                marginTop: '10px', // Added margin to move the logo down
              }}
            />
            <style>
              {`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
                @keyframes fadeIn {
                  0% { opacity: 0; transform: translateY(-10px); }
                  100% { opacity: 1; transform: translateY(0); }
                }
                .mascot-image {
                  transition: transform 0.3s ease-in-out, filter 0.3s ease-in-out;
                }
                .mascot-image:hover {
                  transform: scale(1.1) rotate(5deg);
                  filter: drop-shadow(0 0 15px rgba(96, 165, 250, 0.5));
                }
              `}
            </style>
          </div>
        <h1 style={{ 
          color: '#60a5fa', 
          margin: 0,
          fontSize: '1.5rem',
          fontWeight: 'bold'
        }}>Resonance</h1>
        </div>
        <nav style={{ display: 'flex', gap: '1.5rem' }}>
          <button
            onClick={() => onPageChange('dashboard')}
            style={{
              backgroundColor: currentPage === 'dashboard' ? '#2563eb' : 'transparent',
              color: currentPage === 'dashboard' ? 'white' : '#94a3b8',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '600',
              transition: 'all 0.2s',
              position: 'relative',
              overflow: 'hidden'
            }}
            onMouseEnter={(e) => {
              if (currentPage !== 'dashboard') {
                e.currentTarget.style.backgroundColor = '#1e40af20';
                e.currentTarget.style.color = '#e2e8f0';
              }
            }}
            onMouseLeave={(e) => {
              if (currentPage !== 'dashboard') {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#94a3b8';
              }
            }}
          >
            Dashboard
          </button>
          <button
            onClick={() => onPageChange('whale-tracker')}
            style={{
              backgroundColor: currentPage === 'whale-tracker' ? '#2563eb' : 'transparent',
              color: currentPage === 'whale-tracker' ? 'white' : '#94a3b8',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '600',
              transition: 'all 0.2s',
              position: 'relative',
              overflow: 'hidden'
            }}
            onMouseEnter={(e) => {
              if (currentPage !== 'whale-tracker') {
                e.currentTarget.style.backgroundColor = '#1e40af20';
                e.currentTarget.style.color = '#e2e8f0';
              }
            }}
            onMouseLeave={(e) => {
              if (currentPage !== 'whale-tracker') {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#94a3b8';
              }
            }}
          >
            Whale Tracker
          </button>
          <button
            onClick={() => onPageChange('graphs')}
            style={{
              backgroundColor: currentPage === 'graphs' ? '#2563eb' : 'transparent',
              color: currentPage === 'graphs' ? 'white' : '#94a3b8',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '600',
              transition: 'all 0.2s',
              position: 'relative',
              overflow: 'hidden'
            }}
            onMouseEnter={(e) => {
              if (currentPage !== 'graphs') {
                e.currentTarget.style.backgroundColor = '#1e40af20';
                e.currentTarget.style.color = '#e2e8f0';
              }
            }}
            onMouseLeave={(e) => {
              if (currentPage !== 'graphs') {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#94a3b8';
              }
            }}
          >
            Graphs
          </button>
        </nav>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{
          backgroundColor: '#2d3748',
          padding: '0.5rem 1rem',
          borderRadius: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <img 
            src="/assets/images/solana.png" 
            alt="Solana Logo" 
            style={{ 
              height: '1.25rem',
              width: 'auto'
            }}
          />
          <span style={{ 
            color: '#e2e8f0',
            fontWeight: '500',
            fontSize: '1rem'
          }}>
            ${solPrice.toFixed(2)}
          </span>
      </div>
      <WalletMultiButton />
      </div>
    </div>
  );
};

// Add service worker registration
const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | undefined> => {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      console.log('Service Worker registered:', registration);

      // Wait for the service worker to be ready
      await navigator.serviceWorker.ready;
      console.log('Service Worker is ready');

      return registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  }
  return undefined;
};

const AppContent: React.FC<{ onRpcError: () => void; currentEndpoint: string }> = ({ onRpcError, currentEndpoint }) => {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [expandedStrategy, setExpandedStrategy] = useState<string | null>(null);
  const [isActiveLackeysExpanded, setIsActiveLackeysExpanded] = useState(true);
  const [isTradingWalletsExpanded, setIsTradingWalletsExpanded] = useState(true);
  const [solPrice, setSolPrice] = useState<number>(0);
  const [selectedToken, setSelectedToken] = useState<SelectedToken | null>(null);
  const wallet = useWallet();
  const { connection } = useConnection();
  const jobManagerRef = useRef<JobManager | null>(null);
  const [tradingWallets, setTradingWallets] = useState<TradingWallet[]>([]);
  const [selectedTradingWallet, setSelectedTradingWallet] = useState<TradingWallet | null>(null);
  const [expandedWalletId, setExpandedWalletId] = useState<string | 'all' | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState<string | null>(null);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [tradingWalletBalances, setTradingWalletBalances] = useState<Record<string, number>>({});
  const [monitoredWallet, setMonitoredWallet] = useState('');
  const [isValidAddress, setIsValidAddress] = useState(false);
  const [autoTradePercentage, setAutoTradePercentage] = useState(10);
  const [jobs, setJobs] = useState<AnyJob[]>([]);
  const [targetPrice, setTargetPrice] = useState(0);
  const [priceDirection, setPriceDirection] = useState<'above' | 'below'>('above');
  const [sellPercentage, setSellPercentage] = useState(10);
  const [jupiterInitialized, setJupiterInitialized] = useState(false);
  const [jupiterError, setJupiterError] = useState<string | null>(null);
  const [vaultPercentage, setVaultPercentage] = useState(10);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [fundingWallet, setFundingWallet] = useState<TradingWallet | null>(null);
  const [fundingAmount, setFundingAmount] = useState('');
  // Add state for success message
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const successMessageTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Add pausedJobs state
  const [pausedJobs, setPausedJobs] = useState<Set<string>>(new Set());
  // Add state for levels
  const [levels, setLevels] = useState<Level[]>([]);
  const [newLevelPrice, setNewLevelPrice] = useState(0);
  const [newLevelPercentage, setNewLevelPercentage] = useState(0);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Add service worker reference
  const serviceWorkerRef = useRef<ServiceWorkerRegistration | null>(null);
  const [showWalletLimitDialog, setShowWalletLimitDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [walletToDelete, setWalletToDelete] = useState<TradingWallet | null>(null);

  // Add state for wallet name editing
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
  const [editedWalletName, setEditedWalletName] = useState('');

  // Add state for search and sort
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [existingJobId, setExistingJobId] = useState<string | null>(null);

  // Add function to handle wallet name save
  const handleWalletNameSave = (jobId: string) => {
    const updatedJobs = jobs.map(j => {
      if (j.id === jobId) {
        return {
          ...j,
          name: editedWalletName.trim() || undefined
        };
      }
      return j;
    });
    setJobs(updatedJobs);
    setEditingWalletId(null);
    
    // Save to localStorage
    localStorage.setItem('jobs', JSON.stringify(updatedJobs));
  };

  // Add function to handle wallet name edit start
  const startWalletNameEdit = (jobId: string, currentName: string = '') => {
    setEditingWalletId(jobId);
    setEditedWalletName(currentName);
  };

  // Add function to handle wallet name edit cancel
  const cancelWalletNameEdit = () => {
    setEditingWalletId(null);
    setEditedWalletName('');
  };

  // Register service worker on mount
  useEffect(() => {
    registerServiceWorker().then(registration => {
      if (registration) {
        serviceWorkerRef.current = registration;
      }
    });
  }, []);

  // Sync jobs with service worker when they change
  useEffect(() => {
    if (serviceWorkerRef.current?.active && jobs.length > 0) {
      serviceWorkerRef.current.active.postMessage({
        type: 'SYNC_JOBS',
        data: { jobs }
      });
    }
  }, [jobs]);

  // Load trading wallets when main wallet connects
  useEffect(() => {
    if (wallet.publicKey) {
      const storedWallets = localStorage.getItem('tradingWallets');
      if (storedWallets) {
        const allWallets: StoredTradingWallets = JSON.parse(storedWallets);
        const userWallets = allWallets[wallet.publicKey.toString()] || [];
        setTradingWallets(userWallets);
        // Auto-select the most recently created wallet if none selected
        if (!selectedTradingWallet && userWallets.length > 0) {
          setSelectedTradingWallet(userWallets[userWallets.length - 1]);
        }
      }
    }
  }, [wallet.publicKey]);

  // Load jobs from localStorage when wallet connects
  useEffect(() => {
    if (wallet.publicKey) {
      const storedJobs = localStorage.getItem(`jobs_${wallet.publicKey.toString()}`);
      if (storedJobs) {
        const parsedJobs = JSON.parse(storedJobs);
        setJobs(parsedJobs);
      }
    }
  }, [wallet.publicKey]);

  // Save jobs to localStorage whenever they change
  useEffect(() => {
    if (wallet.publicKey && jobs.length > 0) {
      localStorage.setItem(`jobs_${wallet.publicKey.toString()}`, JSON.stringify(jobs));
    }
  }, [jobs, wallet.publicKey]);

  // Add effect to set default withdraw address
  useEffect(() => {
    if (wallet.publicKey) {
      setWithdrawAddress(wallet.publicKey.toString());
    }
  }, [wallet.publicKey]);

  const saveTradingWallet = async (newWallet: TradingWallet) => {
    if (!wallet.publicKey) return;
    
    // Save to localStorage
    const storedWallets = localStorage.getItem('tradingWallets');
    const allWallets: StoredTradingWallets = storedWallets ? JSON.parse(storedWallets) : {};
    const ownerAddress = wallet.publicKey.toString();
    
    allWallets[ownerAddress] = [...(allWallets[ownerAddress] || []), {
      ...newWallet,
      createdAt: Date.now()
    }];
    
    localStorage.setItem('tradingWallets', JSON.stringify(allWallets));
    setTradingWallets(allWallets[ownerAddress]);
    setSelectedTradingWallet(newWallet);  // Auto-select newly created wallet

    // Save to database
    try {
      const pool = getDatabasePool();
      const tradingWalletService = new TradingWalletService(pool);
      await tradingWalletService.saveTradingWallet(ownerAddress, newWallet);
    } catch (error) {
      console.error('Error saving trading wallet to database:', error);
      // Don't throw the error - we still want to keep the wallet in localStorage
    }
  };

  const generateTradingWallet = () => {
    if (tradingWallets.length >= 3) {
      setShowWalletLimitDialog(true);
      return;
    }

    const keypair = Keypair.generate();
    const newWallet: TradingWallet = {
      publicKey: keypair.publicKey.toString(),
      secretKey: Array.from(keypair.secretKey),
      mnemonic: Buffer.from(keypair.secretKey).toString('hex'),
      createdAt: Date.now()
    };
    saveTradingWallet(newWallet);
  };

  // fetch Backend Balances - Add this helper function
  const fetchBackendBalances = async (walletAddress: string) => {
    try {
      console.log('Fetching balances from backend for:', walletAddress);
      const response = await fetch(`http://localhost:3001/api/wallet/${walletAddress}/balances`);
      if (!response.ok) {
        throw new Error(`Backend error: ${response.statusText}`);
      }
      const data = await response.json();
      console.log('Backend balances:', JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('Error fetching from backend:', error);
      return null;
    }
  };

  // Update fetchTradingWalletBalance to fetch all balances
  const fetchTradingWalletBalances = async () => {
    if (!connection) return;
    
    const newBalances: Record<string, number> = {};
    for (const tw of tradingWallets) {
      try {
        // Make parallel calls to both implementations
        const [balance, backendBalances] = await Promise.all([
          connection.getBalance(new PublicKey(tw.publicKey)),
          fetchBackendBalances(tw.publicKey)
        ]);
        
        
        newBalances[tw.publicKey] = balance / 1e9; // Convert lamports to SOL
      } catch (error) {
        console.error('Error fetching balance for wallet:', tw.publicKey, error);
        newBalances[tw.publicKey] = 0;
      }
    }
    setTradingWalletBalances(newBalances);
  };

  // Update the balance fetch effect
  useEffect(() => {
    if (tradingWallets.length === 0) return;
    
    fetchTradingWalletBalances();
    const interval = setInterval(fetchTradingWalletBalances, 30000);
    
    return () => clearInterval(interval);
  }, [tradingWallets, connection]);

  // Add effect to listen for balance updates
  useEffect(() => {
    const handleBalanceUpdate = () => {
      fetchTradingWalletBalances();
    };

    window.addEventListener('update-balances', handleBalanceUpdate);
    
    return () => {
      window.removeEventListener('update-balances', handleBalanceUpdate);
    };
  }, []);

  // Trading wallet selection UI
  const renderTradingWalletSelector = () => (
    <div style={{
      backgroundColor: '#1e293b',
      padding: '1.25rem',
      borderRadius: '0.75rem',
      border: '1px solid #2d3748',
      marginBottom: '1rem',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
    }}>
      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          cursor: 'pointer',
          userSelect: 'none'
        }}
        onClick={() => setIsTradingWalletsExpanded(!isTradingWalletsExpanded)}
      >
      <div style={{
          backgroundColor: '#4b5563',
          padding: '0.5rem',
          borderRadius: '0.5rem',
          width: '1.875rem',
          height: '1.875rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.875rem'
      }}>
        <TradingWalletIcon />
      </div>
        <div style={{ flex: 1 }}>
        <h3 style={{ 
          color: '#e2e8f0', 
          margin: 0,
            fontSize: '0.9375rem'
          }}>
            Trading Wallets
            <span style={{ 
              backgroundColor: '#2563eb',
              color: 'white',
              padding: '0.25rem 0.75rem',
              borderRadius: '1rem',
              fontSize: '0.75rem',
              marginLeft: '0.5rem'
            }}>{tradingWallets.length}</span>
          </h3>
          {!isTradingWalletsExpanded && (
            <p style={{ 
              color: '#94a3b8',
              margin: '0.1875rem 0 0 0',
              fontSize: '0.75rem'
            }}>
              Manage your trading wallets and strategies
            </p>
          )}
        </div>
        <svg 
          width="20" 
          height="20" 
          viewBox="0 0 24 24" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
          style={{
            transform: isTradingWalletsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            color: '#94a3b8'
          }}
        >
          <path d="M19 9L12 16L5 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      <div
        style={{
          maxHeight: isTradingWalletsExpanded ? '1000px' : '0',
          opacity: isTradingWalletsExpanded ? 1 : 0,
          overflow: isTradingWalletsExpanded ? 'visible' : 'hidden', // Allow overflow when expanded
          transition: 'all 0.3s ease-in-out',
          position: 'relative', // Establish a new stacking context
          zIndex: 1 // Ensure content appears above other elements
        }}
      >
        <div style={{ 
          marginTop: '1rem',
          position: 'relative' // Establish a new stacking context for child elements
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem'
          }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => {
              const isAnyWalletExpanded = expandedWalletId === 'all' || tradingWallets.some(w => w.publicKey === expandedWalletId);
              setExpandedWalletId(isAnyWalletExpanded ? null : 'all');
              setShowPrivateKey(null);
            }}
            disabled={!wallet.connected || tradingWallets.length === 0}
            style={{ 
              fontSize: '0.75rem',
              backgroundColor: expandedWalletId === 'all' ? '#1e40af' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              padding: '0.5rem 0.75rem',
              cursor: (!wallet.connected || tradingWallets.length === 0) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease-in-out',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
              opacity: (!wallet.connected || tradingWallets.length === 0) ? '0.6' : '1'
            }}
          >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d={expandedWalletId === 'all' ? "M5 15L12 8L19 15" : "M5 9L12 16L19 9"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>{expandedWalletId === 'all' ? 'Collapse All' : 'Expand All'}</span>
          </button>
          <button
                onClick={() => setIsExportModalOpen(true)}
                disabled={!wallet.connected || tradingWallets.length === 0}
            style={{ 
              fontSize: '0.75rem',
              backgroundColor: '#4b5563',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              padding: '0.5rem 0.75rem',
                  cursor: (!wallet.connected || tradingWallets.length === 0) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease-in-out',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
                  opacity: (!wallet.connected || tradingWallets.length === 0) ? '0.6' : '1'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 20V8M12 8L7 13M12 8L17 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M5 4H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
                <span>Export</span>
          </button>
          <button
                onClick={() => setIsImportModalOpen(true)}
                disabled={!wallet.connected}
            style={{ 
              fontSize: '0.75rem',
              backgroundColor: '#4b5563',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              padding: '0.5rem 0.75rem',
                  cursor: !wallet.connected ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease-in-out',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
                  opacity: !wallet.connected ? '0.6' : '1'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 4V16M12 16L7 11M12 16L17 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M5 20H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
                <span>Import</span>
          </button>
          <button
            onClick={generateTradingWallet}
            disabled={!wallet.connected}
            style={{ 
              fontSize: '0.75rem',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              padding: '0.5rem 0.75rem',
              cursor: !wallet.connected ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease-in-out',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
              opacity: !wallet.connected ? '0.6' : '1',
              fontWeight: '500'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 5V19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>New Wallet</span>
          </button>
        </div>
      </div>

      {tradingWallets.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          {tradingWallets.map((tw, index) => (
            <div key={tw.publicKey}>
              <div 
                className={`${styles.walletItem} ${selectedTradingWallet?.publicKey === tw.publicKey ? styles.active : ''}`}
                onClick={() => setSelectedTradingWallet(tw)}
                onDoubleClick={() => {
                  setExpandedWalletId(expandedWalletId === tw.publicKey ? null : tw.publicKey);
                  setShowPrivateKey(null);
                }}
              >
                <div style={{ color: '#e2e8f0', flex: 1 }}>
                  {/* Wallet name and edit icon */}
                  <div style={{ 
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    position: 'relative',
                    minWidth: '180px'
                  }}>
                    {isEditing === tw.publicKey ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => {
                          updateWalletName(tw.publicKey, editingName);
                          setIsEditing(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            updateWalletName(tw.publicKey, editingName);
                            setIsEditing(null);
                          }
                        }}
                        autoFocus
                        style={{
                          background: 'none',
                          border: 'none',
                          borderBottom: '1px solid #3b82f6',
                          color: '#e2e8f0',
                          fontSize: '0.875rem',
                          padding: '0.25rem',
                          outline: 'none',
                          width: '150px'
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div 
                        style={{ position: 'relative', display: 'inline-block' }}
                        className="wallet-name-container"
                        onMouseOver={() => {
                          const editIcon = document.querySelector(`#edit-icon-${tw.publicKey}`) as HTMLElement;
                          if (editIcon) editIcon.style.opacity = '0.6';
                        }}
                        onMouseOut={() => {
                          const editIcon = document.querySelector(`#edit-icon-${tw.publicKey}`) as HTMLElement;
                          if (editIcon) editIcon.style.opacity = '0';
                        }}
                      >
                        <span>{tw.name || `Trading Wallet ${index + 1}`}</span>
                        <button
                          id={`edit-icon-${tw.publicKey}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsEditing(tw.publicKey);
                            setEditingName(tw.name || `Trading Wallet ${index + 1}`);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: '0',
                            marginLeft: '4px',
                            cursor: 'pointer',
                            color: '#94a3b8',
                            opacity: '0',
                            fontSize: '0.7rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            transition: 'opacity 0.2s ease',
                            position: 'absolute',
                            top: '0',
                            right: '-16px'
                          }}
                        >
                          ✎
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* Wallet address */}
                  <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                    {tw.publicKey.slice(0, 4)}...{tw.publicKey.slice(-4)}
                  </div>
                  
                  {/* Token balances */}
                  <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                    <TokenBalancesList 
                      walletAddress={tw.publicKey} 
                      connection={connection}
                      tradingWallet={tw}
                      displayMode="total-only"
                      onRpcError={onRpcError}
                    />
                  </div>
                </div>
                
                {/* Strategy badges */}
                <div className={styles.strategyBadgesContainer}>
                  {jobs.filter(job => job.tradingWalletPublicKey === tw.publicKey && job.isActive).map((job) => {
                    const isPaused = pausedJobs.has(job.id);
                    
                    // Get strategy details based on job type
                    const getStrategyDetails = () => {
                      switch (job.type) {
                        case JobType.WALLET_MONITOR:
                          const monitorJob = job as WalletMonitoringJob;
                          return {
                            title: `Wallet Monitor${monitorJob.name ? ` - ${monitorJob.name}` : ''}`,
                            details: [
                              `Monitoring: ${monitorJob.walletAddress.slice(0, 4)}...${monitorJob.walletAddress.slice(-4)}`,
                              `Mirror: ${monitorJob.percentage}% of balance`
                            ]
                          };
                        case JobType.PRICE_MONITOR:
                          const priceJob = job as PriceMonitoringJob;
                          return {
                            title: 'Price Monitor',
                            details: [
                                  `Target: $${priceJob.targetPrice} (${priceJob.direction === 'above' ? 'Sell Limit' : 'Stop Loss'})`,
                              `Sell: ${priceJob.percentageToSell}% of SOL`,
                              priceJob.lastActivity ? `Last Activity: ${new Date(priceJob.lastActivity).toLocaleString()}` : null,
                              priceJob.lastTriggerPrice ? `Last Trigger: $${priceJob.lastTriggerPrice}` : null
                            ].filter(Boolean)
                          };
                        case JobType.VAULT:
                          const vaultJob = job as VaultStrategy;
                          return {
                            title: 'Vault Strategy',
                            details: [`Vault: ${vaultJob.vaultPercentage}% of trades`]
                          };
                        case JobType.LEVELS:
                          const levelsJob = job as LevelsStrategy;
                          return {
                            title: 'Levels',
                            details: [
                              `${levelsJob.levels.length} Level${levelsJob.levels.length !== 1 ? 's' : ''} Set`,
                              levelsJob.levels.map(level => `$${level.price}: ${level.percentage}%`).join(', '),
                              levelsJob.lastActivity ? `Last Activity: ${new Date(levelsJob.lastActivity).toLocaleString()}` : null,
                              levelsJob.lastTriggerPrice ? `Last Trigger: $${levelsJob.lastTriggerPrice}` : null
                            ].filter(Boolean)
                          };
                        default:
                          return {
                            title: 'Unknown Strategy',
                            details: []
                          };
                      }
                    };

                    const strategyInfo = getStrategyDetails();

                    return (
                      <div 
                        key={job.id}
                        className={`${styles.strategyBadge} ${isPaused ? styles.strategyBadgePaused : ''}`}
                      >
                        <span role="img" aria-label="Active Strategy" style={{ fontSize: '0.75rem', opacity: isPaused ? 0.7 : 1 }}>
                          {job.type === JobType.WALLET_MONITOR ? (
                            <WalletMonitorIcon
                              isActive={job.isActive && !pausedJobs.has(job.id)}
                              onClick={() => toggleJobPause(job.id)}
                            />
                          ) : job.type === JobType.PRICE_MONITOR ? (
                            <PriceMonitorIcon
                              isActive={job.isActive && !pausedJobs.has(job.id)}
                              onClick={() => toggleJobPause(job.id)}
                            />
                          ) : job.type === JobType.VAULT ? (
                            <VaultIcon
                              isActive={job.isActive && !pausedJobs.has(job.id)}
                              onClick={() => toggleJobPause(job.id)}
                            />
                          ) : job.type === JobType.LEVELS ? (
                            <LevelsIcon
                              isActive={job.isActive && !pausedJobs.has(job.id)}
                              onClick={() => toggleJobPause(job.id)}
                            />
                          ) : '❓'}
                        </span>
                        {job.profitTracking && (
                          <span style={{
                            color: job.profitTracking.currentProfit >= 0 ? '#22c55e' : '#ef4444',
                            fontSize: '0.75rem',
                            fontWeight: '500',
                            marginLeft: '0.25rem'
                          }}>
                            {job.profitTracking.currentProfit > 0 ? '+' : ''}
                            {job.profitTracking.currentProfit.toFixed(2)}%
                          </span>
                        )}
                        <div className={styles.strategyMenu}>
                          <div className={styles.strategyMenuHeader}>
                            {strategyInfo.title}
                            {job.profitTracking && (
                              <div style={{
                                fontSize: '0.75rem',
                                color: job.profitTracking.currentProfit >= 0 ? '#22c55e' : '#ef4444',
                                marginTop: '0.25rem'
                              }}>
                                Profit/Loss: {job.profitTracking.currentProfit > 0 ? '+' : ''}
                                {job.profitTracking.currentProfit.toFixed(2)}%
                                {job.profitTracking.trades.length > 0 && (
                                  <span style={{ 
                                    fontSize: '0.625rem',
                                    backgroundColor: job.profitTracking.currentProfit >= 0 ? '#15803d' : '#991b1b',
                                    padding: '0.125rem 0.25rem',
                                    borderRadius: '0.25rem',
                                    marginLeft: '0.5rem'
                                  }}>
                                    {job.profitTracking.trades.length} {job.profitTracking.trades.length === 1 ? 'trade' : 'trades'}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className={styles.strategyMenuDetails}>
                            {strategyInfo.details.map((detail, index) => (
                              <div key={index} className={styles.strategyMenuDetail}>{detail}</div>
                            ))}
                          </div>
                          <div className={styles.strategyMenuDivider} />
                          <button 
                            className={styles.strategyMenuButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleJobPause(job.id);
                            }}
                          >
                            {isPaused ? (
                              <>
                                <span role="img" aria-label="Resume">▶️</span>
                                Resume
                              </>
                            ) : (
                              <>
                                <span role="img" aria-label="Pause">⏸️</span>
                                Pause
                              </>
                            )}
                          </button>
                          <button 
                            className={`${styles.strategyMenuButton} ${styles.strategyMenuButtonDanger}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm('Are you sure you want to delete this strategy?')) {
                                deleteJob(job.id);
                              }
                            }}
                          >
                            <span role="img" aria-label="Delete">🗑️</span>
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  
                  {/* Fund button and menu button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginLeft: 'auto' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const amount = prompt('Enter amount in SOL to fund wallet:');
                        if (amount && !isNaN(parseFloat(amount))) {
                          fundWallet(tw, parseFloat(amount));
                        }
                      }}
                      className={`${styles.button} ${styles.primary}`}
                    >
                      Fund
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedWalletId(expandedWalletId === tw.publicKey ? null : tw.publicKey);
                        setShowPrivateKey(null);
                      }}
                      className={styles.menuButton}
                    >
                      ☰
                    </button>
                  </div>
                </div>
              </div>

              {/* Expanded wallet details with token balances */}
              {(expandedWalletId === 'all' || expandedWalletId === tw.publicKey) && (
                <div style={{
                  padding: '0.75rem',
                  backgroundColor: '#2d3748',
                  borderRadius: '0.375rem',
                  marginTop: '0.375rem',
                  fontSize: '0.75rem',
                  border: '1px solid #4b5563'
                }}>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ color: '#94a3b8', marginBottom: '0.25rem' }}>Public Key:</div>
                    <div style={{ 
                      color: '#e2e8f0',
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      backgroundColor: '#1e293b',
                      padding: '0.5rem',
                      borderRadius: '0.25rem',
                      fontSize: '0.75rem'
                    }}>
                      {tw.publicKey}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '0.75rem' }}>
                    <button
                      onClick={() => {
                        setFundingWallet(tw);
                        setFundingAmount('');
                      }}
                      className={styles.button}
                    >
                      Fund Wallet
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(tw.publicKey)}
                      className={styles.button}
                    >
                      Copy Public Key
                    </button>
                    <button
                      onClick={() => setShowPrivateKey(showPrivateKey === tw.publicKey ? null : tw.publicKey)}
                      className={`${styles.button} ${showPrivateKey === tw.publicKey ? styles.danger : ''}`}
                    >
                      {showPrivateKey === tw.publicKey ? 'Hide Private Key' : 'Show Private Key'}
                    </button>
                    <button
                      onClick={async () => {
                        if (!wallet.publicKey || !connection) return;
                        const balance = await connection.getBalance(new PublicKey(tw.publicKey));
                        const transaction = new VersionedTransaction(
                          new TransactionMessage({
                            payerKey: new PublicKey(tw.publicKey),
                            recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
                            instructions: [
                              SystemProgram.transfer({
                                fromPubkey: new PublicKey(tw.publicKey),
                                toPubkey: wallet.publicKey,
                                lamports: balance - 5000 // Leave 5000 lamports for rent
                              })
                            ]
                          }).compileToV0Message()
                        );
                        
                        const tradingKeypair = Keypair.fromSecretKey(new Uint8Array(tw.secretKey));
                        transaction.sign([tradingKeypair]);
                        const signature = await connection.sendTransaction(transaction);
                        await connection.confirmTransaction(signature);
                        fetchTradingWalletBalances();
                        window.dispatchEvent(new Event('update-balances'));
                      }}
                      className={styles.button}
                    >
                      Return All SOL To Main Wallet
                    </button>
                    <button
                      onClick={() => {
                        handleDeleteWallet(tw);
                      }}
                      className={`${styles.button} ${styles.danger}`}
                      style={{ marginLeft: 'auto' }}
                    >
                      Delete Wallet
                    </button>
                  </div>

                  {showPrivateKey === tw.publicKey && (
                    <div>
                      <div style={{ 
                        color: '#dc2626', 
                        marginBottom: '0.5rem', 
                        fontSize: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem'
                      }}>
                        ⚠️ Never share your private key
                      </div>
                      <div style={{
                        backgroundColor: '#1e293b',
                        padding: '0.5rem',
                        borderRadius: '0.25rem',
                        color: '#e2e8f0',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        marginBottom: '0.5rem',
                        fontSize: '0.75rem',
                        border: '1px solid #4b5563'
                      }}>
                        {(() => {
                          const privateKeyStr = localStorage.getItem(`wallet_${tw.publicKey}`);
                          if (!privateKeyStr) return '';
                          const privateKeyBytes = new Uint8Array(JSON.parse(privateKeyStr));
                          return bs58.encode(privateKeyBytes);
                        })()}
                      </div>
                      <button
                        onClick={() => {
                          const privateKeyStr = localStorage.getItem(`wallet_${tw.publicKey}`);
                          if (!privateKeyStr) return;
                          const privateKeyBytes = new Uint8Array(JSON.parse(privateKeyStr));
                          navigator.clipboard.writeText(bs58.encode(privateKeyBytes));
                        }}
                        className={styles.button}
                      >
                        Copy Private Key
                      </button>
                    </div>
                  )}

                  {/* Token Balances */}
                  <div style={{ marginTop: '1rem' }}>
                    <div style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>Token Balances:</div>
                    <TokenBalancesList 
                      walletAddress={tw.publicKey} 
                      connection={connection} 
                      tradingWallet={tw}  // Pass the trading wallet
                      onRpcError={onRpcError}  // Pass the onRpcError function
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
          ) : (
            <div style={{ 
              textAlign: 'center', 
              color: '#94a3b8', 
              padding: '2rem 0',
              fontSize: '0.875rem'
            }}>
              No trading wallets created yet. Click "New Wallet" to create one.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Function to withdraw SOL
  const handleWithdraw = async () => {
    if (!selectedTradingWallet || !withdrawAddress || !withdrawAmount) return;

    try {
      const withdrawPubkey = new PublicKey(withdrawAddress);
      const tradingKeypair = Keypair.fromSecretKey(new Uint8Array(selectedTradingWallet.secretKey));
      
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: tradingKeypair.publicKey,
          recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: tradingKeypair.publicKey,
              toPubkey: withdrawPubkey,
              lamports: Math.floor(parseFloat(withdrawAmount) * 1e9)
            })
          ]
        }).compileToV0Message()
      );

      transaction.sign([tradingKeypair]);
      
      const signature = await connection.sendTransaction(transaction);
      console.log('Withdrawal sent:', signature);
      
      // Wait for confirmation
      await connection.confirmTransaction(signature);
      console.log('Withdrawal confirmed');
      
      // Refresh balance
      fetchTradingWalletBalances();
      
      // Clear inputs
      setWithdrawAddress('');
      setWithdrawAmount('');
    } catch (error) {
      console.error('Error withdrawing:', error);
    }
  };

  // Handle monitored wallet input change
  const handleWalletInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setMonitoredWallet(value);
    
    try {
      // Check if it's a valid Solana address
      new PublicKey(value);
      
      // Check if the entered wallet is a trading wallet
      const isTradingWallet = tradingWallets.some(tw => tw.publicKey === value);
      if (isTradingWallet) {
        setNotification({
          message: 'You cannot monitor a trading wallet. Please enter a different wallet address.',
          type: 'error'
        });
        setIsValidAddress(false);
        return;
      }
      
      setIsValidAddress(true);
    } catch (error) {
      setIsValidAddress(false);
    }
  };

  // Handle auto-trade percentage change
  const handleAutoTradeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value) || 1;
    setAutoTradePercentage(Math.min(100, Math.max(1, value)));
  };

  // Initialize JobManager when wallet connects
  useEffect(() => {
    if (wallet.publicKey && selectedTradingWallet) {
      jobManagerRef.current = new JobManager(
        currentEndpoint,
        new PublicKey(selectedTradingWallet.publicKey)
      );
      
      // Start any existing jobs
      jobs.forEach(async (job) => {
        if (job.isActive) {
          await jobManagerRef.current?.addJob(job);
        }
      });
    }
    
    return () => {
      jobManagerRef.current?.stopAll();
    };
  }, [wallet.publicKey, currentEndpoint, selectedTradingWallet]);

  // Update createJob function to include tradingWalletSecretKey
  const createJob = async () => {
    if (!selectedTradingWallet || !monitoredWallet || !isValidAddress) return;

    try {
      // Prevent monitoring the trading wallet itself
      if (selectedTradingWallet.publicKey === monitoredWallet) {
        setNotification({
          message: 'A trading wallet cannot monitor itself. Please select a different wallet to monitor.',
          type: 'error'
        });
        return;
      }

      // Check if this trading wallet already has a monitoring job for this public wallet
      const existingJob = jobs.find(job => 
        job.type === JobType.WALLET_MONITOR && 
        job.tradingWalletPublicKey === selectedTradingWallet.publicKey &&
        (job as WalletMonitoringJob).walletAddress === monitoredWallet &&
        job.isActive
      );

      if (existingJob) {
        setExistingJobId(existingJob.id);
        setIsOverrideModalOpen(true);
        return;
      }

      const secretKeyArray = ensureUint8Array(selectedTradingWallet.secretKey);
      const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;

      const newJob: WalletMonitoringJob = {
        id: Date.now().toString(),
        type: JobType.WALLET_MONITOR,
        isActive: true,
        walletAddress: monitoredWallet,
        tradingWalletPublicKey: selectedTradingWallet.publicKey,
        tradingWalletSecretKey: secretKeyArray,
        percentage: autoTradePercentage,
        mirroredTokens: {},
        createdAt: new Date().toISOString(),
        profitTracking: createInitialProfitTracking(initialBalance, solPrice)
      };

      setJobs(prevJobs => [...prevJobs, newJob]);
      setMonitoredWallet('');
      setAutoTradePercentage(10);

      setNotification({
        message: 'Lackey created successfully',
        type: 'success'
      });
    } catch (error) {
      console.error('Error creating job:', error);
      setNotification({
        message: 'Failed to create Lackey',
        type: 'error'
      });
    }
  };

  const handleOverrideConfirm = async () => {
    if (!existingJobId || !selectedTradingWallet || !monitoredWallet || !isValidAddress) return;

    try {
      // Remove the existing job
      setJobs(prevJobs => prevJobs.filter(job => job.id !== existingJobId));
      
      // Create the new job immediately
      const secretKeyArray = ensureUint8Array(selectedTradingWallet.secretKey);
      const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;

      const newJob: WalletMonitoringJob = {
        id: Date.now().toString(),
        type: JobType.WALLET_MONITOR,
        isActive: true,
        walletAddress: monitoredWallet,
        tradingWalletPublicKey: selectedTradingWallet.publicKey,
        tradingWalletSecretKey: secretKeyArray,
        percentage: autoTradePercentage,
        mirroredTokens: {},
        createdAt: new Date().toISOString(),
        profitTracking: createInitialProfitTracking(initialBalance, solPrice)
      };

      setJobs(prevJobs => [...prevJobs, newJob]);
      setMonitoredWallet('');
      setAutoTradePercentage(10);

      // Close the modal and reset state
      setIsOverrideModalOpen(false);
      setExistingJobId(null);

      setNotification({
        message: 'Lackey overridden successfully',
        type: 'success'
      });
    } catch (error) {
      console.error('Error overriding job:', error);
      setNotification({
        message: 'Failed to override Lackey',
        type: 'error'
      });
    }
  };

  // Add function to toggle job status
  const toggleJob = async (jobId: string) => {
    setJobs(prevJobs => {
      const updatedJobs = prevJobs.map(job => 
        job.id === jobId ? { ...job, isActive: !job.isActive } : job
      );
      
      const job = updatedJobs.find(j => j.id === jobId);
      if (job && jobManagerRef.current) {
        jobManagerRef.current.toggleJob(jobId, job.isActive);
        
        // Notify service worker
        serviceWorkerRef.current?.active?.postMessage({
          type: 'UPDATE_JOB',
          data: { job }
        });
      }
      
      return updatedJobs;
    });
  };

  // Add function to remove job
  const removeJob = async (jobId: string) => {
    if (jobManagerRef.current) {
      await jobManagerRef.current.removeJob(jobId);
    }
    setJobs(prevJobs => prevJobs.filter(job => job.id !== jobId));
    
    // Notify service worker
    serviceWorkerRef.current?.active?.postMessage({
      type: 'REMOVE_JOB',
      data: { jobId }
    });
  };

  // Add transaction execution handler
  useEffect(() => {
    console.log('Connection state:', {
      connected: connection !== null,
      endpoint: connection?.rpcEndpoint
    });

    const handleTransaction = async (event: any) => {
      const { transaction, lastValidBlockHeight, computeUnitLimit, prioritizationFeeLamports, walletAddress, onSuccess } = event.detail;
      
      console.log('Transaction event received:', {
        walletAddress,
        hasTransaction: !!transaction,
        lastValidBlockHeight
      });

      if (!transaction) {
        console.error('No transaction provided');
            return;
          }

      try {
          console.log('Deserializing transaction...');
        const tx = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
        
        // Get the trading wallet for this monitored wallet
        const job = jobs.find(j => 
          j.type === JobType.WALLET_MONITOR && 
          (j as WalletMonitoringJob).walletAddress === walletAddress
        ) as WalletMonitoringJob | undefined;

        if (!job) {
          throw new Error('Trading wallet not found for address: ' + walletAddress);
        }

        // Find the trading wallet with the secret key
        const tradingWallet = tradingWallets.find(tw => 
          tw.publicKey === job.tradingWalletPublicKey
        );

        if (!tradingWallet) {
          throw new Error('Trading wallet details not found');
        }

        console.log('Creating keypair from trading wallet...');
        const tradingKeypair = Keypair.fromSecretKey(
          ensureUint8Array(tradingWallet.secretKey)
        );

          console.log('Signing transaction...');
        tx.sign([tradingKeypair]);

          console.log('Sending transaction...');
        const signature = await connection.sendTransaction(tx, {
            maxRetries: 5,
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          });
          
          console.log('Transaction sent:', signature);
          
        // Wait for confirmation with retry
        let retryCount = 0;
        while (retryCount < 3) {
          try {
            const confirmation = await connection.confirmTransaction(signature);
          if (confirmation.value.err) {
              throw new Error('Transaction failed: ' + confirmation.value.err.toString());
            }
            break;
          } catch (error) {
            retryCount++;
            if (retryCount === 3) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          }
        }

        console.log('Transaction confirmed:', signature);
        
        
        // Update job's last activity
        job.lastActivity = new Date().toISOString();
        setJobs(prevJobs => prevJobs.map(j => j.id === job.id ? job : j));

        // Call onSuccess callback if provided
        if (typeof onSuccess === 'function') {
          onSuccess();
        }

        // Wait a short moment for blockchain state to update
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Refresh balances after successful transaction
        window.dispatchEvent(new CustomEvent('update-balances'));

      } catch (error: any) {
        console.error('Error executing transaction:', {
          message: error.message,
          stack: error.stack,
          type: error.constructor?.name
        });
        throw error;
      }
    };

    console.log('Setting up transaction event listener');
    window.addEventListener('execute-transaction', handleTransaction);
    
    return () => {
      console.log('Removing transaction event listener');
      window.removeEventListener('execute-transaction', handleTransaction);
    };
  }, [connection, jobs, tradingWallets]);

  // Add helper function to get token balance
  const getTokenBalance = async (
    connection: Connection,
    walletAddress: string,
    mintAddress: string
  ): Promise<{ balance: number; decimals: number }> => {
    try {
      const tokenAccounts = await connection.getTokenAccountsByOwner(
        new PublicKey(walletAddress),
        { mint: new PublicKey(mintAddress) }
      );

      if (tokenAccounts.value.length === 0) {
        return { balance: 0, decimals: 0 };
      }

      const accountInfo = await connection.getParsedAccountInfo(tokenAccounts.value[0].pubkey);
      const parsedInfo = accountInfo.value?.data && 'parsed' in accountInfo.value.data 
        ? (accountInfo.value.data.parsed?.info as ParsedTokenInfo)
        : null;

      if (parsedInfo && 'tokenAmount' in parsedInfo) {
        return {
          balance: Number(parsedInfo.tokenAmount.amount),
          decimals: parsedInfo.tokenAmount.decimals
        };
      }
      return { balance: 0, decimals: 0 };
    } catch (error) {
      console.error('Error getting token balance:', error);
      return { balance: 0, decimals: 0 };
    }
  };

  // Function to validate Solana address
  const validateAddress = (address: string) => {
    try {
      new PublicKey(address.trim());
      return true;
    } catch {
      return false;
    }
  };

  // Update fund wallet function to refresh all balances
  const fundWallet = async (tradingWallet: TradingWallet, amount: number) => {
    if (!wallet.publicKey || !connection || !wallet.signTransaction) return;

    try {
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: new PublicKey(tradingWallet.publicKey),
              lamports: amount * LAMPORTS_PER_SOL
            })
          ]
        }).compileToV0Message()
      );

      const signed = await wallet.signTransaction(transaction);
      const signature = await connection.sendTransaction(signed);
      await connection.confirmTransaction(signature);
      window.dispatchEvent(new Event('update-balances'));
      
      // Refresh all balances after funding
      fetchTradingWalletBalances();
    } catch (error) {
      console.error('Error funding wallet:', error);
    }
  };

  // Add toggle function for strategy expansion
  const toggleStrategy = (strategyName: string) => {
    setExpandedStrategy(expandedStrategy === strategyName ? null : strategyName);
  };

  // Add helper function to create initial profit tracking
  const createInitialProfitTracking = (initialBalance: number, currentPrice: number) => ({
    initialBalance,
    currentBalance: initialBalance,
    initialPrice: currentPrice,
    currentPrice,
    currentProfit: 0,
    lastUpdated: new Date().toISOString(),
    history: [],
    trades: []
  });

  // Update createPriceMonitorJob
  const createPriceMonitorJob = async () => {
    if (!selectedTradingWallet || !targetPrice) return;

    const secretKeyArray = new Uint8Array(selectedTradingWallet.secretKey);
    const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;

    const newJob: PriceMonitoringJob = {
      id: Date.now().toString(),
      type: JobType.PRICE_MONITOR,
      tradingWalletPublicKey: selectedTradingWallet.publicKey,
      tradingWalletSecretKey: secretKeyArray,
      targetPrice,
      direction: priceDirection,
      percentageToSell: sellPercentage,
      isActive: true,
      createdAt: new Date().toISOString(),
      profitTracking: createInitialProfitTracking(initialBalance, solPrice)
    };

    setJobs(prevJobs => [...prevJobs, newJob]);
    setTargetPrice(0);
    setPriceDirection('above');
    setSellPercentage(10);
  };

  // Add price monitor removal handler
  useEffect(() => {
    const handlePriceMonitorRemoval = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const { jobId } = event.detail;
      removeJob(jobId);
    };

    window.addEventListener('remove-price-monitor', handlePriceMonitorRemoval);
    
    return () => {
      window.removeEventListener('remove-price-monitor', handlePriceMonitorRemoval);
    };
  }, []);

  // Add price feed subscription
  useEffect(() => {
    const priceFeed = PriceFeedService.getInstance();
    const handlePriceUpdate = (prices: { sol: number }) => {
      setSolPrice(prices.sol);
    };

    priceFeed.on('price_update', handlePriceUpdate);
    priceFeed.start();

    return () => {
      priceFeed.removeListener('price_update', handlePriceUpdate);
    };
  }, []);

  const JUPITER_TOKEN_LIST_URL = 'https://token.jup.ag/strict';

  interface JupiterToken {
  address: string;
    chainId: number;
    decimals: number;
    name: string;
    symbol: string;
    logoURI?: string;
    tags?: string[];
  }

  const fetchJupiterTokens = async (): Promise<JupiterToken[]> => {
    try {
      const response = await fetch(JUPITER_TOKEN_LIST_URL);
      if (!response.ok) {
        throw new Error('Failed to fetch Jupiter token list');
      }
      const data = await response.json();
      return data.tokens || [];
    } catch (error) {
      console.error('Error fetching Jupiter tokens:', error);
      return [];
    }
  };

  // Update the initJupiter function
  const initJupiter = async () => {
    try {
      // Fetch tokens dynamically
      const tokens = await fetchJupiterTokens();
      console.log(`Loaded ${tokens.length} tokens from Jupiter API`);

      const config: JupiterConfig = {
        endpoint: currentEndpoint,
        displayMode: 'integrated',
        integratedTargetId: 'integrated-terminal',
        defaultExplorer: 'Solscan',
        wallet: {
          name: 'Trading Wallet',
          url: '',
          connect: async () => {
            if (!selectedTradingWallet) {
              throw new Error('No trading wallet selected');
            }
            const keypair = Keypair.fromSecretKey(new Uint8Array(selectedTradingWallet.secretKey));
            return {
              publicKey: keypair.publicKey,
              signTransaction: async (tx: Transaction) => {
                tx.sign(keypair);
                return tx;
              },
              signAllTransactions: async (txs: Transaction[]) => {
                return txs.map(tx => {
                  tx.sign(keypair);
                  return tx;
                });
              }
            };
          }
        }
      };

      // Initialize Jupiter with dynamic token list
      if (window.Jupiter) {
        window.Jupiter.init(config);
        setJupiterInitialized(true);
        setJupiterError(null);
      }
    } catch (error) {
      console.error('Error initializing Jupiter:', error);
      setJupiterError(error instanceof Error ? error.message : 'Unknown error initializing Jupiter');
    }
  };

  // Update createVaultStrategy
  const createVaultStrategy = async () => {
    if (!selectedTradingWallet || !vaultPercentage) return;

    const secretKeyArray = new Uint8Array(selectedTradingWallet.secretKey);
    const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;

    const newJob: VaultStrategy = {
      id: Date.now().toString(),
      type: JobType.VAULT,
      tradingWalletPublicKey: selectedTradingWallet.publicKey,
      tradingWalletSecretKey: secretKeyArray,
      vaultPercentage,
      isActive: true,
      createdAt: new Date().toISOString(),
      profitTracking: createInitialProfitTracking(initialBalance, solPrice)
    };

    setJobs(prevJobs => [...prevJobs, newJob]);
    setVaultPercentage(10);
  };

  // Export trading wallets
  const handleExportWallets = async (password: string) => {
    if (!wallet.publicKey || tradingWallets.length === 0) {
      setExportError('No trading wallets to export');
      return;
    }

    try {
      setExportError(null);
      const blob = await exportWallets(
        tradingWallets, 
        wallet.publicKey.toString(), 
        password,
        wallet
      );
      
      // Use the File System Access API if available
      if ('showSaveFilePicker' in window) {
        try {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: `lackey-wallets-${new Date().toISOString().split('T')[0]}.json`,
            types: [{
              description: 'JSON Files',
              accept: { 'application/json': ['.json'] }
            }],
          });
          
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          
          setIsExportModalOpen(false);
          setNotification({
            message: 'Wallets exported successfully!',
            type: 'success'
          });
        } catch (error) {
          // User cancelled the save dialog or other error
          if ((error as Error).name !== 'AbortError') {
            throw error;
          }
        }
      } else {
        // Fallback for browsers that don't support the File System Access API
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lackey-wallets-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        
        // Clean up
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 0);
        
        setIsExportModalOpen(false);
        setNotification({
          message: 'Wallets exported successfully!',
          type: 'success'
        });
      }
    } catch (error) {
      console.error('Export error:', error);
      setExportError((error as Error).message || 'Failed to export wallets');
    }
  };

  // Import trading wallets
  const handleImportWallets = async (mergedWallets: TradingWallet[]) => {
    if (!wallet.publicKey) return;

    const ownerAddress = wallet.publicKey.toString();
    
    // Save to localStorage
    localStorage.setItem('tradingWallets', JSON.stringify({
      [ownerAddress]: mergedWallets
    }));
    
    // Update state
    setTradingWallets(mergedWallets);
    
    setNotification({
      message: `Successfully imported ${mergedWallets.length} wallets`,
      type: 'success'
    });
  };

  const handleImportLackeys = async (fileContent: string, password: string) => {
    try {
      const { lackeys, savedWallets, ownerAddress } = await importLackeys(fileContent, password);
      
      // Merge and save lackeys
      const mergedJobs = mergeLackeys(jobs, lackeys);
      setJobs(mergedJobs);
      localStorage.setItem(`jobs_${ownerAddress}`, JSON.stringify(mergedJobs));
      
      // Merge and save wallets
      if (savedWallets && savedWallets.length > 0) {
        handleImportWallets(savedWallets);
      }
      
      setNotification({
        message: 'Successfully imported lackeys and wallets',
        type: 'success'
      });
    } catch (error) {
      console.error('Error importing lackeys:', error);
      setNotification({
        message: 'Failed to import lackeys: ' + (error instanceof Error ? error.message : 'Unknown error'),
        type: 'error'
      });
    }
  };

    // Add a simple function to log all trading wallets with strategies
    useEffect(() => {
      // Log all trading wallets with strategies
      console.log('💰 TRADING WALLETS WITH STRATEGIES:');
      
      jobs.forEach(job => {
        if (job.isActive) {
          console.log(`💰 STRATEGY: Wallet ${job.tradingWalletPublicKey} has a ${job.type} strategy`);
        }
      });
    }, [jobs]);

  // Add a wallet processing queue to avoid overloading RPC
  const walletProcessingQueue: string[] = [];
  let isProcessingWallets = false;
  const walletProcessingTimestamps: Record<string, number> = {}; // Track when each wallet was last processed
  const WALLET_PROCESSING_COOLDOWN = 30000; // 30 seconds between processing the same wallet

  const queueWalletForProcessing = (walletAddress: string) => {
    const now = Date.now();
    const lastProcessed = walletProcessingTimestamps[walletAddress] || 0;
    
    // Skip if this wallet was processed recently
    if (now - lastProcessed < WALLET_PROCESSING_COOLDOWN) {
      log(`Skipping wallet ${walletAddress} - processed too recently`);
      return;
    }
    
    // Add to queue if not already in it
    if (!walletProcessingQueue.includes(walletAddress)) {
      walletProcessingQueue.push(walletAddress);
      log(`Added wallet ${walletAddress} to processing queue`);
    }
    
    // Start processing if not already processing
    if (!isProcessingWallets) {
      processNextWalletInQueue();
    }
  };

  const processNextWalletInQueue = async () => {
    if (walletProcessingQueue.length === 0) {
      isProcessingWallets = false;
      return;
    }
    
    isProcessingWallets = true;
    const walletAddress = walletProcessingQueue.shift()!;
    
    try {
      // Record processing timestamp
      walletProcessingTimestamps[walletAddress] = Date.now();
      
      // Dispatch an event to trigger a background update for this wallet
      window.dispatchEvent(new CustomEvent('process-wallet', { 
        detail: { walletAddress } 
      }));
      
      // Wait before processing the next wallet
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      logError(`Error processing wallet ${walletAddress}:`, error);
    }
    
    // Process next wallet in queue
    processNextWalletInQueue();
  };

  // Queue all trading wallets for background processing on initial load
  useEffect(() => {
    if (tradingWallets.length > 0) {
      log(`Queueing ${tradingWallets.length} wallets for background processing`);
      
      // Stagger the queueing to avoid all wallets being processed at once
      tradingWallets.forEach((wallet, index) => {
        setTimeout(() => {
          queueWalletForProcessing(wallet.publicKey);
        }, index * 1000); // Add a 1-second delay between each wallet
      });
    }
  }, [tradingWallets]);

  // Add job management functions
  const toggleJobPause = (jobId: string) => {
    setPausedJobs(prev => {
      const newPaused = new Set(prev);
      if (newPaused.has(jobId)) {
        newPaused.delete(jobId);
      } else {
        newPaused.add(jobId);
      }
      return newPaused;
    });
  };

  // Update createLevelsStrategy function to include tradingWalletSecretKey
  const createLevelsStrategy = async () => {
    if (!selectedTradingWallet || levels.length === 0) return;

    const secretKeyArray = new Uint8Array(selectedTradingWallet.secretKey);
    const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;

    const newJob: LevelsStrategy = {
      id: Date.now().toString(),
      type: JobType.LEVELS,
      tradingWalletPublicKey: selectedTradingWallet.publicKey,
      tradingWalletSecretKey: secretKeyArray,
      levels,
      isActive: true,
      createdAt: new Date().toISOString(),
      profitTracking: createInitialProfitTracking(initialBalance, solPrice)
    };

    setJobs(prevJobs => [...prevJobs, newJob]);
    setLevels([]);
  };

  // Add deleteJob function before the return statement
  const deleteJob = async (jobId: string) => {
    try {
      // Stop the job in the job manager
      await jobManagerRef.current?.removeJob(jobId);
      
      // Remove from state
      setJobs(prevJobs => prevJobs.filter(job => job.id !== jobId));
      
      // Show success notification
      setNotification({
        message: 'Strategy removed successfully',
        type: 'success'
      });
    } catch (error) {
      console.error('Error deleting job:', error);
      setNotification({
        message: 'Failed to remove strategy',
        type: 'error'
      });
    }
  };

  const updateWalletName = (publicKey: string, newName: string) => {
    const updatedWallets = tradingWallets.map(wallet =>
      wallet.publicKey === publicKey ? { ...wallet, name: newName } : wallet
    );
    
    setTradingWallets(updatedWallets);
    
    // Save to localStorage
    if (wallet && wallet.publicKey) {
      localStorage.setItem('tradingWallets', JSON.stringify({
        ...JSON.parse(localStorage.getItem('tradingWallets') || '{}'),
        [wallet.publicKey.toString()]: updatedWallets
      }));
    }
  };

  // Update the reference in the strategies section
  const renderStrategies = () => {
    if (!selectedTradingWallet) {
      return (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>
          Select a trading wallet to view and manage strategies
        </div>
      );
    }

    return (
      <div>
        {/* ... existing strategy content ... */}
      </div>
    );
  };

  const handleDeleteWallet = (tw: TradingWallet) => {
    setWalletToDelete(tw);
    setShowDeleteDialog(true);
  };

  const confirmDeleteWallet = async () => {
    if (!walletToDelete || !wallet.publicKey) return;

    // Remove the wallet from tradingWallets
    const updatedWallets = tradingWallets.filter(w => w.publicKey !== walletToDelete.publicKey);
    setTradingWallets(updatedWallets);
    
    // Update localStorage
    const storedWallets = localStorage.getItem('tradingWallets');
    const allWallets: StoredTradingWallets = storedWallets ? JSON.parse(storedWallets) : {};
    allWallets[wallet.publicKey.toString()] = updatedWallets;
    localStorage.setItem('tradingWallets', JSON.stringify(allWallets));
    
    // Delete from database
    try {
      const pool = getDatabasePool();
      const tradingWalletService = new TradingWalletService(pool);
      await tradingWalletService.deleteTradingWallet(walletToDelete.publicKey);
    } catch (error) {
      console.error('Error deleting trading wallet from database:', error);
      // Don't throw the error - we still want to remove the wallet from localStorage
    }
    
    // If the deleted wallet was selected, clear the selection or select another wallet
    if (selectedTradingWallet?.publicKey === walletToDelete.publicKey) {
      if (updatedWallets.length > 0) {
        setSelectedTradingWallet(updatedWallets[0]);
      } else {
        setSelectedTradingWallet(null);
      }
    }
    
    // Close the expanded view
    setExpandedWalletId(null);
    
    // Show notification
    setNotification({
      message: 'Wallet deleted successfully',
      type: 'success'
    });

    // Close the dialog
    setShowDeleteDialog(false);
    setWalletToDelete(null);
  };

  // Check for wallet name updates periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const updatedJobs = jobs.map(job => {
        if (job.type === JobType.WALLET_MONITOR && job.isActive) {
          const savedWallet = jobs.find(j => 
            j.type === JobType.WALLET_MONITOR && 
            (j as WalletMonitoringJob).walletAddress === (job as WalletMonitoringJob).walletAddress && 
            !j.isActive
          );
          if (savedWallet && savedWallet.name !== job.name) {
            return { ...job, name: savedWallet.name };
          }
        }
        return job;
      });

      if (JSON.stringify(updatedJobs) !== JSON.stringify(jobs)) {
        setJobs(updatedJobs);
      }
    }, 250); // Check every 0.25 seconds

    return () => clearInterval(interval);
  }, [jobs]);

  // Add effect to check for saved wallets and update monitoring names
  useEffect(() => {
    const checkSavedWallets = () => {
      setJobs(prevJobs => {
        let hasChanges = false;
        const updatedJobs = prevJobs.map(job => {
          if (job.type === JobType.WALLET_MONITOR) {
            const monitoredWallet = (job as WalletMonitoringJob).walletAddress;
            // Check if this wallet exists in tradingWallets
            const savedWallet = tradingWallets.find(tw => tw.publicKey === monitoredWallet);
            if (savedWallet?.name && (job as WalletMonitoringJob).name !== savedWallet.name) {
              hasChanges = true;
              return {
                ...job,
                name: savedWallet.name
              };
            }
          }
          return job;
        });
        return hasChanges ? updatedJobs : prevJobs;
      });
    };

    // Run check immediately and then every 250ms
    checkSavedWallets();
    const interval = setInterval(checkSavedWallets, 250);

    return () => clearInterval(interval);
  }, [tradingWallets]);

  const addLevel = () => {
    if (newLevelPrice > 0 && newLevelPercentage > 0) {
      setLevels(prevLevels => [...prevLevels, { price: newLevelPrice, percentage: newLevelPercentage }]);
      setNewLevelPrice(0);
      setNewLevelPercentage(0);
    }
  };

  const removeLevel = (index: number) => {
    setLevels(prevLevels => prevLevels.filter((_, i) => i !== index));
  };

  return (
    <div className={styles.container}>
      <NavigationBar currentPage={currentPage} onPageChange={setCurrentPage} />
      {currentPage === 'dashboard' ? (
        <div style={{ padding: '2rem' }}>
          <div style={{ 
            maxWidth: '1600px', 
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '1fr 400px',
            gap: '2rem'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}> {/* Reduced from 1rem to 0.75rem */}
              {/* Title Section */}
              <div style={{
                marginBottom: '1rem' // Changed from -1.5rem to 1rem to create space below the title
              }}>
                <h2 style={{
                  color: '#60a5fa',
                  fontSize: '1.25rem',
                  fontWeight: '600',
                  margin: 0
                }}>
                  Available Actions
                </h2>
              </div>

              {/* Trading wallet selector */}
              <div style={{ marginTop: '-0.6rem' }}> {/* Added small marginTop for fine-tuning */}
              {renderTradingWalletSelector()}
              </div>

              {/* Active Jobs Section */}
              <div style={{
                backgroundColor: '#1e293b',
                padding: '1.125rem',
                borderRadius: '0.75rem',
                border: '1px solid #2d3748'
              }}>
                <div 
                  style={{
                  display: 'flex',
                  alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  onClick={() => setIsActiveLackeysExpanded(!isActiveLackeysExpanded)}
                >
                  <div style={{
                    backgroundColor: '#4b5563',
                    padding: '0.5rem',
                    borderRadius: '0.5rem',
                    width: '1.875rem',
                    height: '1.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.875rem'
                  }}>
                    <LackeyIcon />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ 
                      color: '#e2e8f0',
                      margin: 0,
                      fontSize: '0.9375rem'
                    }}>
                      Active Lackeys
                  <span style={{ 
                    backgroundColor: '#2563eb',
                    color: 'white',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '1rem',
                        fontSize: '0.75rem',
                        marginLeft: '0.5rem'
                  }}>{jobs.filter(job => job.tradingWalletPublicKey).length}</span>
                    </h3>
                    {!isActiveLackeysExpanded && (
                      <p style={{ 
                        color: '#94a3b8',
                        margin: '0.1875rem 0 0 0',
                        fontSize: '0.75rem'
                      }}>
                        Currently running lackey strategies
                      </p>
                    )}
                  </div>
                  <svg 
                    width="20" 
                    height="20" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    xmlns="http://www.w3.org/2000/svg"
                    style={{
                      transform: isActiveLackeysExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s ease',
                      color: '#94a3b8'
                    }}
                  >
                    <path d="M19 9L12 16L5 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>

                <div style={{
                  maxHeight: isActiveLackeysExpanded ? '100%' : '0',
                  opacity: isActiveLackeysExpanded ? '1' : '0',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease-in-out',
                  marginTop: isActiveLackeysExpanded ? '1rem' : '0'
                }}>
                {jobs.length === 0 ? (
                  <div style={{
                    color: '#94a3b8',
                    textAlign: 'center',
                    padding: '2rem',
                    backgroundColor: '#2d3748',
                    borderRadius: '0.5rem'
                  }}>
                    <p style={{ margin: 0 }}>No active lackeys</p>
                    <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
                      Create a new lackey using the strategies on the right
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {tradingWallets.map((tw) => {
                      const walletJobs = jobs.filter(job => job.tradingWalletPublicKey === tw.publicKey);
                      if (walletJobs.length === 0) return null;

                      return (
                        <div key={tw.publicKey} style={{
                          backgroundColor: '#2d3748',
                          padding: '0.75rem',
                          borderRadius: '0.5rem',
                          border: '1px solid #4b5563'
                        }}>
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '0.5rem',
                              padding: '0.5rem 0.75rem',
                            backgroundColor: '#1e293b',
                              borderLeft: '4px solid #3b82f6',
                            borderRadius: '0.375rem'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: '#e2e8f0', fontSize: '0.875rem', fontWeight: '600' }}>
                                {tw.name || `Trading Wallet ${tradingWallets.indexOf(tw) + 1}`}
                              </span>
                              <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                                {tw.publicKey.slice(0, 4)}...{tw.publicKey.slice(-4)}
                              </span>
                            </div>
                            <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                              {walletJobs.length} {walletJobs.length === 1 ? 'Lackey' : 'Lackeys'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            {walletJobs.map(job => {
                              return (
                                <div 
                                  key={job.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    backgroundColor: job.isActive ? '#1e293b' : '#2d3748',
                                    padding: '0.5rem',
                                    borderRadius: '0.25rem',
                                    border: '1px solid #4b5563',
                                    fontSize: '0.75rem',
                                    opacity: pausedJobs.has(job.id) ? 0.5 : 1,
                                    transition: 'opacity 0.2s ease-in-out'
                                  }}
                                >
                                  <div style={{
                                    color: '#e2e8f0',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    maxWidth: '70%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem'
                                  }}>
                                      <span style={{ fontSize: '1rem' }}>
                                        {job.type === JobType.WALLET_MONITOR ? (
                                          <WalletMonitorIcon
                                            isActive={job.isActive && !pausedJobs.has(job.id)}
                                            onClick={() => toggleJobPause(job.id)}
                                          />
                                        ) : job.type === JobType.PRICE_MONITOR ? (
                                          <PriceMonitorIcon
                                            isActive={job.isActive && !pausedJobs.has(job.id)}
                                            onClick={() => toggleJobPause(job.id)}
                                          />
                                        ) : job.type === JobType.VAULT ? (
                                          <VaultIcon
                                            isActive={job.isActive && !pausedJobs.has(job.id)}
                                            onClick={() => toggleJobPause(job.id)}
                                          />
                                        ) : job.type === JobType.LEVELS ? (
                                          <LevelsIcon
                                            isActive={job.isActive && !pausedJobs.has(job.id)}
                                            onClick={() => toggleJobPause(job.id)}
                                          />
                                        ) : '❓'}
                                      </span>
                                      <span style={{ color: '#94a3b8' }}>|</span>
                                      <span>
                                        {job.type === JobType.WALLET_MONITOR ? (
                                          <span>
                                            <span style={{ color: '#e2e8f0' }}>{(job as WalletMonitoringJob).name || 'Unnamed Wallet'}</span>
                                            <span style={{ color: '#94a3b8' }}> - </span>
                                            <span 
                                              className={styles.copyAddress}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                navigator.clipboard.writeText((job as WalletMonitoringJob).walletAddress);
                                                setNotification({
                                                  message: 'Address copied to clipboard',
                                                  type: 'success'
                                                });
                                              }}
                                              title="Click to copy address"
                                            >
                                              {(job as WalletMonitoringJob).walletAddress.slice(0, 4)}...{(job as WalletMonitoringJob).walletAddress.slice(-4)}
                                            </span>
                                          </span>
                                        ) : (
                                          <span>
                                            <span style={{ color: '#e2e8f0' }}>{tw.name || `Trading Wallet ${tradingWallets.indexOf(tw) + 1}`}</span>
                                            <span style={{ color: '#94a3b8' }}> - </span>
                                            <span 
                                              className={styles.copyAddress}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                navigator.clipboard.writeText(tw.publicKey);
                                                setNotification({
                                                  message: 'Address copied to clipboard',
                                                  type: 'success'
                                                });
                                              }}
                                              title="Click to copy address"
                                            >
                                              {tw.publicKey.slice(0, 4)}...{tw.publicKey.slice(-4)}
                                            </span>
                                          </span>
                                        )}
                                      </span>
                                      <span style={{ color: '#94a3b8' }}>|</span>
                                      <span>
                                        {job.type === JobType.WALLET_MONITOR
                                          ? `${(job as WalletMonitoringJob).percentage}%`
                                          : job.type === JobType.PRICE_MONITOR
                                            ? `$${(job as PriceMonitoringJob).targetPrice} (${(job as PriceMonitoringJob).direction === 'above' ? 'sell limit' : 'stop loss'}) ${(job as PriceMonitoringJob).percentageToSell}%`
                                          : job.type === JobType.VAULT
                                            ? `${(job as VaultStrategy).vaultPercentage}%`
                                          : job.type === JobType.LEVELS
                                            ? (job as LevelsStrategy).levels.map(level => `$${level.price}: ${level.percentage}%`).join(' | ')
                                            : 'Unknown'}
                                      </span>
                                      {job.profitTracking?.currentProfit !== undefined && (
                                        <>
                                          <span style={{ color: '#94a3b8' }}>|</span>
                                          <span style={{
                                            color: job.profitTracking.currentProfit >= 0 ? '#22c55e' : '#ef4444',
                                            fontWeight: '500',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.25rem'
                                          }}>
                                            <span>{job.profitTracking.currentProfit > 0 ? '+' : ''}{job.profitTracking.currentProfit.toFixed(2)}%</span>
                                            {job.profitTracking.trades.length > 0 && (
                                              <span style={{ 
                                                fontSize: '0.625rem', 
                                                backgroundColor: job.profitTracking.currentProfit >= 0 ? '#15803d' : '#991b1b',
                                                padding: '0.125rem 0.25rem',
                                                borderRadius: '0.25rem'
                                              }}>
                                                {job.profitTracking.trades.length} {job.profitTracking.trades.length === 1 ? 'trade' : 'trades'}
                                              </span>
                                            )}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '0.25rem',
                                    opacity: pausedJobs.has(job.id) ? 0.5 : 1
                                  }}>
                                    <span style={{
                                      padding: '0.25rem 0.5rem',
                                      backgroundColor: pausedJobs.has(job.id) ? '#6b7280' : '#10b981',
                                      color: 'white',
                                      borderRadius: '0.25rem',
                                      fontSize: '0.75rem'
                                    }}>
                                      {pausedJobs.has(job.id) ? 'Paused' : 'Active'}
                                    </span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleJobPause(job.id);
                                      }}
                                      style={{
                                        padding: '0.25rem 0.5rem',
                                        backgroundColor: pausedJobs.has(job.id) ? '#3b82f6' : '#4b5563',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.25rem',
                                        cursor: 'pointer',
                                        fontSize: '0.75rem',
                                        opacity: 0.8,
                                        transition: 'opacity 0.2s'
                                      }}
                                      onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                      onMouseLeave={e => e.currentTarget.style.opacity = '0.8'}
                                    >
                                      {pausedJobs.has(job.id) ? 'Resume' : 'Pause'}
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('Are you sure you want to delete this strategy?')) {
                                          deleteJob(job.id);
                                        }
                                      }}
                                      style={{
                                        padding: '0.25rem 0.5rem',
                                        backgroundColor: '#ef4444',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.25rem',
                                        cursor: 'pointer',
                                        fontSize: '0.75rem',
                                        opacity: 0.8,
                                        transition: 'opacity 0.2s'
                                      }}
                                      onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                      onMouseLeave={e => e.currentTarget.style.opacity = '0.8'}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
              </div>
            </div>

            {/* Right Column - Available Lackeys */}
            <div style={{
              display: 'flex', 
              flexDirection: 'column', 
              gap: '0.75rem' /* Reduced from 1rem to 0.75rem (25% smaller) */
            }}>
              <div style={{ 
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <h2 style={{ 
                  color: '#60a5fa',
                  margin: 0,
                  fontSize: '1.125rem'
                }}>Available Lackeys</h2>
                <LackeyImportExport
                  jobs={jobs}
                  setJobs={setJobs}
                  walletConnected={!!wallet.publicKey}
                  walletPublicKey={wallet.publicKey?.toString() || ''}
                />
              </div>

              {/* Wallet Monitor Strategy Card */}
              <div style={{
                backgroundColor: '#1e293b',
                padding: '1.125rem',
                borderRadius: '0.75rem',
                border: '1px solid #2d3748',
                marginBottom: '1.125rem'  // Add consistent spacing
              }}>
                <div 
                  style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  onClick={() => toggleStrategy('wallet-monitor')}
                >
                  <div style={{
                    backgroundColor: '#3b82f6',
                    padding: '0.5rem',
                    borderRadius: '0.5rem',
                    width: '1.875rem',
                    height: '1.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.875rem'
                  }}>
                    <WalletMonitorIcon isActive={true} onClick={() => {}} />
                  </div>
                  <div style={{ flex: 1 }}>
                  <h3 style={{ 
                    color: '#e2e8f0',
                    margin: 0,
                      fontSize: '0.9375rem'
                  }}>Wallet Monitor</h3>
                    {expandedStrategy !== 'wallet-monitor' && (
                      <p style={{ 
                        color: '#94a3b8',
                        margin: '0.1875rem 0 0 0',
                        fontSize: '0.75rem'
                      }}>
                        Mirror trades from any Solana wallet
                      </p>
                    )}
                  </div>
                  <div style={{
                    color: '#94a3b8',
                    transform: expandedStrategy === 'wallet-monitor' ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                    fontSize: '0.75rem'
                  }}>
                    ▼
                  </div>
                </div>
                
                {expandedStrategy === 'wallet-monitor' && (
                  <div style={{
                    marginTop: '1.125rem',
                    animation: 'fadeIn 0.2s ease'
                  }}>
                <p style={{ 
                  color: '#94a3b8',
                      margin: '0 0 1.125rem 0',
                      fontSize: '0.75rem'
                }}>
                  Mirror trades from any Solana wallet with your specified percentage
                </p>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ 
                    display: 'block',
                    marginBottom: '0.5rem',
                    color: '#e2e8f0',
                    fontSize: '0.875rem'
                  }}>
                    Wallet to Monitor
        </label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={monitoredWallet}
                      onChange={handleWalletInputChange}
                      style={{
                        flex: 1,
                        padding: '0.75rem',
                        borderRadius: '0.375rem',
                        border: '1px solid ' + (isValidAddress ? '#4b5563' : '#ef4444'),
                        backgroundColor: '#1e293b',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}
                      placeholder="Enter a Solana wallet address to monitor"
                    />
                    <button
                      onClick={() => {
                        if (!isValidAddress || !monitoredWallet) return;
                        
                        // Check if wallet is already saved
                        const isAlreadySaved = jobs.some(job => 
                          job.type === JobType.WALLET_MONITOR && 
                          job.walletAddress === monitoredWallet &&
                          !job.isActive
                        );
                        
                        if (isAlreadySaved) {
                          setNotification({
                            message: 'This wallet is already saved',
                            type: 'info'
                          });
                          return;
                        }
                        
                        // Create a new job for saving the wallet (inactive)
                        const newJob: WalletMonitoringJob = {
                          id: `save-${Date.now()}`,
                          type: JobType.WALLET_MONITOR,
                          walletAddress: monitoredWallet,
                          percentage: 0,
                          isActive: false,
                          tradingWalletPublicKey: '',
                          tradingWalletSecretKey: new Uint8Array(), // Empty secret key since not active
                          mirroredTokens: {},
                          createdAt: new Date().toISOString(),
                          profitTracking: {
                            initialBalance: 0,
                            currentBalance: 0,
                            initialPrice: solPrice,
                            currentPrice: solPrice,
                            currentProfit: 0,
                            lastUpdated: new Date().toISOString(),
                            history: [],
                            trades: []
                          }
                        };
                        
                        setJobs([...jobs, newJob]);
                        localStorage.setItem(`jobs_${wallet.publicKey?.toString()}`, JSON.stringify([...jobs, newJob]));
                        
                        setNotification({
                          message: 'Wallet saved successfully',
                          type: 'success'
                        });
                      }}
                      disabled={!isValidAddress}
                      style={{
                        padding: '0.75rem 1rem',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '0.375rem',
                        cursor: isValidAddress ? 'pointer' : 'not-allowed',
                        opacity: isValidAddress ? 1 : 0.5,
                        fontSize: '0.875rem',
                        fontWeight: '500',
                        transition: 'background-color 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem'
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16L21 8V19C21 20.1046 20.1046 21 19 21Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M17 21V13H7V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M7 3V8H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Save
                    </button>
                  </div>
                </div>

                {/* Wallet Monitor Auto Trade Percentage Input */}
                <div style={{ marginBottom: '1.5rem' }}>  {/* Add margin bottom */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="text"
                      value={autoTradePercentage === 0 ? '' : autoTradePercentage}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '') {
                          setAutoTradePercentage(0);
                        } else {
                          const num = parseFloat(value);
                          if (!isNaN(num)) {
                            setAutoTradePercentage(Math.min(100, Math.max(0, num)));
                          }
                        }
                      }}
                      onBlur={(e) => {
                        if (e.target.value === '') {
                          setAutoTradePercentage(0);
                        }
                      }}
                      style={{
                        width: '60px',
                        padding: '0.75rem',
                        backgroundColor: '#1e293b',
                        border: '1px solid #4b5563',
                        borderRadius: '0.375rem',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}
                      placeholder="0"
                    />
                    <span style={{ color: '#e2e8f0' }}>%</span>
                  </div>
                </div>

                <button
                  onClick={createJob}
                  disabled={!isValidAddress || !selectedTradingWallet}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.375rem',
                    cursor: (isValidAddress && selectedTradingWallet) ? 'pointer' : 'not-allowed',
                    opacity: (isValidAddress && selectedTradingWallet) ? 1 : 0.5,
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    transition: 'background-color 0.2s'
                  }}
                >
                  Create Lackey
                </button>

                {/* Saved Wallets Section */}
                <div style={{ 
                  marginTop: '1rem',
                  padding: '0.6rem',
                  backgroundColor: '#2d3748',
                  borderRadius: '0.5rem',
                  fontSize: '0.75rem',
                  width: 'calc(100% - 1rem)',  // Adjust width to be slightly smaller
                  marginRight: '1rem'  // Add right margin
                }}>
                  <div style={{ 
                    color: '#94a3b8', 
                    marginBottom: '0.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span>Saved Wallets:</span>
                    <span style={{ color: '#64748b', fontSize: '0.625rem' }}>
                      {jobs.filter(job => job.type === JobType.WALLET_MONITOR && !job.isActive).length} Saved
                    </span>
                  </div>

                  {/* Search and Sort Controls */}
                  <div style={{
                    display: 'flex',
                    gap: '0.5rem',
                    marginBottom: '0.75rem',
                    alignItems: 'center'
                  }}>
                    <input
                      type="text"
                      placeholder="Search wallets..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        flex: 1,
                        backgroundColor: '#1e293b',
                        border: '1px solid #3b82f6',
                        borderRadius: '0.25rem',
                        padding: '0.375rem 0.5rem',
                        fontSize: '0.75rem',
                        color: '#e2e8f0',
                        outline: 'none'
                      }}
                    />
                    <button
                      onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                      style={{
                        backgroundColor: '#1e293b',
                        border: '1px solid #3b82f6',
                        borderRadius: '0.25rem',
                        padding: '0.375rem 0.5rem',
                        fontSize: '0.75rem',
                        color: '#e2e8f0',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem'
                      }}
                    >
                      <span>Sort</span>
                      <span style={{ fontSize: '0.625rem' }}>
                        {sortOrder === 'asc' ? '↑' : '↓'}
                      </span>
                    </button>
                  </div>

                  <div style={{ 
                    color: '#64748b', 
                    fontSize: '0.75rem',
                    marginBottom: '0.5rem',
                    fontStyle: 'italic'
                  }}>
                    Click a wallet to populate the input field above
                  </div>
                  <div className={styles.savedWalletsContainer}>
                    {jobs
                      .filter(job => job.type === JobType.WALLET_MONITOR && !job.isActive)
                      .filter(job => {
                        const monitorJob = job as WalletMonitoringJob;
                        return searchQuery === '' || 
                          monitorJob.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          monitorJob.walletAddress.toLowerCase().includes(searchQuery.toLowerCase());
                      })
                      .sort((a, b) => {
                        const jobA = a as WalletMonitoringJob;
                        const jobB = b as WalletMonitoringJob;
                        const nameA = jobA.name || jobA.walletAddress;
                        const nameB = jobB.name || jobB.walletAddress;
                        return sortOrder === 'asc' 
                          ? nameA.localeCompare(nameB)
                          : nameB.localeCompare(nameA);
                      })
                      .map((job) => {
                        const monitorJob = job as WalletMonitoringJob;
                        const isEditing = editingWalletId === job.id;

                        // Get the trading wallets this saved wallet is active on
                        const activeTradingWallets = jobs
                          .filter(j => j.type === JobType.WALLET_MONITOR && 
                            j.walletAddress === monitorJob.walletAddress && 
                                     j.isActive)
                          .map(j => j.tradingWalletPublicKey);

                        return (
                          <div 
                            key={job.id} 
                            style={{ 
                              display: 'flex',
                              flexDirection: 'column',
                              width: '100%',
                              backgroundColor: '#1e293b',
                              borderRadius: '0.25rem',
                              marginBottom: '0.25rem',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease-in-out',
                              border: '1px solid transparent',
                              overflow: 'hidden'
                            }}
                            onClick={() => {
                              setMonitoredWallet(monitorJob.walletAddress);
                              setIsValidAddress(true);
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#2d3748';
                              e.currentTarget.style.borderColor = '#3b82f6';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '#1e293b';
                              e.currentTarget.style.borderColor = 'transparent';
                            }}
                          >
                            {/* Main wallet info */}
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.75rem',
                              gap: '0.5rem'
                            }}>
                              <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.25rem'
                              }}>
                                {/* Wallet name with edit functionality */}
                                <div style={{ 
                                  position: 'relative',
                                  display: 'inline-block',
                                  maxWidth: '100%'
                                }}>
                                  {editingWalletId === job.id ? (
                                    <input
                                      type="text"
                                      value={editedWalletName}
                                      onChange={(e) => setEditedWalletName(e.target.value)}
                                      onBlur={() => {
                                        handleWalletNameSave(job.id);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          handleWalletNameSave(job.id);
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      autoFocus
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        borderBottom: '1px solid #3b82f6',
                                        color: '#e2e8f0',
                                        fontSize: '0.875rem',
                                        padding: '0.25rem',
                                        outline: 'none',
                                        width: '150px'
                                      }}
                                    />
                                  ) : (
                                    <div className={styles.walletName}>
                                      <span className={styles.walletNameText}>
                                        {monitorJob.name || 'Unnamed Wallet'}
                                      </span>
                                      <button
                                        className={styles.editIcon}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingWalletId(job.id);
                                          setEditedWalletName(monitorJob.name || 'Unnamed Wallet');
                                        }}
                                        style={{
                                          background: 'none',
                                          border: 'none',
                                          padding: '2px',
                                          marginLeft: '-2px',
                                          fontSize: '0.75rem',
                                          transform: 'translate(-2px, -2px)' // Move left and up
                                        }}
                                      >
                                        ✎
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <span style={{ color: '#64748b', fontSize: '0.75rem' }}>
                                  {monitorJob.walletAddress.slice(0, 4)}...{monitorJob.walletAddress.slice(-4)}
                                </span>
                              </div>
                            </div>

                            {/* Active On section */}
                            <div style={{
                              borderTop: '1px solid #2d3748',
                              padding: '0.5rem 0.75rem',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.5rem'
                            }}>
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                              }}>
                                <span style={{ 
                                  color: '#64748b',
                                  fontSize: '0.625rem',
                                  flexShrink: 0
                                }}>Active On:</span>
                                <div style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: '0.25rem'
                                }}>
                                  {activeTradingWallets.length > 0 ? (
                                    activeTradingWallets.map((twPublicKey) => {
                                      const tw = tradingWallets.find(tw => tw.publicKey === twPublicKey);
                                      return (
                                        <div
                                          key={twPublicKey}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            backgroundColor: '#2d3748',
                                            padding: '0.25rem 0.5rem',
                                            borderRadius: '0.25rem',
                                            border: '1px solid #3b82f6',
                                            fontSize: '0.625rem',
                                            color: '#e2e8f0'
                                          }}
                                        >
                                          <span style={{
                                            backgroundColor: '#1e293b',
                                            padding: '0.125rem',
                                            borderRadius: '0.125rem',
                                            fontSize: '0.5rem',
                                            marginRight: '0.25rem'
                                          }}>
                                            <TradingWalletIcon />
                                          </span>
                                          <span style={{
                                            maxWidth: '100px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                          }}>
                                            {tw?.name || `Trading Wallet ${tradingWallets.indexOf(tw!) + 1}`}
                                          </span>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <span style={{ color: '#64748b', fontSize: '0.75rem' }}>None</span>
                                  )}
                                </div>
                              </div>

                              {/* Remove button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const updatedJobs = jobs.filter(j => j.id !== job.id);
                                  setJobs(updatedJobs);
                                  localStorage.setItem(`jobs_${wallet.publicKey?.toString()}`, JSON.stringify(updatedJobs));
                                  setNotification({
                                    message: 'Saved wallet removed successfully',
                                    type: 'success'
                                  });
                                }}
                                style={{
                                  width: '100%',
                                  padding: '0.5rem',
                                  backgroundColor: '#ef4444',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '0.25rem',
                                  cursor: 'pointer',
                                  fontSize: '0.75rem',
                                  opacity: 0.9,
                                  transition: 'opacity 0.2s ease-in-out'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.opacity = '1';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.opacity = '0.9';
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    {jobs.filter(job => job.type === JobType.WALLET_MONITOR && !job.isActive).length === 0 && (
                      <div style={{ 
                        color: '#94a3b8',
                        textAlign: 'center',
                        padding: '1rem'
                      }}>
                        No saved wallets yet
                      </div>
                    )}
                  </div>
                </div>
                  </div>
                )}
              </div>

              {/* Price Monitor Strategy Card */}
              <div style={{
                backgroundColor: '#1e293b',
                padding: '1.125rem',
                borderRadius: '0.75rem',
                border: '1px solid #2d3748',
                marginBottom: '1.125rem'
              }}>
                <div 
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  onClick={() => toggleStrategy('price-monitor')}
                >
                  <div style={{
                    backgroundColor: '#3b82f6',
                    padding: '0.5rem',
                    borderRadius: '0.5rem',
                    width: '1.875rem',
                    height: '1.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.875rem'
                  }}>
                    <PriceMonitorIcon isActive={true} onClick={() => {}} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ 
                      color: '#e2e8f0',
                      margin: 0,
                      fontSize: '0.9375rem'
                    }}>Price Monitor</h3>
                    {expandedStrategy !== 'price-monitor' && (
                      <p style={{ 
                        color: '#94a3b8',
                        margin: '0.1875rem 0 0 0',
                        fontSize: '0.75rem'
                      }}>
                        Monitor token prices and execute trades
                      </p>
                    )}
                  </div>
                  <div style={{
                    color: '#94a3b8',
                    transform: expandedStrategy === 'price-monitor' ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                    fontSize: '0.75rem'
                  }}>
                    ▼
                  </div>
                </div>
                {expandedStrategy === 'price-monitor' && (
                  <div style={{
                    marginTop: '1.125rem',
                    animation: 'fadeIn 0.2s ease'
                  }}>
                    <p style={{ 
                      color: '#94a3b8',
                      margin: '0 0 1.125rem 0',
                      fontSize: '0.75rem'
                    }}>
                      Monitor token prices and execute trades when conditions are met
                    </p>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}>
                        Target Price (USD)
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="number"
                          value={targetPrice || ''}
                          onChange={(e) => setTargetPrice(parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          placeholder="Enter target price"
                          step="0.01"
                        />
                      </div>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}>
                        Direction
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => setPriceDirection('above')}
                          style={{
                            flex: 1,
                            padding: '0.75rem',
                            backgroundColor: priceDirection === 'above' ? '#3b82f6' : '#1e293b',
                            border: '1px solid ' + (priceDirection === 'above' ? '#60a5fa' : '#4b5563'),
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          Sell Limit
                        </button>
                        <button
                          onClick={() => setPriceDirection('below')}
                          style={{
                            flex: 1,
                            padding: '0.75rem',
                            backgroundColor: priceDirection === 'below' ? '#3b82f6' : '#1e293b',
                            border: '1px solid ' + (priceDirection === 'below' ? '#60a5fa' : '#4b5563'),
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          Stop Loss
                        </button>
                      </div>
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}>
                        Percentage to Sell
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="number"
                          value={sellPercentage}
                          onChange={(e) => setSellPercentage(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                          style={{
                            width: '60px',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          min="1"
                          max="100"
                        />
                        <span style={{ color: '#e2e8f0' }}>%</span>
                      </div>
                    </div>

                    <button
                      onClick={createPriceMonitorJob}
                      disabled={!selectedTradingWallet || !targetPrice}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        backgroundColor: selectedTradingWallet && targetPrice ? '#3b82f6' : '#1e293b',
                        border: '1px solid ' + (selectedTradingWallet && targetPrice ? '#60a5fa' : '#4b5563'),
                        borderRadius: '0.375rem',
                        color: '#e2e8f0',
                        cursor: selectedTradingWallet && targetPrice ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s'
                      }}
                    >
                      Create Price Monitor
                    </button>
                  </div>
                )}
              </div>

              {/* Vault Strategy Card */}
              <div style={{
                backgroundColor: '#1e293b',
                padding: '1.125rem',
                borderRadius: '0.75rem',
                border: '1px solid #2d3748',
                marginBottom: '1.125rem'
              }}>
                <div 
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  onClick={() => toggleStrategy('vault')}
                >
                  <div style={{
                    backgroundColor: '#3b82f6',
                    padding: '0.5rem',
                    borderRadius: '0.5rem',
                    width: '1.875rem',
                    height: '1.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.875rem'
                  }}>
                    <VaultIcon isActive={true} onClick={() => {}} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ 
                      color: '#e2e8f0',
                      margin: 0,
                      fontSize: '0.9375rem'
                    }}>Vault</h3>
                    {expandedStrategy !== 'vault' && (
                      <p style={{ 
                        color: '#94a3b8',
                        margin: '0.1875rem 0 0 0',
                        fontSize: '0.75rem'
                      }}>
                        Automate vault strategy trades
                      </p>
                    )}
                  </div>
                  <div style={{
                    color: '#94a3b8',
                    transform: expandedStrategy === 'vault' ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                    fontSize: '0.75rem'
                  }}>
                    ▼
                  </div>
                </div>
                {expandedStrategy === 'vault' && (
                  <div style={{
                    marginTop: '1.125rem',
                    animation: 'fadeIn 0.2s ease'
                  }}>
                    <p style={{ 
                      color: '#94a3b8',
                      margin: '0 0 1.125rem 0',
                      fontSize: '0.75rem'
                    }}>
                      Automate your vault strategy trades with customizable settings
                    </p>
                    <div style={{ marginBottom: '1.5rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}>
                        Vault Percentage
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="number"
                          value={vaultPercentage}
                          onChange={(e) => setVaultPercentage(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                          style={{
                            width: '60px',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          min="1"
                          max="100"
                        />
                        <span style={{ color: '#e2e8f0' }}>%</span>
                      </div>
                    </div>

                    <button
                      onClick={createVaultStrategy}
                      disabled={!selectedTradingWallet || !vaultPercentage}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        backgroundColor: selectedTradingWallet && vaultPercentage ? '#3b82f6' : '#1e293b',
                        border: '1px solid ' + (selectedTradingWallet && vaultPercentage ? '#60a5fa' : '#4b5563'),
                        borderRadius: '0.375rem',
                        color: '#e2e8f0',
                        cursor: selectedTradingWallet && vaultPercentage ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s'
                      }}
                    >
                      Create Vault Strategy
                    </button>
                  </div>
                )}
              </div>

              {/* Levels Strategy Card */}
              <div style={{
                backgroundColor: '#1e293b',
                padding: '1.125rem',
                borderRadius: '0.75rem',
                border: '1px solid #2d3748',
                marginBottom: '1.125rem'
              }}>
                <div 
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  onClick={() => toggleStrategy('levels')}
                >
                  <div style={{
                    backgroundColor: '#3b82f6',
                    padding: '0.5rem',
                    borderRadius: '0.5rem',
                    width: '1.875rem',
                    height: '1.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.875rem'
                  }}>
                    <LevelsIcon isActive={true} onClick={() => {}} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ 
                      color: '#e2e8f0',
                      margin: 0,
                      fontSize: '0.9375rem'
                    }}>Levels</h3>
                    {expandedStrategy !== 'levels' && (
                      <p style={{ 
                        color: '#94a3b8',
                        margin: '0.1875rem 0 0 0',
                        fontSize: '0.75rem'
                      }}>
                        Trade based on price levels
                      </p>
                    )}
                  </div>
                  <div style={{
                    color: '#94a3b8',
                    transform: expandedStrategy === 'levels' ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                    fontSize: '0.75rem'
                  }}>
                    ▼
                  </div>
                </div>
                {expandedStrategy === 'levels' && (
                  <div style={{
                    marginTop: '1.125rem',
                    animation: 'fadeIn 0.2s ease'
                  }}>
                    <p style={{ 
                      color: '#94a3b8',
                      margin: '0 0 1.125rem 0',
                      fontSize: '0.75rem'
                    }}>
                      Set up price levels for automated trading strategies
                    </p>
                    <div style={{ marginBottom: '1rem' }}>
                      {levels.map((level, index) => (
                        <div key={index} style={{ 
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          marginBottom: '0.5rem',
                          backgroundColor: '#2d3748',
                          padding: '0.5rem',
                          borderRadius: '0.375rem'
                        }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                              ${level.price}
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                              {level.percentage}%
                            </div>
                          </div>
                          <button
                            onClick={() => setLevels(levels.filter((_, i) => i !== index))}
                            style={{
                              backgroundColor: 'transparent',
                              border: 'none',
                              color: '#94a3b8',
                              cursor: 'pointer',
                              padding: '0.25rem'
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}>
                        Price Level (USD)
                      </label>
                      <input
                        type="number"
                        value={newLevelPrice || ''}
                        onChange={(e) => setNewLevelPrice(parseFloat(e.target.value) || 0)}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          backgroundColor: '#1e293b',
                          border: '1px solid #4b5563',
                          borderRadius: '0.375rem',
                          color: '#e2e8f0',
                          fontSize: '0.875rem',
                          marginBottom: '0.5rem'
                        }}
                        placeholder="Enter price level"
                        step="0.01"
                      />
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}>
                        Percentage to Sell
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="number"
                          value={newLevelPercentage || ''}
                          onChange={(e) => setNewLevelPercentage(Math.min(100, Math.max(1, parseInt(e.target.value) || 0)))}
                          style={{
                            width: '60px',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          min="1"
                          max="100"
                        />
                        <span style={{ color: '#e2e8f0' }}>%</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                      <button
                        onClick={() => {
                          if (newLevelPrice && newLevelPercentage) {
                            setLevels([...levels, { price: newLevelPrice, percentage: newLevelPercentage }]);
                            setNewLevelPrice(0);
                            setNewLevelPercentage(0);
                          }
                        }}
                        disabled={!newLevelPrice || !newLevelPercentage}
                        style={{
                          flex: 1,
                          padding: '0.75rem',
                          backgroundColor: newLevelPrice && newLevelPercentage ? '#3b82f6' : '#1e293b',
                          border: '1px solid ' + (newLevelPrice && newLevelPercentage ? '#60a5fa' : '#4b5563'),
                          borderRadius: '0.375rem',
                          color: '#e2e8f0',
                          cursor: newLevelPrice && newLevelPercentage ? 'pointer' : 'not-allowed',
                          transition: 'all 0.2s'
                        }}
                      >
                        Add Level
                      </button>
                    </div>

                    <button
                      onClick={createLevelsStrategy}
                      disabled={!selectedTradingWallet || levels.length === 0}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        backgroundColor: selectedTradingWallet && levels.length > 0 ? '#3b82f6' : '#1e293b',
                        border: '1px solid ' + (selectedTradingWallet && levels.length > 0 ? '#60a5fa' : '#4b5563'),
                        borderRadius: '0.375rem',
                        color: '#e2e8f0',
                        cursor: selectedTradingWallet && levels.length > 0 ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s'
                      }}
                    >
                      Create Levels Strategy
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : currentPage === 'whale-tracker' ? (
        <WhaleTrackerPage onRpcError={onRpcError} currentEndpoint={currentEndpoint} />
      ) : currentPage === 'graphs' ? (
        <div style={{
          backgroundColor: '#0f172a',
          minHeight: '100vh',
          padding: '2rem',
          margin: 0,
          boxSizing: 'border-box',
          isolation: 'isolate',
          position: 'relative',
          zIndex: 1
        }}>
          <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
            <div style={{
              backgroundColor: '#1e293b',
              padding: '1.5rem',
              borderRadius: '1rem',
              marginBottom: '2rem',
              isolation: 'isolate'
            }}>
              <h2 style={{ 
                color: '#60a5fa',
                marginTop: 0,
                marginBottom: '1rem',
                fontSize: '1.5rem'
              }}>Trading View</h2>
              <Graphs
                tradingWallets={tradingWallets}
                heliusApiKey={HELIUS_API_KEY}
                endpoint={HELIUS_ENDPOINT}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Add keyframe animation for fade in effect */}
      <style>
        {`
          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      </style>
      
      {/* Export Modal */}
      <PasswordModal
        isOpen={isExportModalOpen}
        onClose={() => {
          setIsExportModalOpen(false);
          setExportError(null);
        }}
        onSubmit={handleExportWallets}
        title="Export Trading Wallets"
        message={`Please enter a password to encrypt your wallet data. This password will be required to import the wallets later. ${exportError ? `\n\nError: ${exportError}` : ''}`}
        submitLabel="Export"
      />
      
      {/* Import Modal */}
      <ImportWalletModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={handleImportWallets}
        existingWallets={tradingWallets}
        ownerAddress={wallet.publicKey?.toString() || ''}
        wallet={wallet}
      />
      
      {/* Notification */}
      {notification && (
        <Notification
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}

      {/* Fund Wallet Modal */}
      {fundingWallet && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: '#1e293b',
            padding: '1.5rem',
            borderRadius: '0.5rem',
            width: '90%',
            maxWidth: '400px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
          }}>
            <h3 style={{ 
              color: '#e2e8f0', 
              marginTop: 0,
              marginBottom: '1rem'
            }}>
              Fund Trading Wallet
            </h3>
            
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ 
                display: 'block',
                marginBottom: '0.5rem',
                color: '#94a3b8'
              }}>
                Amount (SOL)
              </label>
              <input
                type="number"
                value={fundingAmount}
                onChange={(e) => setFundingAmount(e.target.value)}
                placeholder="0.0"
                step="0.1"
                min="0"
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  backgroundColor: '#2d3748',
                  border: '1px solid #4b5563',
                  borderRadius: '0.375rem',
                  color: '#e2e8f0'
                }}
              />
            </div>
            
            <div style={{
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => setFundingWallet(null)}
                className={`${styles.button} ${styles.secondary}`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!fundingAmount || !fundingWallet) return;
                  await fundWallet(fundingWallet, parseFloat(fundingAmount));
                  setFundingWallet(null);
                  setFundingAmount('');
                }}
                disabled={!fundingAmount || parseFloat(fundingAmount) <= 0}
                className={`${styles.button} ${styles.primary}`}
              >
                Fund
              </button>
            </div>
          </div>
        </div>
      )}
      <WalletLimitDialog 
        isOpen={showWalletLimitDialog} 
        onClose={() => setShowWalletLimitDialog(false)}
        maxWallets={3}
      />
      <DeleteWalletDialog 
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setWalletToDelete(null);
        }}
        onConfirm={confirmDeleteWallet}
        walletName={walletToDelete?.name || `Trading Wallet ${tradingWallets.findIndex(w => w.publicKey === walletToDelete?.publicKey) + 1}`}
      />
      <OverrideLackeyModal
        isOpen={isOverrideModalOpen}
        onClose={() => {
          setIsOverrideModalOpen(false);
          setExistingJobId(null);
        }}
        onConfirm={handleOverrideConfirm}
        monitoredWallet={monitoredWallet}
        tradingWallet={selectedTradingWallet?.publicKey || ''}
      />
    </div>
  );
};

// Add interface for TokenBalancesListProps
interface TokenBalancesListProps {
  walletAddress: string; 
  connection: Connection;
  tradingWallet?: TradingWallet;
  displayMode?: 'full' | 'total-only';  // Add display mode prop
  onRpcError?: () => void;  // Add onRpcError prop
}

// Add a cache for token balances
const tokenBalanceCache = new Map<string, { symbol: string; decimals: number }>();

// Add a wallet balance cache in localStorage
const getWalletBalanceCache = (walletAddress: string): TokenBalance[] => {
  try {
    const cacheKey = `wallet_balances_${walletAddress}`;
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) {
      const { balances, timestamp } = JSON.parse(cachedData);
      // Cache is valid for 5 minutes
      if (Date.now() - timestamp < 5 * 60 * 1000) {
        return balances;
      }
    }
    return [];
  } catch (error) {
    logError('Error reading from wallet balance cache:', error);
    return [];
  }
};

const saveWalletBalanceCache = (walletAddress: string, balances: TokenBalance[]) => {
  try {
    const cacheKey = `wallet_balances_${walletAddress}`;
    const cacheData = {
      balances,
      timestamp: Date.now()
    };
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
  } catch (error) {
    logError('Error saving to wallet balance cache:', error);
  }
};

// Add a debounce utility function
const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<F>) => {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func(...args), waitFor);
  };

  return debounced as (...args: Parameters<F>) => ReturnType<F>;
};

export const TokenBalancesList: React.FC<TokenBalancesListProps> = ({ 
  walletAddress, 
  connection, 
  tradingWallet, 
  displayMode = 'full',
  onRpcError 
}): ReactElement => {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [jupiterError, setJupiterError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState(0);
  const [consecutiveRateLimitErrors, setConsecutiveRateLimitErrors] = useState(0);
  const [totalUsdValue, setTotalUsdValue] = useState(0);
  const [isBackgroundUpdate, setIsBackgroundUpdate] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState(Date.now());
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const successMessageTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Minimum time between refreshes in milliseconds (15 seconds)
  const REFRESH_COOLDOWN = 15000;
  
  // Load cached balances on initial render
  useEffect(() => {
    const cachedBalances = getWalletBalanceCache(walletAddress);
    if (cachedBalances.length > 0) {
      log(`Loaded ${cachedBalances.length} cached balances for ${walletAddress}`);
      setBalances(cachedBalances);
      
      // Calculate total USD value from cache
      const total = cachedBalances.reduce((sum, balance) => sum + (balance.usdValue || 0), 0);
      setTotalUsdValue(total);
      
      // Trigger a background update only if it's been more than the cooldown period
      const now = Date.now();
      if (now - lastRefreshTime > REFRESH_COOLDOWN) {
        setIsBackgroundUpdate(true);
        setLastRefreshTime(now);
      }
    }
  }, [walletAddress, lastRefreshTime]);

  // Helper function to delay execution
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  // Helper function to implement exponential backoff for RPC calls
  const withRetry = async <T,>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
    let lastError: Error | null = null;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        }
      }
    }
    throw lastError;
  };

  const fetchBalances = useCallback(async () => {
    // Check if we're already fetching or if it's too soon to refresh
    const now = Date.now();
    if (isFetching || (!isInitialLoad && now - lastRefreshTime < REFRESH_COOLDOWN)) {
      log(`Skipping refresh - ${isFetching ? 'already fetching' : 'too soon'}`);
      return;
    }
    
    try {
      setIsFetching(true);
      setLastRefreshTime(now);
      
      // Only show progress for non-background updates
      if (!isBackgroundUpdate) {
        setFetchProgress(0);
      }
      
      // Reset consecutive errors on successful fetch start
      setConsecutiveRateLimitErrors(0);
      
      // First get SOL balance - this is a priority
      const walletSolBalance = await withRetry(() => connection.getBalance(new PublicKey(walletAddress)));
      
      // Create new balances array
      let newBalances: TokenBalance[] = [];
      
      // Add SOL balance
      const solToken = {
        mint: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        balance: walletSolBalance,
        decimals: 9,
        uiBalance: walletSolBalance / LAMPORTS_PER_SOL,
        logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'
      };
      
      // Create a map of existing balances for quick lookup
      const existingBalancesMap = new Map(
        balances.map(balance => [balance.mint, balance])
      );
      
      // Start with SOL
      if (existingBalancesMap.has(solToken.mint)) {
        // Update existing SOL balance but keep USD value
        const existing = existingBalancesMap.get(solToken.mint)!;
        newBalances.push({
          ...solToken,
          usdValue: existing.usdValue
        });
      } else {
        newBalances.push(solToken);
      }
      
      // Update balances with SOL first so UI shows something quickly
      if (!isBackgroundUpdate) {
        setBalances(newBalances);
        setFetchProgress(10);
      }
      
      // Then get SPL token balances
      const response = await withRetry(() => 
        connection.getTokenAccountsByOwner(
          new PublicKey(walletAddress),
          { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
        )
      );
      
      if (!isBackgroundUpdate) {
        setFetchProgress(20);
      }
      
      // Process token accounts in batches
      const BATCH_SIZE = 5; // Process 5 tokens at a time
      const BATCH_DELAY = 1000; // Wait 1 second between batches
      
      // Skip sorting for now to avoid TypeScript errors
      const sortedTokenAccounts = [...response.value];
      
      // Process in batches
      for (let i = 0; i < sortedTokenAccounts.length; i += BATCH_SIZE) {
        const batch = sortedTokenAccounts.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (item) => {
          try {
            const accountInfo = await withRetry(() => connection.getParsedAccountInfo(item.pubkey));
            const parsedInfo = accountInfo.value?.data && 'parsed' in accountInfo.value.data 
              ? (accountInfo.value.data.parsed?.info as ParsedTokenInfo)
              : null;
            
            if (parsedInfo && 'tokenAmount' in parsedInfo) {
              const mint = parsedInfo.mint;
              
              // Check if we already have this token in our existing balances
              if (existingBalancesMap.has(mint)) {
                const existing = existingBalancesMap.get(mint)!;
                // Update balance but keep other metadata and USD value
                return {
                  ...existing,
                  balance: Number(parsedInfo.tokenAmount.amount),
                  uiBalance: parsedInfo.tokenAmount.uiAmount || 0
                };
              } else {
                // New token, fetch metadata
                try {
                  const metadata = await fetchTokenMetadata(mint, connection);
                  return {
                    mint,
                    symbol: metadata.symbol,
                    balance: Number(parsedInfo.tokenAmount.amount),
                    decimals: metadata.decimals,
                    uiBalance: parsedInfo.tokenAmount.uiAmount || 0
                  };
                } catch (error) {
                  logError(`Error fetching metadata for ${mint}:`, error);
                  return null;
                }
              }
            }
            return null;
          } catch (error) {
            logError(`Error processing token account:`, error);
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter(Boolean) as TokenBalance[];
        
        // Update balances incrementally after each batch
        newBalances = [...newBalances, ...validResults];
        
        // Only update UI for non-background updates
        if (!isBackgroundUpdate) {
          setBalances(newBalances);
          
          // Update progress
          const progress = 20 + Math.floor(80 * (i + batch.length) / sortedTokenAccounts.length);
          setFetchProgress(Math.min(progress, 95));
        }
        
        // Wait before processing next batch to avoid rate limits
        if (i + BATCH_SIZE < sortedTokenAccounts.length) {
          await delay(BATCH_DELAY);
        }
      }
      
      // Now fetch prices in batches too
      const PRICE_BATCH_SIZE = 3;
      const PRICE_BATCH_DELAY = 1500;
      
      let updatedBalances = [...newBalances];
      
      // Process SOL price first
      const solTokenBalance = updatedBalances.find(b => b.symbol === 'SOL');
      if (solTokenBalance) {
        try {
          const priceFeed = PriceFeedService.getInstance();
          const solPrice = priceFeed.getPrice('sol');
          solTokenBalance.usdValue = solTokenBalance.uiBalance * solPrice;
          
          // Only update UI for non-background updates
          if (!isBackgroundUpdate) {
            setBalances(updatedBalances);
          }
        } catch (error) {
          logError('Error fetching SOL price:', error);
        }
      }
      
      // Process USDC price (it's 1:1)
      const usdcBalance = updatedBalances.find(b => b.symbol === 'USDC');
      if (usdcBalance) {
        usdcBalance.usdValue = usdcBalance.uiBalance;
        
        // Only update UI for non-background updates
        if (!isBackgroundUpdate) {
          setBalances(updatedBalances);
        }
      }
      
      // Process other tokens in batches - always fetch fresh prices for all tokens with non-zero balance
      const tokensNeedingPrices = updatedBalances.filter(b => 
        b.symbol !== 'SOL' && 
        b.symbol !== 'USDC' && 
        b.uiBalance > 0
      );
      
      // Reset USD values for tokens with zero balance
      updatedBalances.forEach(balance => {
        if (balance.uiBalance === 0) {
          balance.usdValue = 0;
        }
      });
      
      // Clear existing USD values for tokens that need price updates to ensure fresh prices
      tokensNeedingPrices.forEach(balance => {
        balance.usdValue = undefined;
      });
      
      for (let i = 0; i < tokensNeedingPrices.length; i += PRICE_BATCH_SIZE) {
        const batch = tokensNeedingPrices.slice(i, i + PRICE_BATCH_SIZE);
        
        await Promise.all(batch.map(async (balance) => {
          try {
            // If we already have a USD value, keep it
            if (balance.usdValue !== undefined) {
              return;
            }
            
            // Try to get price from Jupiter
            try {
              const quoteAmount = Math.pow(10, balance.decimals);
              
              // First try to get price in USDC
              let quoteResponse = await fetch(
                `${JUPITER_API_BASE}/quote?inputMint=${balance.mint}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${quoteAmount}&slippageBps=50`
              );
              
              // If USDC quote fails, try getting price in SOL then convert to USD
              if (!quoteResponse.ok) {
                quoteResponse = await fetch(
                  `${JUPITER_API_BASE}/quote?inputMint=${balance.mint}&outputMint=So11111111111111111111111111111111111111112&amount=${quoteAmount}&slippageBps=50`
                );
                
                if (quoteResponse.ok) {
                  const quoteData = await quoteResponse.json();
                  const priceInSol = Number(quoteData.outAmount) / Math.pow(10, 9);
                  const priceFeed = PriceFeedService.getInstance();
                  const solPrice = priceFeed.getPrice('sol');
                  balance.usdValue = balance.uiBalance * (priceInSol * solPrice);
                }
              } else {
                const quoteData = await quoteResponse.json();
                const priceInUsdc = Number(quoteData.outAmount) / Math.pow(10, 6);
                const pricePerToken = priceInUsdc / (quoteAmount / Math.pow(10, balance.decimals));
                balance.usdValue = balance.uiBalance * pricePerToken;
              }
            } catch (error) {
              // If price fetch fails, keep existing USD value if available
              logError(`Error fetching price for ${balance.symbol}:`, error);
            }
          } catch (error) {
            logError(`Error processing price for ${balance.symbol}:`, error);
          }
        }));
        
        // Only update UI for non-background updates
        if (!isBackgroundUpdate) {
          setBalances([...updatedBalances]);
        }
        
        // Wait before processing next batch to avoid rate limits
        if (i + PRICE_BATCH_SIZE < tokensNeedingPrices.length) {
          await delay(PRICE_BATCH_DELAY);
        }
      }
      
      // Calculate total USD value
      const total = updatedBalances.reduce((sum, balance) => sum + (balance.usdValue || 0), 0);
      
      // For background updates, only update the UI if there are differences
      if (isBackgroundUpdate) {
        // Check if balances have changed
        const hasBalanceChanges = updatedBalances.some(newBalance => {
          const existingBalance = existingBalancesMap.get(newBalance.mint);
          if (!existingBalance) return true; // New token
          
          // Check if balance or USD value has changed significantly
          return Math.abs(newBalance.uiBalance - existingBalance.uiBalance) > 0.00001 ||
                 Math.abs((newBalance.usdValue || 0) - (existingBalance.usdValue || 0)) > 0.01;
        });
        
        // If balances have changed, update the UI
        if (hasBalanceChanges) {
          log('Background update found changes, updating UI');
          setBalances(updatedBalances);
          setTotalUsdValue(total);
        } else {
          log('Background update found no significant changes');
        }
      } else {
        setTotalUsdValue(total);
      }
      
      // Save to cache
      saveWalletBalanceCache(walletAddress, updatedBalances);
      
      // Mark initial load as complete
      if (isInitialLoad) {
        setIsInitialLoad(false);
      }
      
      if (!isBackgroundUpdate) {
        setFetchProgress(100);
      }
      
      // Reset background update flag
      setIsBackgroundUpdate(false);
    } catch (error) {
      logError('Error fetching token balances:', error);
      // Don't clear balances on error, keep showing the last known state
      if (isInitialLoad) {
        setIsInitialLoad(false);
      }
      setIsBackgroundUpdate(false);
    } finally {
      setIsFetching(false);
    }
  }, [walletAddress, connection, balances, isInitialLoad, isFetching, isBackgroundUpdate, onRpcError, consecutiveRateLimitErrors, lastRefreshTime]);

  // Create a debounced version of fetchBalances
  const debouncedFetchBalances = useMemo(
    () => debounce(() => {
      setIsBackgroundUpdate(true);
      fetchBalances();
    }, 1000), // 1 second debounce
    [fetchBalances]
  );

  // Initial fetch
  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  // Subscribe to balance updates with debouncing
  useEffect(() => {
    if (!walletAddress) return;

    const connection = createRateLimitedConnection();

    // Subscribe to account changes for SOL balance
    const solSubscriptionId = connection.onAccountChange(
      new PublicKey(walletAddress),
      () => {
        log('SOL balance changed, debouncing refresh...');
        debouncedFetchBalances();
      },
      'confirmed'
    );

    // Subscribe to program account changes for token balances
    const tokenSubscriptionId = connection.onProgramAccountChange(
      new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      () => {
        log('Token balance changed, debouncing refresh...');
        debouncedFetchBalances();
      },
      'confirmed',
      [
        {
          memcmp: {
            offset: 32, // Owner offset in token account
            bytes: walletAddress
          }
        }
      ]
    );

    return () => {
      connection.removeAccountChangeListener(solSubscriptionId);
      connection.removeProgramAccountChangeListener(tokenSubscriptionId);
    };
  }, [walletAddress, debouncedFetchBalances]);

  // Listen for process-wallet events
  useEffect(() => {
    const handleProcessWallet = (event: CustomEvent<{ walletAddress: string }>) => {
      if (event.detail.walletAddress === walletAddress) {
        log(`Processing wallet ${walletAddress} from queue`);
        // Use the debounced version here too
        debouncedFetchBalances();
      }
    };
    
    window.addEventListener('process-wallet', handleProcessWallet as EventListener);
    
    return () => {
      window.removeEventListener('process-wallet', handleProcessWallet as EventListener);
    };
  }, [walletAddress, debouncedFetchBalances]);

  // Add handleSwap function
  const handleSwap = async (tokenBalance: TokenBalance) => {
    try {
      if (!tradingWallet) {
        throw new Error('Trading wallet not initialized');
      }

      const tradingKeypair = Keypair.fromSecretKey(new Uint8Array(tradingWallet.secretKey));
      console.log('Trading wallet public key:', tradingKeypair.publicKey.toBase58());
      
      const amountInSmallestUnit = tokenBalance.balance;

      // Validate input amount and check balances
      if (!amountInSmallestUnit || amountInSmallestUnit <= 0) {
        throw new Error('Invalid input amount');
      }

      // Check SOL balance for fees
      const solBalance = await connection.getBalance(tradingKeypair.publicKey);
      if (solBalance < 10000) { // ~0.00001 SOL for fees
        throw new Error('Insufficient SOL balance for transaction fees');
      }

      // Use the full amount - no buffer needed for Jupiter
      const adjustedAmount = amountInSmallestUnit;

      console.log('Requesting quote for swap:', {
        inputMint: tokenBalance.mint,
        outputMint: 'So11111111111111111111111111111111111111112', // Native SOL
        amount: adjustedAmount,
        slippageBps: 50,
        inputDecimals: tokenBalance.decimals,
        solBalance: solBalance / LAMPORTS_PER_SOL
      });

      // First try with direct routes
      let quoteResponse = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${tokenBalance.mint}` +
        `&outputMint=So11111111111111111111111111111111111111112` +
        `&amount=${adjustedAmount}` +
        `&slippageBps=50` +
        `&platformFeeBps=0` +
        `&onlyDirectRoutes=true`
      );

      // If direct route fails, try without restrictions
      if (!quoteResponse.ok) {
        console.log('Direct route not found, trying alternative routes...');
        quoteResponse = await fetch(
          `https://quote-api.jup.ag/v6/quote?inputMint=${tokenBalance.mint}` +
          `&outputMint=So11111111111111111111111111111111111111112` +
          `&amount=${adjustedAmount}` +
          `&slippageBps=50`
        );
      }

      if (!quoteResponse.ok) {
        const errorText = await quoteResponse.text();
        throw new Error(`Quote request failed: ${errorText}`);
      }

      const quoteData = await quoteResponse.json();
      console.log('Quote received:', quoteData);

      // Log the route information
      if (quoteData.routePlan) {
        console.log('Route plan:', quoteData.routePlan.map((step: any) => ({
          swapInfo: step.swapInfo.label,
          percent: step.percent,
          inputMint: step.swapInfo.inputMint,
          outputMint: step.swapInfo.outputMint
        })));
      }

      // Validate quote data
      if (!quoteData.inAmount || !quoteData.outAmount || Number(quoteData.inAmount) <= 0) {
        throw new Error('Invalid quote response: missing or invalid amount information');
      }

      const swapRequestBody = {
        quoteResponse: quoteData,
        userPublicKey: tradingKeypair.publicKey.toString(),
        wrapUnwrapSOL: true, // This ensures WSOL is unwrapped to SOL
        prioritizationFeeLamports: 5000,
        asLegacyTransaction: false,
        useTokenLedger: false,
        mode: "instructions"
      };

      console.log('Requesting swap instructions with config:', {
        ...swapRequestBody,
        quoteResponse: {
          ...swapRequestBody.quoteResponse,
          inAmount: quoteData.inAmount,
          outAmount: quoteData.outAmount
        }
      });

      const swapResponse = await fetch('https://api.jup.ag/swap/v1/swap-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(swapRequestBody)
      });

      if (!swapResponse.ok) {
        const errorText = await swapResponse.text();
        throw new Error(`Swap request failed: ${errorText}`);
      }

      const swapData = await swapResponse.json();
      console.log('Raw swap instructions received:', swapData);

      // Helper function to convert instruction fields to PublicKey objects
      const convertInstruction = (instr: any): TransactionInstruction | null => {
        try {
          if (!instr || typeof instr !== 'object') {
            console.error('Invalid instruction:', instr);
            return null;
          }

          if (!instr.programId || typeof instr.programId !== 'string') {
            console.error('Invalid programId:', instr.programId);
            return null;
          }

          if (!Array.isArray(instr.accounts)) {
            console.error('Invalid accounts array:', instr.accounts);
            return null;
          }

          return {
            programId: new PublicKey(instr.programId),
            keys: instr.accounts.map((account: any) => ({
              pubkey: new PublicKey(account.pubkey),
              isSigner: Boolean(account.isSigner),
              isWritable: Boolean(account.isWritable)
            })),
            data: Buffer.from(instr.data || '', 'base64')
          };
        } catch (error) {
          console.error('Error converting instruction:', error);
          console.error('Problematic instruction:', instr);
          return null;
        }
      };

      // Extract and validate instructions
      const { 
        swapInstruction, 
        computeBudgetInstructions = [], 
        setupInstructions = [], 
        cleanupInstruction, 
        addressLookupTableAddresses = []
      } = swapData;

      if (!swapInstruction || !setupInstructions) {
        throw new Error('Invalid swap response: missing required instructions');
      }

      // Convert instructions
      const validatedInstructions: TransactionInstruction[] = [
        ...computeBudgetInstructions.map(convertInstruction),
        ...setupInstructions.map(convertInstruction),
        convertInstruction(swapInstruction)
      ].filter((instr): instr is TransactionInstruction => instr !== null);

      if (cleanupInstruction) {
        const cleanup = convertInstruction(cleanupInstruction);
        if (cleanup) validatedInstructions.push(cleanup);
      }

      if (validatedInstructions.length === 0) {
        throw new Error('No valid instructions generated from swap response');
      }
      // Get latest blockhash with longer validity
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

      const messageV0 = new TransactionMessage({
        payerKey: tradingKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ...(swapData.computeBudgetInstructions || []),
          ...(swapData.setupInstructions || []),
          swapData.swapInstruction,
          ...(swapData.cleanupInstruction ? [swapData.cleanupInstruction] : [])
        ].filter(Boolean).map(instr => {
          const converted = convertInstruction(instr);
          if (!converted) {
            throw new Error('Failed to convert instruction');
          }
          return converted;
        })
      }).compileToV0Message([]); // Compile to VersionedMessage

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([tradingKeypair]);

      console.log('Sending transaction...');
      
      // Function to execute the transaction with retries
      const executeTransaction = async (retries = 3): Promise<string> => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            // Get fresh blockhash if not first attempt
            if (attempt > 1) {
              const { blockhash: newBlockhash } = await connection.getLatestBlockhash('finalized');
              transaction.message.recentBlockhash = newBlockhash;
              // Re-sign with new blockhash
              transaction.signatures = [];
              transaction.sign([tradingKeypair]);
            }

            const signature = await connection.sendTransaction(transaction, {
              skipPreflight: false,
              maxRetries: 3,
              preflightCommitment: 'confirmed'
            });

            console.log('Transaction sent:', signature);

            // Wait for confirmation with increased timeout
            const confirmation = await connection.confirmTransaction({
              signature,
              blockhash,
              lastValidBlockHeight
            }, 'confirmed');

            if (confirmation.value.err) {
              throw new Error(`Transaction failed: ${confirmation.value.err.toString()}`);
            }

            return signature;
          } catch (error: any) {
            console.log(`Attempt ${attempt} failed:`, error);
            
            if (attempt === retries || 
                !(error instanceof TransactionExpiredBlockheightExceededError) ||
                !error.message.includes('expired')) {
              throw error;
            }
            
            console.log(`Retrying transaction (attempt ${attempt + 1}/${retries})...`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between retries
          }
        }
        throw new Error('All retry attempts failed');
      };

      try {
        const signature = await executeTransaction();
        console.log('Transaction confirmed:', signature);
        window.dispatchEvent(new Event('update-balances'));
        return signature;
      } catch (error) {
        console.error('Error initiating swap:', error);
        throw error;
      }

    } catch (error) {
      console.error('Error initiating swap:', error);
      setJupiterError(error instanceof Error ? error.message : 'Failed to initiate swap');
    }
  };
  // Add a manual refresh function
  const handleManualRefresh = () => {
    // Only allow manual refresh if not already fetching and cooldown period has passed
    const now = Date.now();
    if (!isFetching && now - lastRefreshTime > REFRESH_COOLDOWN) {
      setIsBackgroundUpdate(false); // Make it a foreground update to show progress
      setFetchProgress(0);
      
      // Clear any existing timeout
      if (successMessageTimeoutRef.current) {
        clearTimeout(successMessageTimeoutRef.current);
        successMessageTimeoutRef.current = null;
      }
      
      // Set up a listener for when fetching completes
      const checkFetchingInterval = setInterval(() => {
        if (!isFetching) {
          clearInterval(checkFetchingInterval);
          setShowSuccessMessage(true);
          
          // Hide success message after 3 seconds
          successMessageTimeoutRef.current = setTimeout(() => {
            setShowSuccessMessage(false);
            successMessageTimeoutRef.current = null;
          }, 3000);
        }
      }, 500);
      
      fetchBalances();
    } else if (isFetching) {
      // Show a message that we're already refreshing
      alert('Already refreshing balances, please wait...');
    } else {
      // Show a message about the cooldown
      const remainingTime = Math.ceil((REFRESH_COOLDOWN - (now - lastRefreshTime)) / 1000);
      alert(`Please wait ${remainingTime} seconds before refreshing again.`);
    }
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (successMessageTimeoutRef.current) {
        clearTimeout(successMessageTimeoutRef.current);
      }
    };
  }, []);

  // Show a minimal loading state only on initial load
  if (isInitialLoad) {
    return (
      <div style={{ color: '#94a3b8', padding: '1rem' }}>
        <div>Fetching token balances...</div>
        {isFetching && (
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ 
              width: '100%', 
              backgroundColor: '#1e293b', 
              borderRadius: '0.25rem',
              height: '0.5rem',
              overflow: 'hidden'
            }}>
              <div style={{ 
                width: `${fetchProgress}%`, 
                backgroundColor: '#3b82f6', 
                height: '100%',
                transition: 'width 0.3s ease-in-out'
              }}></div>
            </div>
            <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: '#94a3b8' }}>
              {fetchProgress < 100 ? `${fetchProgress}% complete` : 'Finalizing...'}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Only show "No tokens" when we've completed at least one fetch and found nothing
  if (balances.length === 0) {
    return <div style={{ color: '#94a3b8' }}>No tokens found</div>;
  }

  if (displayMode === 'total-only') {
    return (
      <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
        Portfolio Value: ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {/* Display total USD value with refresh button */}
      <div style={{
        backgroundColor: '#1e293b',
        padding: '0.75rem',
        borderRadius: '0.375rem',
        marginBottom: '0.5rem',
        border: '1px solid #3b82f6',
        position: 'relative'
      }}>
        {/* Success message */}
        {showSuccessMessage && (
          <div style={{
            position: 'absolute',
            top: '-30px',
            right: '0',
            backgroundColor: '#10b981',
            color: 'white',
            padding: '0.25rem 0.5rem',
            borderRadius: '0.25rem',
            fontSize: '0.75rem',
            animation: 'fadeIn 0.3s ease-in-out',
            zIndex: 10
          }}>
            Balances refreshed successfully!
          </div>
        )}
        
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '0.25rem'
        }}>
          <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
            Total Portfolio Value
          </div>
          {displayMode === 'full' && (
            <button 
              onClick={handleManualRefresh}
              disabled={isFetching}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: isFetching ? 'not-allowed' : 'pointer',
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                fontSize: '0.75rem'
              }}
            >
              {/* Simple refresh icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M12 8L16 4M16 4L20 8M16 4V16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(135 16 4)"/>
              </svg>
              <span style={{ marginLeft: '0.25rem' }}>Refresh</span>
            </button>
          )}
        </div>
        <div style={{ color: '#e2e8f0', fontSize: '1rem', fontWeight: '500' }}>
          ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        
        {/* Show loading indicator when refreshing - only during initial load or explicit user-triggered refreshes */}
        {isFetching && !isBackgroundUpdate && (
          <div style={{ 
            position: 'absolute', 
            top: '0.5rem', 
            right: '0.5rem',
            fontSize: '0.75rem',
            color: '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem'
          }}>
            <div style={{ 
              width: '0.75rem', 
              height: '0.75rem', 
              borderRadius: '50%',
              borderTop: '2px solid #3b82f6',
              borderRight: '2px solid transparent',
              animation: 'spin 1s linear infinite',
              display: 'inline-block'
            }}></div>
            {/* Don't show percentage during background updates */}
            {!isBackgroundUpdate && fetchProgress > 0 && `${fetchProgress}%`}
          </div>
        )}
      </div>

      {/* Only show tokens with non-zero balance */}
      {balances
        .filter(balance => balance.uiBalance > 0)
        .map((balance) => (
        <div 
          key={balance.mint}
          style={{
            backgroundColor: '#1e293b',
            padding: '0.5rem',
            borderRadius: '0.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem',
            color: '#e2e8f0' 
          }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              overflow: 'hidden',
              backgroundColor: '#2d3748',
                                      flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {balance.logoURI ? (
                <img 
                  src={balance.logoURI} 
                  alt={`${balance.symbol} logo`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                  onError={(e) => {
                    // If image fails to load, show first letter of symbol
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).parentElement!.innerHTML = balance.symbol.charAt(0);
                  }}
                />
              ) : (
                <span style={{ 
                  color: '#e2e8f0', 
                  fontSize: '0.875rem',
                  fontWeight: 500 
                }}>
                  {balance.symbol.charAt(0)}
                </span>
              )}
            </div>
            {balance.symbol}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ color: '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <div>{balance.uiBalance.toFixed(4)}</div>
              {balance.usdValue !== undefined && (
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  ${balance.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}
            </div>
            {balance.mint !== 'So11111111111111111111111111111111111111112' && tradingWallet && (
              <button
                onClick={() => handleSwap(balance)}
                disabled={!tradingWallet}
                style={{
                  padding: '0.25rem 0.5rem',
                  backgroundColor: tradingWallet ? '#3b82f6' : '#64748b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.25rem',
                  cursor: tradingWallet ? 'pointer' : 'not-allowed',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  opacity: tradingWallet ? 1 : 0.7
                }}
              >
                <span>Swap to SOL</span>
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

const App = () => {
  const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
  const defaultEndpoint = 'https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a';

  // Create the wallet adapter config
  const walletConfig = {
    wallets,
    autoConnect: true,
  };

  const [endpoint, setEndpoint] = useState<string>(defaultEndpoint);
  
  // Add keyframe animation for spinner
  useEffect(() => {
    // Create a style element
    const styleEl = document.createElement('style');
    // Define the keyframe animation
    styleEl.innerHTML = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    // Append to document head
    document.head.appendChild(styleEl);
    
    // Cleanup on unmount
    return () => {
      document.head.removeChild(styleEl);
    };
  }, []);
  
  // Handle RPC errors by switching endpoints
  const handleRpcError = useCallback(() => {
    // Define fallback endpoints - only use Helius
    const fallbackEndpoints = [
      'https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a'
    ];
    
    // Get current endpoint
    const currentEndpoint = endpoint;
    
    // Find a different endpoint
    const availableEndpoints = fallbackEndpoints.filter(e => e !== currentEndpoint);
    if (availableEndpoints.length > 0) {
      const newEndpoint = availableEndpoints[0];
      log(`Switching RPC endpoint from ${currentEndpoint} to ${newEndpoint}`);
      setEndpoint(newEndpoint);
      localStorage.setItem('rpcEndpoint', newEndpoint);
    } else {
      log('No alternative endpoints available');
    }
  }, [endpoint]);
  
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider {...walletConfig}>
        <WalletModalProvider>
          <AppContent onRpcError={handleRpcError} currentEndpoint={endpoint} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default App;






