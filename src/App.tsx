import React, { useEffect, useState, useRef, ReactElement, useCallback, useMemo } from 'react';
import './App.css';
import walletStyles from './styles/Wallet.module.css';
import navigationStyles from './styles/Navigation.module.css';
import { ConnectionProvider, WalletProvider, useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, Keypair, Transaction, TransactionExpiredBlockheightExceededError } from '@solana/web3.js';
import { JobManager } from './managers/JobManager';
import { JobType, WalletMonitoringJob, AnyJob, PriceMonitoringJob, VaultStrategy, LevelsStrategy, PairTradeJob, DriftPerpJob, Level, ensureUint8Array } from './types/jobs';
import { Buffer } from 'buffer';
import { PriceFeedService } from './services/PriceFeedService';
import PasswordModal from './components/PasswordModal';
import ImportWalletModal from './components/ImportWalletModal';
import Notification from './components/Notification';
import { WhaleTracker } from './components/WhaleTracker/WhaleTracker';
import { exportWallets, storeWalletSecretKey, getWalletSecretKey } from './utils/walletExportImport';
import { importLackeys, mergeLackeys } from './utils/lackeyExportImport';
import WalletLimitDialog from './components/WalletLimitDialog';
import DeleteWalletDialog from './components/DeleteWalletDialog';
import DeleteLackeyDialog from './components/DeleteLackeyDialog';
import LackeyImportExport from './components/LackeyImportExport';
import { Graphs } from './pages/Graphs';
import { WalletMonitorIcon } from './components/WalletMonitorIcon';
import { TradingWalletIcon, LackeyIcon, PriceMonitorIcon, VaultIcon, LevelsIcon, PairTradeIcon, DriftPerpIcon } from './components/StrategyIcons';
import { StrategyMarketplace } from './components/StrategyMarketplace/StrategyMarketplace';
import OverrideLackeyModal from './components/OverrideLackeyModal';
import { WalletButton } from './components/WalletButton';
import { TokenDropdown } from './components/TokenDropdown';
import bs58 from 'bs58';
import { createRateLimitedConnection } from './utils/connection';
import { tradingWalletService } from './services/tradingWalletService';
import { WalletBalanceService } from './services/walletBalanceService';
import { executeSwap } from './services/api/swap.service';
import { StrategyService } from './services/strategy.service';
import { authService } from './services/auth.service';
import { PortfolioProvider } from './contexts/PortfolioContext';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { API_CONFIG } from './config/api';
import { strategyApiService } from './services/api/strategy.service';
import { savedWalletsApi } from './services/api/savedWallets.service';
import apiClient from './services/api/api-client';

// Initialize token metadata cache
const tokenMetadataCache = new Map<string, { symbol: string; decimals: number }>();

// Add SelectedToken interface
interface SelectedToken {
  mintAddress: string;
  symbol: string;
}

// Add at the top with other imports and constants
const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6';
const BACKEND_ENDPOINT = API_CONFIG.RPC_BASE;

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
  secretKey: Uint8Array;
  mnemonic: string;
  name?: string;
  createdAt: number;
}

interface StoredTradingWallets {
  [ownerAddress: string]: TradingWallet[];
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
    <div className={walletStyles.tooltip}>
      {children}
      <div className={walletStyles.tooltipContent}>
        {content}
        <div className={walletStyles.tooltipArrow} />
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
type Page = 'dashboard' | 'whale-tracker' | 'graphs' | 'marketplace';

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
            endpoint={BACKEND_ENDPOINT}
          />
        </div>
      </div>
    </div>
  );
};

// Navigation Bar Component
const NavigationBar: React.FC<{ currentPage: Page; onPageChange: (page: Page) => void }> = ({ currentPage, onPageChange }) => {
  const [solPrice, setSolPrice] = useState<number>(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
    <div className={navigationStyles.navigationBar}>
      <div className={navigationStyles.leftSection}>
        <div className="mascot-container">
            <img 
              src="/assets/images/mascot.png" 
              alt="Lackey Mascot" 
            className={navigationStyles.logo}
          />
          </div>
        <h1 className={navigationStyles.brandName}>Habitat</h1>
        </div>
      
      <nav className={navigationStyles.navButtons}>
          <button
            onClick={() => onPageChange('dashboard')}
          className={`${navigationStyles.navButton} ${currentPage === 'dashboard' ? navigationStyles.navButtonActive : ''}`}
          >
            Dashboard
          </button>
          <button
            onClick={() => onPageChange('whale-tracker')}
          className={`${navigationStyles.navButton} ${currentPage === 'whale-tracker' ? navigationStyles.navButtonActive : ''}`}
          >
            Whale Tracker
          </button>
          <button
            onClick={() => onPageChange('graphs')}
          className={`${navigationStyles.navButton} ${currentPage === 'graphs' ? navigationStyles.navButtonActive : ''}`}
          >
            Graphs
          </button>
          <button
            onClick={() => onPageChange('marketplace')}
          className={`${navigationStyles.navButton} ${currentPage === 'marketplace' ? navigationStyles.navButtonActive : ''}`}
          >
            Marketplace
          </button>
        </nav>

      <div className={navigationStyles.rightSection}>
        <div className={navigationStyles.priceContainer}>
          <img 
            src="/assets/images/solana.png" 
            alt="Solana Logo" 
            className={navigationStyles.solanaLogo}
          />
          <span className={navigationStyles.priceText}>
            ${solPrice.toFixed(2)}
          </span>
      </div>
      <WalletButton />
      </div>

      {/* Mobile Menu Button */}
      <button 
        className={navigationStyles.mobileMenuButton}
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className={navigationStyles.mobileMenu}>
          <button
            onClick={() => {
              onPageChange('dashboard');
              setIsMobileMenuOpen(false);
            }}
            className={`${navigationStyles.mobileNavButton} ${currentPage === 'dashboard' ? navigationStyles.navButtonActive : ''}`}
          >
            Dashboard
          </button>
          <button
            onClick={() => {
              onPageChange('whale-tracker');
              setIsMobileMenuOpen(false);
            }}
            className={`${navigationStyles.mobileNavButton} ${currentPage === 'whale-tracker' ? navigationStyles.navButtonActive : ''}`}
          >
            Whale Tracker
          </button>
          <button
            onClick={() => {
              onPageChange('graphs');
              setIsMobileMenuOpen(false);
            }}
            className={`${navigationStyles.mobileNavButton} ${currentPage === 'graphs' ? navigationStyles.navButtonActive : ''}`}
          >
            Graphs
          </button>
          <button
            onClick={() => {
              onPageChange('marketplace');
              setIsMobileMenuOpen(false);
            }}
            className={`${navigationStyles.mobileNavButton} ${currentPage === 'marketplace' ? navigationStyles.navButtonActive : ''}`}
          >
            Marketplace
          </button>
        </div>
      )}
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

  // Utility functions for persisting selected trading wallet
  const saveSelectedTradingWallet = (wallet: TradingWallet | null) => {
    try {
      if (wallet) {
        console.log('💾 Saving selected wallet:', wallet.name, 'publicKey:', wallet.publicKey);
        localStorage.setItem('selectedTradingWalletPublicKey', wallet.publicKey);
      } else {
        console.log('💾 Clearing saved wallet selection');
        localStorage.removeItem('selectedTradingWalletPublicKey');
      }
    } catch (error) {
      console.warn('Failed to save selected trading wallet:', error);
    }
  };

  const restoreSelectedTradingWallet = (wallets: TradingWallet[]) => {
    try {
      // Clean up old localStorage key if it exists
      localStorage.removeItem('selectedTradingWalletId');
      
      const savedWalletPublicKey = localStorage.getItem('selectedTradingWalletPublicKey');
      console.log('🔄 Restoring wallet selection - savedPublicKey:', savedWalletPublicKey);
      console.log('🔄 Available wallets:', wallets.map(w => ({ name: w.name, publicKey: w.publicKey })));
      
      if (savedWalletPublicKey && wallets.length > 0) {
        const savedWallet = wallets.find(w => w.publicKey === savedWalletPublicKey);
        console.log('🔄 Found saved wallet:', savedWallet ? savedWallet.name : 'NOT FOUND');
        
        if (savedWallet) {
          setSelectedTradingWallet(savedWallet);
          console.log('✅ Successfully restored wallet selection:', savedWallet.name);
          return savedWallet;
        } else {
          // Clean up if saved wallet no longer exists
          console.log('🧹 Cleaning up non-existent saved wallet');
          localStorage.removeItem('selectedTradingWalletPublicKey');
        }
      }
    } catch (error) {
      console.warn('Failed to restore selected trading wallet:', error);
    }
    console.log('❌ No wallet restored, will use fallback');
    return null;
  };

  // Enhanced setSelectedTradingWallet with persistence
  const handleSetSelectedTradingWallet = (wallet: TradingWallet | null) => {
    setSelectedTradingWallet(wallet);
    saveSelectedTradingWallet(wallet);
  };
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
  const [sellPercentage, setSellPercentage] = useState<string | number>('5');
  const [jupiterInitialized, setJupiterInitialized] = useState(false);
  const [jupiterError, setJupiterError] = useState<string | null>(null);
  const [vaultPercentage, setVaultPercentage] = useState<string | number>('0.5');
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
  const [newLevelPercentage, setNewLevelPercentage] = useState<string | number>('');
  
  // Add state for pair trade
  const [pairTokenA, setPairTokenA] = useState('');
  const [pairTokenB, setPairTokenB] = useState('');
  const [pairTokenASymbol, setPairTokenASymbol] = useState('');
  const [pairTokenBSymbol, setPairTokenBSymbol] = useState('');
  const [pairAllocationPercentage, setPairAllocationPercentage] = useState<string | number>('50');
  const [pairMaxSlippage, setPairMaxSlippage] = useState<string | number>('1');
  const [supportedTokens, setSupportedTokens] = useState<any[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  
  // Add state for Drift Perp
  const [driftMarketSymbol, setDriftMarketSymbol] = useState('SOL-PERP');
  const [driftMarketIndex, setDriftMarketIndex] = useState(0);
  const [driftDirection, setDriftDirection] = useState<'long' | 'short'>('long');
  const [driftAllocationPercentage, setDriftAllocationPercentage] = useState<string | number>('25');
  const [driftEntryPrice, setDriftEntryPrice] = useState<string | number>('');
  const [driftExitPrice, setDriftExitPrice] = useState<string | number>('');
  const [driftLeverage, setDriftLeverage] = useState<string | number>('1');
  const [driftStopLoss, setDriftStopLoss] = useState<string | number>('');
  const [driftTakeProfit, setDriftTakeProfit] = useState<string | number>('');
  const [driftMaxSlippage, setDriftMaxSlippage] = useState<string | number>('1');
  const [availableDriftMarkets, setAvailableDriftMarkets] = useState<any[]>([]);
  const [isDriftMarketsLoading, setIsDriftMarketsLoading] = useState(false);
  
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

  // Initialize wallet balance service
  const walletBalanceService = useMemo(() => new WalletBalanceService(), []);

  // Handle wallet connection
  useEffect(() => {
    if (wallet.publicKey?.toBase58()) {
      const walletAddress = wallet.publicKey.toBase58();
      walletBalanceService.initializeWallet(walletAddress)
        .catch(error => console.error('Failed to initialize wallet balances:', error));

      // Cleanup on wallet disconnect or component unmount
      return () => {
        walletBalanceService.cleanup();
      };
    }
  }, [wallet.publicKey, walletBalanceService]);

  // Add function to handle wallet name save
  const handleWalletNameSave = (jobId: string) => {
    console.log('💾 All jobs:', jobs);
    console.log('💾 Looking for job with ID:', jobId);
    
    const job = jobs.find(j => j.id === jobId);
    console.log('💾 Found job:', job);
    console.log('💾 Job keys:', job ? Object.keys(job) : 'no job found');
    console.log('💾 Job type:', job?.type);
    console.log('💾 Is saved wallet?', job?.type === JobType.SAVED_WALLET);
    
    if (job && job.type === JobType.SAVED_WALLET) {
      // It's a saved wallet, update backend
      console.log('💾 Calling handleUpdateSavedWalletName with:', jobId, editedWalletName.trim());
      handleUpdateSavedWalletName(jobId, editedWalletName.trim() || 'Unnamed Wallet');
      setEditingWalletId(null);
      return;
    }
    // Otherwise, update local state only
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

  // Load supported tokens on mount
  useEffect(() => {
    // Add a small delay to ensure the backend is ready
    const timer = setTimeout(() => {
      loadSupportedTokens();
    }, 1000);
    
    return () => clearTimeout(timer);
  }, []);

  // Fetch drift markets on mount
  useEffect(() => {
    fetchDriftMarkets();
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
        
        // Convert secret keys from base64 to Uint8Array
        const processedWallets = userWallets.map(w => {
          try {
            return {
              ...w,
              secretKey: new Uint8Array(Buffer.from(w.secretKey, 'base64'))
            };
          } catch (error) {
            console.error('Error processing wallet secret key:', error);
            return w;
          }
        });
        
        setTradingWallets(processedWallets);
        // Auto-select: first try to restore from localStorage, then select first wallet
        if (!selectedTradingWallet && processedWallets.length > 0) {
          const restoredWallet = restoreSelectedTradingWallet(processedWallets);
          if (!restoredWallet) {
            handleSetSelectedTradingWallet(processedWallets[0]);
          }
        }
      }
    }
  }, [wallet.publicKey]);

  // Minimal converter for backend strategies
  const convertBackendStrategyToJob = async (strategy: any): Promise<AnyJob> => {
    // For wallet monitor strategies without a name, try to look up from saved wallets
    let strategyName = strategy.name;
    if (!strategyName && strategy.strategy_type === JobType.WALLET_MONITOR && strategy.config?.walletAddress) {
      try {
        const savedWallets = await savedWalletsApi.getAll(wallet.publicKey!.toString());
        const foundWallet = savedWallets.find(w => w.wallet_address === strategy.config.walletAddress);
        if (foundWallet?.name) {
          strategyName = foundWallet.name;
          console.log(`Found saved wallet name "${foundWallet.name}" for existing strategy ${strategy.id}`);
        }
      } catch (error) {
        console.log('Could not lookup saved wallet name for existing strategy:', error);
      }
    }

    // Load secret key from localStorage
    const tradingWalletPublicKey = strategy.wallet_pubkey || strategy.current_wallet_pubkey;
    const secretKey = getWalletSecretKey(tradingWalletPublicKey);
    
    if (!secretKey || secretKey.length !== 64) {
      console.warn(`Warning: No valid secret key found for trading wallet ${tradingWalletPublicKey}. This strategy will run on the backend only.`);
      // For wallet monitoring strategies, don't run workers in frontend - they should run on backend daemon
      if (strategy.strategy_type === JobType.WALLET_MONITOR) {
        console.log(`WalletMonitor strategy ${strategy.id} will be handled by backend daemon only.`);
      }
    }

    const baseJob = {
      id: strategy.id.toString(),
      tradingWalletPublicKey,
      isActive: strategy.is_active ?? true,
      createdAt: strategy.created_at,
      name: strategyName,
      tradingWalletSecretKey: secretKey || new Uint8Array(),
      profitTracking: {
        initialBalance: 0,
        currentProfit: 0,
        totalProfitSOL: 0,
        totalProfitUSD: 0,
        percentageChange: 0.00,
        transactions: []
      }
    };

    // Add strategy-specific fields based on type
    switch (strategy.strategy_type) {
      case JobType.WALLET_MONITOR:
        return {
          ...baseJob,
          type: JobType.WALLET_MONITOR,
          walletAddress: strategy.config.walletAddress,
          percentage: strategy.config.percentage,
          recentTransactions: [],
          mirroredTokens: {}
        } as WalletMonitoringJob;
        
      case JobType.PRICE_MONITOR:
        return {
          ...baseJob,
          type: JobType.PRICE_MONITOR,
          targetPrice: strategy.config.targetPrice,
          direction: strategy.config.direction,
          percentageToSell: strategy.config.percentageToSell
        } as PriceMonitoringJob;
        
      case JobType.VAULT:
        return {
          ...baseJob,
          type: JobType.VAULT,
          vaultPercentage: strategy.config.vaultPercentage
        } as VaultStrategy;
        
      case JobType.LEVELS:
        return {
          ...baseJob,
          type: JobType.LEVELS,
          levels: strategy.config.levels || []
        } as LevelsStrategy;
        
      case JobType.PAIR_TRADE:
        return {
          ...baseJob,
          type: JobType.PAIR_TRADE,
          tokenAMint: strategy.config.tokenAMint,
          tokenBMint: strategy.config.tokenBMint,
          tokenASymbol: strategy.config.tokenASymbol,
          tokenBSymbol: strategy.config.tokenBSymbol,
          allocationPercentage: strategy.config.allocationPercentage,
          maxSlippage: strategy.config.maxSlippage || 2.0,
          autoRebalance: strategy.config.autoRebalance || false,
          lastSwapTimestamp: strategy.config.lastSwapTimestamp,
          swapHistory: strategy.config.swapHistory || []
        } as PairTradeJob;
        
      case JobType.DRIFT_PERP:
        return {
          ...baseJob,
          type: JobType.DRIFT_PERP,
          marketSymbol: strategy.config.marketSymbol,
          marketIndex: strategy.config.marketIndex,
          direction: strategy.config.direction,
          allocationPercentage: strategy.config.allocationPercentage,
          entryPrice: strategy.config.entryPrice,
          exitPrice: strategy.config.exitPrice,
          leverage: strategy.config.leverage,
          stopLoss: strategy.config.stopLoss,
          takeProfit: strategy.config.takeProfit,
          positionSize: strategy.config.positionSize || 0,
          entryTimestamp: strategy.config.entryTimestamp,
          exitTimestamp: strategy.config.exitTimestamp,
          realizedPnl: strategy.config.realizedPnl || 0,
          fees: strategy.config.fees || 0
        } as DriftPerpJob;
        
      default:
        throw new Error(`Unknown strategy type: ${strategy.strategy_type}`);
    }
  };

  // Load jobs with backend fallback and proper authentication
  const loadJobsWithBackendFallback = async () => {
    if (!wallet.publicKey) return;

    const walletAddress = wallet.publicKey.toString();
    console.log('🔍 Loading jobs for wallet:', walletAddress);

    // Step 0: Ensure we're authenticated with the current wallet (FORCE FRESH AUTH)
    try {
      console.log('🔐 Forcing fresh authentication for current wallet...');
      
      // Always sign out first to clear any old tokens
      await authService.signOut();
      console.log('🚪 Signed out of previous session');
      
      // Sign in with current wallet
      console.log('🔑 Signing in with current wallet:', walletAddress);
      const newToken = await authService.signIn(walletAddress);
      if (!newToken) {
        console.error('❌ Failed to authenticate with current wallet');
        setJobs([]);
        return;
      }
      console.log('✅ Successfully authenticated with current wallet');
    } catch (authError) {
      console.error('❌ Authentication failed:', authError);
      setJobs([]);
      return;
    }

    // Step 1: Try localStorage first and clean up old jobs
    const cacheKey = `jobs_${walletAddress}`;
    const storedJobs = localStorage.getItem(cacheKey);
    
    if (storedJobs) {
      console.log('📱 Found localStorage data:', storedJobs.length, 'characters');
      try {
        const parsedJobs = JSON.parse(storedJobs);
        console.log('📋 Total jobs in localStorage:', parsedJobs.length);
        
        // Separate old jobs (non-numeric IDs) from new jobs (numeric IDs)
        const numericJobs = parsedJobs.filter((job: any) => /^\d+$/.test(job.id));
        const nonNumericJobs = parsedJobs.filter((job: any) => !/^\d+$/.test(job.id));
        
        console.log('✅ Valid backend jobs (numeric IDs):', numericJobs.length);
        console.log('🗑️ Old jobs to clean up (non-numeric IDs):', nonNumericJobs.length);
        
        if (nonNumericJobs.length > 0) {
          console.log('🧹 Cleaning up old jobs and saving clean localStorage');
          // Save only the valid jobs back to localStorage
          localStorage.setItem(cacheKey, JSON.stringify(numericJobs));
        }
        
        if (numericJobs.length > 0) {
          console.log('✅ Found', numericJobs.length, 'valid jobs from localStorage');
          console.log('🔄 Still checking backend for latest data...');
          // Don't exit early - always check backend for latest data
        } else {
          console.log('📭 No valid backend jobs in localStorage, loading from backend...');
        }
      } catch (error) {
        console.error('❌ Error parsing localStorage jobs:', error);
        // Continue to backend fallback if localStorage is corrupted
      }
    } else {
      console.log('📭 No localStorage data found');
    }

    // Step 2: Load from backend (either no localStorage or no valid jobs)
    console.log('🌐 Loading from backend for wallet:', walletAddress);
    try {
      // Load both strategies and saved wallets from backend
      const [backendStrategies, savedWallets] = await Promise.all([
        strategyApiService.getStrategies(),
        savedWalletsApi.getAll(walletAddress)
      ]);
      
      console.log('🌐 Backend returned', backendStrategies.length, 'strategies');
      console.log('🌐 Backend returned', savedWallets.length, 'saved wallets');
      
      // Convert strategies to jobs
      const validStrategies = backendStrategies.filter(strategy => {
        // The strategy should be associated with trading wallets owned by current main wallet
        // This is handled by the backend auth, but let's add extra verification
        return true; // Backend already filters by main_wallet_pubkey
      });
      
      const convertedStrategies = await Promise.all(validStrategies.map(convertBackendStrategyToJob));
      console.log('✅ Converted', convertedStrategies.length, 'strategies to jobs');
      
      // Convert saved wallets to jobs
      const savedWalletJobs = mapSavedWalletsToJobs(savedWallets);
      console.log('✅ Converted', savedWalletJobs.length, 'saved wallets to jobs');
      
      // Merge both types of jobs
      const allJobs = [...convertedStrategies, ...savedWalletJobs];
      console.log('✅ Total jobs loaded:', allJobs.length, '(', convertedStrategies.length, 'strategies +', savedWalletJobs.length, 'saved wallets)');
      
      setJobs(allJobs);
      
      // Fetch ALL trading wallets from backend database first (not just ones with strategies)
      console.log('🔍 IMPROVED: Fetching ALL trading wallets from backend database...');
      let allTradingWallets: any[] = [];
      try {
        allTradingWallets = await tradingWalletService.getWallets(wallet.publicKey?.toString() || '');
        console.log('🔍 IMPROVED: Found', allTradingWallets.length, 'trading wallets in database:', allTradingWallets);
      } catch (error) {
        console.error('❌ Could not fetch trading wallets from backend:', error);
      }
      
      // Get strategy wallet addresses for comparison
      const strategyJobs = convertedStrategies;
      const strategyWalletAddresses = new Set(strategyJobs.map(job => job.tradingWalletPublicKey));
      console.log('🔍 IMPROVED: Strategy wallet addresses:', Array.from(strategyWalletAddresses));
      
      // Sort wallets by creation date (oldest first) to ensure proper ordering
      const sortedTradingWallets = allTradingWallets.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.created_at).getTime();
        const dateB = new Date(b.createdAt || b.created_at).getTime();
        return dateA - dateB; // Ascending order (oldest first)
      });

      // Create trading wallet objects from ALL database wallets
      const tradingWalletsFromJobs = sortedTradingWallets.map((backendWallet, index) => {
        const address = backendWallet.publicKey || backendWallet.wallet_pubkey;
        
        // Try to get wallet name from multiple sources
        let walletName = backendWallet.name; // Backend should have the name
        
        // If not found in backend, try saved wallets
        if (!walletName) {
          const savedWallet = savedWallets.find(w => w.wallet_address === address);
          walletName = savedWallet?.name;
          console.log(`🔍 IMPROVED: For address ${address}, found savedWallet name:`, walletName);
        }
        
        // Fallback to address-based name
        if (!walletName) {
          walletName = `Trading Wallet ${index + 1} (${address.slice(0, 4)}...${address.slice(-4)})`;
        }
        
        return {
          publicKey: address,
          name: walletName,
          secretKey: new Uint8Array(), // Will be loaded when needed
          strategies: [],
          hasStrategies: strategyWalletAddresses.has(address) // Track which ones have strategies
        };
      });
      
      console.log('🔗 IMPROVED: Loaded', tradingWalletsFromJobs.length, 'trading wallets from backend database');
      console.log('🔗 IMPROVED: Trading wallet details:', tradingWalletsFromJobs.map(tw => `${tw.name} (${tw.publicKey}) - Has strategies: ${tw.hasStrategies}`));
      setTradingWallets(tradingWalletsFromJobs);
      
      // Cache for next time (only if we actually got backend data)
      if (allJobs.length > 0) {
        localStorage.setItem(cacheKey, JSON.stringify(allJobs));
        console.log('💾 Cached all jobs to localStorage');
      }
    } catch (error) {
      console.error('❌ Backend fallback failed:', error);
      setJobs([]); // Fallback to empty
    }
  };

  // Load jobs from localStorage when wallet connects
  useEffect(() => {
    if (wallet.publicKey) {
      loadJobsWithBackendFallback();
    } else {
      // Clear jobs and trading wallets when wallet disconnects
      setJobs([]);
      setTradingWallets([]);
      // Only clear wallet selection if we actually had wallets before (not initial load)
      if (tradingWallets.length > 0) {
        handleSetSelectedTradingWallet(null);
      }
      // Also sign out when wallet disconnects
      authService.signOut().catch(error => console.error('Error signing out:', error));
    }
  }, [wallet.publicKey]);

  // Save jobs to localStorage whenever they change (with safety check)
  useEffect(() => {
    if (wallet.publicKey && jobs.length > 0) {
      const cacheKey = `jobs_${wallet.publicKey.toString()}`;
      console.log('💾 Auto-saving', jobs.length, 'jobs to localStorage');
      localStorage.setItem(cacheKey, JSON.stringify(jobs));
    }
    // Note: We don't clear localStorage when jobs.length === 0 to prevent data loss
  }, [jobs, wallet.publicKey]);

  // Add effect to set default withdraw address
  useEffect(() => {
    if (wallet.publicKey) {
      setWithdrawAddress(wallet.publicKey.toString());
    }
  }, [wallet.publicKey]);

  // Add function to generate unique wallet name
  const generateUniqueWalletName = (baseName: string, existingWallets: TradingWallet[]): string => {
    if (!existingWallets.some(w => w.name === baseName)) {
      return baseName;
    }

    let counter = 1;
    let newName = `${baseName}'`;
    while (existingWallets.some(w => w.name === newName)) {
      counter++;
      newName = `${baseName}${"'".repeat(counter)}`;
    }
    return newName;
  };

  const saveTradingWallet = async (newWallet: TradingWallet) => {
    if (!wallet.publicKey) return;
    
    // Save to localStorage (including sensitive data)
    const storedWallets = localStorage.getItem('tradingWallets');
    const allWallets: StoredTradingWallets = storedWallets ? JSON.parse(storedWallets) : {};
    const ownerAddress = wallet.publicKey.toString();
    
    // Generate unique name if needed
    const baseName = newWallet.name || `Trading Wallet ${(allWallets[ownerAddress] || []).length + 1}`;
    const uniqueName = generateUniqueWalletName(baseName, allWallets[ownerAddress] || []);
    
    const walletToSave = {
      ...newWallet,
      name: uniqueName,
      createdAt: Date.now()
    };
    
    allWallets[ownerAddress] = [...(allWallets[ownerAddress] || []), walletToSave];
    
    localStorage.setItem('tradingWallets', JSON.stringify(allWallets));
    setTradingWallets(allWallets[ownerAddress]);
    handleSetSelectedTradingWallet(walletToSave);  // Auto-select newly created wallet

    // Save to database (including secret key)
    try {
      await tradingWalletService.saveWallet(ownerAddress, walletToSave);
    } catch (error) {
      console.error('Error saving trading wallet to database:', error);
      // Don't throw the error - we still want to keep the wallet in localStorage
    }
  };

  const generateTradingWallet = async () => {
    if (!wallet.publicKey) return;

    try {
      // Always sign in with the currently connected wallet first
      const mainWalletAddress = wallet.publicKey.toString();
      const token = await authService.signIn(mainWalletAddress);
      if (!token) {
        setNotification({
          message: 'Failed to authenticate with wallet',
          type: 'error'
        });
        return;
      }

      // Check wallet limit
      const allWallets = JSON.parse(localStorage.getItem('tradingWallets') || '{}');
      const existingWallets = allWallets[mainWalletAddress] || [];
      if (existingWallets.length >= 3) {
        setShowWalletLimitDialog(true);
        return;
      }

      // Generate unique name
      const baseName = `Trading Wallet ${existingWallets.length + 1}`;
      const uniqueName = generateUniqueWalletName(baseName, existingWallets);

      // Call backend to create wallet
      const backendWallet = await tradingWalletService.saveWallet(mainWalletAddress, { name: uniqueName });

      if (!backendWallet) {
        setNotification({
          message: 'Failed to create wallet on backend',
          type: 'error'
        });
        return;
      }

      // Update localStorage and state with backendWallet
      const walletForStorage = {
        ...backendWallet,
        secretKey: undefined,
        mnemonic: '', // if needed
      };
      allWallets[mainWalletAddress] = [...existingWallets, walletForStorage];
      localStorage.setItem('tradingWallets', JSON.stringify(allWallets));
      setTradingWallets([...existingWallets, walletForStorage]);
      setNotification({
        message: 'Trading wallet created successfully!',
        type: 'success'
      });
    } catch (error) {
      setNotification({
        message: error instanceof Error ? error.message : 'Error creating trading wallet',
        type: 'error'
      });
      console.error('Error generating trading wallet:', error);
    }
  };

  // Helper function to compare balance arrays
  const balancesAreEqual = (balances1: any[], balances2: any[]) => {
    if (!balances1 || !balances2 || balances1.length !== balances2.length) return false;
    
    return balances1.every((balance1, index) => {
      const balance2 = balances2[index];
      return balance1.mint === balance2.mint && 
             balance1.balance === balance2.balance &&
             balance1.decimals === balance2.decimals;
    });
  };

  // Add this function near the top of the file, after imports
  function hasSignificantBalanceChange(oldBalances: any[], newBalances: any[]): boolean {
    console.log('Checking balance changes:', { oldBalances, newBalances });
    
    if (!oldBalances || !newBalances) {
      console.log('Missing balances, treating as significant change');
      return true;
    }
    if (oldBalances.length !== newBalances.length) {
      console.log('Balance array lengths differ, treating as significant change');
      return true;
    }

    for (const newBalance of newBalances) {
      const oldBalance = oldBalances.find(b => b.mint === newBalance.mint);
      if (!oldBalance) {
        console.log(`New balance for mint ${newBalance.mint} not found in old balances, treating as significant change`);
        return true;
      }
      
      // For SOL, consider changes greater than 0.0001 SOL significant
      if (newBalance.mint === 'So11111111111111111111111111111111111111112') {
        const oldAmount = oldBalance.balance / Math.pow(10, oldBalance.decimals);
        const newAmount = newBalance.balance / Math.pow(10, newBalance.decimals);
        const difference = Math.abs(newAmount - oldAmount);
        console.log(`SOL balance comparison:`, { 
          oldAmount, 
          newAmount, 
          difference, 
          threshold: 0.0001,
          isSignificant: difference > 0.0001 
        });
        if (difference > 0.0001) {
          console.log('SOL balance change is significant');
          return true;
        }
      } else {
        // For other tokens, consider changes greater than 0.1% significant
        const oldAmount = oldBalance.balance / Math.pow(10, oldBalance.decimals);
        const newAmount = newBalance.balance / Math.pow(10, newBalance.decimals);
        if (oldAmount === 0 && newAmount === 0) continue;
        const change = Math.abs(newAmount - oldAmount) / (oldAmount || 1);
        console.log(`Token ${newBalance.symbol || newBalance.mint} balance comparison:`, { 
          oldAmount, 
          newAmount, 
          change, 
          threshold: 0.001,
          isSignificant: change > 0.001 
        });
        if (change > 0.001) {
          console.log(`Token balance change is significant for ${newBalance.symbol || newBalance.mint}`);
          return true;
        }
      }
    }
    console.log('No significant balance changes detected');
    return false;
  }

  // Add these near the top of the file with other state declarations
  const [walletBalances, setWalletBalances] = useState<Map<string, any[]>>(new Map());

  // fetch Backend Balances - Add this helper function
  const fetchBackendBalances = async (walletAddress: string) => {
    try {
      console.log('Fetching balances from backend for:', walletAddress);
      const response = await fetch(`${API_CONFIG.WALLET.BALANCES}/${walletAddress}`);
      if (!response.ok) {
        throw new Error(`Backend error: ${response.statusText}`);
      }
      const data = await response.json();
      console.log('Backend balances:', JSON.stringify(data, null, 2));

      // Get current balances from the wallet balance service
      const currentBalances = await walletBalanceService.fetchBalances(walletAddress);

      // Check if balances have significantly changed
      if (!hasSignificantBalanceChange(Object.values(currentBalances), data.balances)) {
        console.log('Balance data unchanged for wallet:', walletAddress);
        return null; // Return null to signal no processing needed
      }

      // Update balances using the wallet balance service
      await walletBalanceService.updateBalances(walletAddress);

      return data;
    } catch (error) {
      console.error('Error fetching from backend:', error);
      return null;
    }
  };

  // Update fetchTradingWalletBalance to fetch all balances
  const fetchTradingWalletBalances = async () => {
    if (!connection || isUpdatingBalances) return;
    
    try {
      setIsUpdatingBalances(true);
      
      const balancePromises = tradingWallets.map(async (tw) => {
        try {
          // Get SOL balance from chain
          const balance = await connection.getBalance(new PublicKey(tw.publicKey));
          const solBalance = balance / LAMPORTS_PER_SOL;
          
          // Get token accounts
          const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            new PublicKey(tw.publicKey),
            { programId: TOKEN_PROGRAM_ID }
          );

          // Calculate total value in SOL
          let totalValue = solBalance;

          // Update the trading wallet balances state
          setTradingWalletBalances((prev: Record<string, number>) => ({
            ...prev,
            [tw.publicKey]: totalValue
          }));

          // Update backend with new balance
          try {
            await fetch(API_CONFIG.WALLET.UPDATE(tw.publicKey), {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
              },
            });

            // Wait a moment for the update to complete
            await new Promise(resolve => setTimeout(resolve, 500));

            // Fetch updated balances from backend
            const backendBalances = await fetchBackendBalances(tw.publicKey);
            if (backendBalances && backendBalances.balances && backendBalances.balances.length > 0) {
              const solBalance = backendBalances.balances.find((b: { symbol: string }) => b.symbol === 'SOL');
              if (solBalance) {
                totalValue = solBalance.balance;
                
                // Update trading wallet balances with the latest value
                setTradingWalletBalances((prev: Record<string, number>) => ({
                  ...prev,
                  [tw.publicKey]: totalValue
                }));

                // Update total portfolio value immediately
                setTotalPortfolioValue((prevTotal: number) => prevTotal + totalValue);
              }
            }
          } catch (error) {
            console.error('Error updating backend balances:', error);
          }

          return totalValue;
        } catch (error) {
          console.error(`Error fetching balance for wallet ${tw.publicKey}:`, error);
          return 0;
        }
      });

      const balances = await Promise.all(balancePromises);
      const totalValue = balances.reduce((sum: number, val: number) => sum + val, 0);
      
      // Update total portfolio value
      setTotalPortfolioValue(totalValue);
      
      // Clear any existing timeout
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      
      // Schedule next update
      updateTimeoutRef.current = setTimeout(fetchTradingWalletBalances, 15000);
      
    } catch (error) {
      console.error('Error fetching trading wallet balances:', error);
    } finally {
      setIsUpdatingBalances(false);
    }
  };

  // Debounced version of balance update
  const debouncedBalanceUpdate = useCallback(
    debounce(() => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      updateTimeoutRef.current = setTimeout(() => {
        fetchTradingWalletBalances();
      }, 1000);
    }, 2000),
    [connection, tradingWallets]
  );

  useEffect(() => {
    if (tradingWallets.length === 0) return;
    
    // Initial fetch
    fetchTradingWalletBalances();
    
    // Set up interval with longer delay
    const interval = setInterval(debouncedBalanceUpdate, 30000); // Update every 30 seconds
    
    // Clean up
    return () => {
      clearInterval(interval);
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
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
                className={`${walletStyles.walletItem} ${selectedTradingWallet?.publicKey === tw.publicKey ? walletStyles.active : ''}`}
                onClick={() => handleSetSelectedTradingWallet(tw)}
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
                      key={tw.publicKey + ':' + (backendBalancesByWallet[tw.publicKey]?.[0]?.balance ?? 0)}
                      walletAddress={tw.publicKey}
                      connection={connection}
                      tradingWallet={tw}
                      displayMode="total-only"
                      onRpcError={onRpcError}
                      wallet={wallet}
                      backendBalances={backendBalancesByWallet[tw.publicKey]}
                      refreshCount={refreshCount}
                      isBackgroundRefresh={isBackgroundRefresh}
                      triggerBackendPolling={backendPollingWallet === tw.publicKey}
                      onBackendPollingComplete={() => handleBackendPollingComplete(tw.publicKey)}
                      onTotalValueChange={(value) => handleTotalValueChange(tw.publicKey, value)}
                    />
                  </div>
                </div>
                
                {/* Strategy badges */}
                <div className={walletStyles.strategyBadgesContainer}>
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
                              levelsJob.levels && levelsJob.levels.length > 0 ? `${levelsJob.levels.length} Level${levelsJob.levels.length !== 1 ? 's' : ''} Set` : 'No Levels Set',
                              levelsJob.levels && levelsJob.levels.length > 0 ? levelsJob.levels.map(level => `$${level.price}: ${level.percentage}%`).join(', ') : null,
                              levelsJob.lastActivity ? `Last Activity: ${new Date(levelsJob.lastActivity).toLocaleString()}` : null,
                              levelsJob.lastTriggerPrice ? `Last Trigger: $${levelsJob.lastTriggerPrice}` : null
                            ].filter(Boolean)
                          };
                        case JobType.PAIR_TRADE:
                          const pairTradeJob = job as PairTradeJob;
                          return {
                            title: 'Pair Trade',
                            details: [
                              `Pair: ${pairTradeJob.tokenASymbol} ↔ ${pairTradeJob.tokenBSymbol}`,
                              `Automated allocation based on valuation`,
                              `Allocation: ${pairTradeJob.allocationPercentage}%`,
                              `Max Slippage: ${pairTradeJob.maxSlippage}%`,
                              pairTradeJob.lastSwapTimestamp ? `Last Swap: ${new Date(pairTradeJob.lastSwapTimestamp).toLocaleString()}` : null,
                              pairTradeJob.swapHistory && pairTradeJob.swapHistory.length > 0 ? `Swaps: ${pairTradeJob.swapHistory.length}` : null
                            ].filter(Boolean)
                          };
                        case JobType.DRIFT_PERP:
                          const driftPerpJob = job as DriftPerpJob;
                          return {
                            title: 'Drift Perp',
                            details: [
                              `Market: ${driftPerpJob.marketSymbol}`,
                              `Direction: ${driftPerpJob.direction.toUpperCase()}`,
                              `Entry: $${driftPerpJob.entryPrice} → Exit: $${driftPerpJob.exitPrice}`,
                              `Leverage: ${driftPerpJob.leverage}x`,
                              `Allocation: ${driftPerpJob.allocationPercentage}% of SOL`,
                              driftPerpJob.isPositionOpen ? '🟢 Position Open' : '🔴 No Position',
                              driftPerpJob.currentPosition ? `PnL: $${driftPerpJob.currentPosition.unrealizedPnl.toFixed(2)}` : null,
                              driftPerpJob.orderHistory && driftPerpJob.orderHistory.length > 0 ? `Orders: ${driftPerpJob.orderHistory.length}` : null
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

                    const uniqueStrategyKey = job.type === JobType.PRICE_MONITOR 
                      ? `${job.id}_${job.tradingWalletPublicKey}_${(job as PriceMonitoringJob).targetPrice}_${(job as PriceMonitoringJob).direction}_${(job as PriceMonitoringJob).percentageToSell}`
                      : `${job.id}_${job.tradingWalletPublicKey}_${job.type}`;

                    return (
                      <div 
                        key={uniqueStrategyKey}
                        className={`${walletStyles.strategyBadge} ${isPaused ? walletStyles.strategyBadgePaused : ''}`}
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
                          ) : job.type === JobType.PAIR_TRADE ? (
                            <PairTradeIcon
                              isActive={job.isActive && !pausedJobs.has(job.id)}
                              onClick={() => toggleJobPause(job.id)}
                            />
                          ) : job.type === JobType.DRIFT_PERP ? (
                            <DriftPerpIcon
                              isActive={job.isActive && !pausedJobs.has(job.id)}
                              onClick={() => toggleJobPause(job.id)}
                            />
                          ) : '❓'}
                        </span>
                        {job.profitTracking && (
                          <span style={{
                            color: job.profitTracking.percentageChange >= 0 ? '#22c55e' : '#ef4444',
                            fontSize: '0.75rem',
                            fontWeight: '500',
                            marginLeft: '0.25rem'
                          }}>
                            {job.profitTracking.percentageChange > 0 ? '+' : ''}
                            {job.profitTracking.percentageChange.toFixed(2)}%
                          </span>
                        )}
                        <div className={walletStyles.strategyMenu}>
                          <div className={walletStyles.strategyMenuHeader}>
                            {strategyInfo.title}
                            {job.profitTracking && (
                              <div style={{
                                fontSize: '0.75rem',
                                color: job.profitTracking.percentageChange >= 0 ? '#22c55e' : '#ef4444',
                                marginTop: '0.25rem'
                              }}>
                                Profit/Loss: {job.profitTracking.percentageChange > 0 ? '+' : ''}
                                {job.profitTracking.percentageChange.toFixed(2)}%
                                <span style={{ 
                                  fontSize: '0.625rem',
                                  backgroundColor: job.profitTracking.percentageChange >= 0 ? '#15803d' : '#991b1b',
                                  padding: '0.125rem 0.25rem',
                                  borderRadius: '0.25rem',
                                  marginLeft: '0.5rem'
                                }}>
                                  {job.profitTracking.totalProfitSOL.toFixed(4)} SOL (${job.profitTracking.totalProfitUSD.toFixed(2)})
                                </span>
                              </div>
                            )}
                          </div>
                          <div className={walletStyles.strategyMenuDetails}>
                            {strategyInfo.details.map((detail, index) => (
                              <div key={index} className={walletStyles.strategyMenuDetail}>{detail}</div>
                            ))}
                          </div>
                          <div className={walletStyles.strategyMenuDivider} />
                          <button 
                            className={walletStyles.strategyMenuButton}
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
                            className={`${walletStyles.strategyMenuButton} ${walletStyles.strategyMenuButtonDanger}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setLackeyToDelete({ id: job.id, name: job.name });
                              setShowDeleteLackeyDialog(true);
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
                        setFundingWallet(tw);
                        setFundingAmount('');
                      }}
                      className={`${walletStyles.button} ${walletStyles.primary}`}
                    >
                      Fund
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedWalletId(expandedWalletId === tw.publicKey ? null : tw.publicKey);
                        setShowPrivateKey(null);
                      }}
                      className={walletStyles.menuButton}
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
                      className={walletStyles.button}
                    >
                      Fund Wallet
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(tw.publicKey)}
                      className={walletStyles.button}
                    >
                      Copy Public Key
                    </button>
                    <button
                      onClick={() => setShowPrivateKey(showPrivateKey === tw.publicKey ? null : tw.publicKey)}
                      className={`${walletStyles.button} ${showPrivateKey === tw.publicKey ? walletStyles.danger : ''}`}
                    >
                      {showPrivateKey === tw.publicKey ? 'Hide Private Key' : 'Show Private Key'}
                    </button>
                    <button
                      onClick={async () => {
                        if (!wallet.publicKey || !connection) return;
                        try {
                          const balance = await connection.getBalance(new PublicKey(tw.publicKey));
                          if (balance <= 5000) {
                            setNotification({ 
                              type: 'error', 
                              message: 'Insufficient balance to withdraw (minimum 0.000005 SOL required)' 
                            });
                            return;
                          }

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
                          
                          // Get the secret key from localStorage and decode from base64
                          const privateKey = localStorage.getItem(`wallet_${tw.publicKey}`);
                          if (!privateKey) {
                            throw new Error('Trading wallet private key not found');
                          }

                          // Decode the base64 string to Uint8Array
                          const secretKey = new Uint8Array(Buffer.from(privateKey, 'base64'));
                          const tradingKeypair = Keypair.fromSecretKey(secretKey);
                          
                          transaction.sign([tradingKeypair]);
                          
                          const signature = await connection.sendTransaction(transaction);
                          console.log('Withdrawal sent:', signature);
                          
                          // Show initial notification
                          setNotification({ 
                            type: 'info', 
                            message: 'Transaction sent, waiting for confirmation...' 
                          });

                          // Use improved confirmation method with shorter timeouts
                          let confirmed = false;
                          const maxRetries = 30; // 30 attempts at 1 second intervals = max 30 seconds
                          let retryCount = 0;

                          // First, try a quick confirmation attempt (5 seconds max)
                          try {
                            // Set a short timeout for the initial confirmation attempt
                            const confirmationPromise = connection.confirmTransaction(signature, 'confirmed');
                            const timeoutPromise = new Promise((_, reject) => 
                              setTimeout(() => reject(new Error('Quick confirmation timeout')), 5000)
                            );
                            
                            await Promise.race([confirmationPromise, timeoutPromise]);
                            confirmed = true;
                            console.log('Transaction confirmed quickly');
                          } catch (err) {
                            console.log('Quick confirmation failed, polling transaction status...');
                            
                            // If quick confirmation fails, poll for status
                            while (retryCount < maxRetries && !confirmed) {
                              try {
                                const status = await connection.getSignatureStatus(signature);
                                console.log(`Status check ${retryCount + 1}/${maxRetries}:`, status.value);
                                
                                if (status.value?.confirmationStatus === 'confirmed' || 
                                    status.value?.confirmationStatus === 'finalized') {
                                  confirmed = true;
                                  console.log('Transaction confirmed via status polling');
                                  break;
                                }
                                
                                if (status.value?.err) {
                                  throw new Error(`Transaction failed: ${status.value.err}`);
                                }
                                
                                retryCount++;
                                if (retryCount < maxRetries) {
                                  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between checks
                                }
                              } catch (statusError) {
                                console.error('Error checking transaction status:', statusError);
                                retryCount++;
                                if (retryCount < maxRetries) {
                                  await new Promise(resolve => setTimeout(resolve, 1000));
                                }
                              }
                            }
                          }

                          if (confirmed) {
                            console.log('Withdrawal confirmed');
                            
                            setNotification({ 
                              type: 'success', 
                              message: 'Successfully returned SOL to main wallet!' 
                            });

                            // Force refresh by incrementing refresh count
                            setRefreshCount(prev => prev + 1);
                            
                            // Dispatch balance update event
                            window.dispatchEvent(new Event('update-balances'));
                            
                            // Update backend balances
                            setTimeout(async () => {
                              try {
                                await walletBalanceService.updateBalances(tw.publicKey);
                                await fetchTradingWalletBalances();
                              } catch (updateError) {
                                console.error('Background balance update error:', updateError);
                              }
                            }, 1000);
                            
                            console.log('Balance updates completed');
                          } else {
                            // If still not confirmed after all retries
                            setNotification({ 
                              type: 'warning', 
                              message: `Transaction sent but not confirmed after ${maxRetries} seconds. Check Solana Explorer: ${signature}` 
                            });
                          }
                        } catch (error) {
                          console.error('Error withdrawing:', error);
                          setNotification({ 
                            type: 'error', 
                            message: error instanceof Error ? error.message : 'Failed to withdraw SOL' 
                          });
                        }
                      }}
                      className={walletStyles.button}
                    >
                      Return All SOL To Main Wallet
                    </button>
                    <button
                      onClick={() => {
                        handleDeleteWallet(tw);
                      }}
                      className={`${walletStyles.button} ${walletStyles.danger}`}
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
                          // Convert from base64 to Uint8Array directly
                          const privateKeyBytes = new Uint8Array(Buffer.from(privateKeyStr, 'base64'));
                          return bs58.encode(privateKeyBytes);
                        })()}
                      </div>
                      <button
                        onClick={() => {
                          const privateKeyStr = localStorage.getItem(`wallet_${tw.publicKey}`);
                          if (!privateKeyStr) return;
                          // Convert from base64 to Uint8Array directly
                          const privateKeyBytes = new Uint8Array(Buffer.from(privateKeyStr, 'base64'));
                          navigator.clipboard.writeText(bs58.encode(privateKeyBytes));
                        }}
                        className={walletStyles.button}
                      >
                        Copy Private Key
                      </button>
                    </div>
                  )}

                  {/* Token Balances */}
                  <div style={{ marginTop: '1rem' }}>
                    <div style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>Token Balances:</div>
                    <TokenBalancesList 
                      key={tw.publicKey + ':' + (backendBalancesByWallet[tw.publicKey]?.[0]?.balance ?? 0)}
                      walletAddress={tw.publicKey}
                      connection={connection}
                      tradingWallet={tw}
                      onRpcError={onRpcError}
                      wallet={wallet}
                      backendBalances={backendBalancesByWallet[tw.publicKey]}
                      refreshCount={refreshCount}
                      isBackgroundRefresh={isBackgroundRefresh}
                      triggerBackendPolling={backendPollingWallet === tw.publicKey}
                      onBackendPollingComplete={() => handleBackendPollingComplete(tw.publicKey)}
                      onTotalValueChange={(value) => handleTotalValueChange(tw.publicKey, value)}
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

  // Update createJob function to use StrategyService
  const createJob = async () => {
    if (!selectedTradingWallet || !monitoredWallet || !isValidAddress) {
      setNotification({
        message: 'Please select a trading wallet and enter a valid wallet address to monitor',
        type: 'error'
      });
      return;
    }

    try {
      // Check if user is authenticated
      const token = await authService.getSession();
      if (!token) {
        // If not authenticated, try to sign in with the wallet address
        const walletAddress = wallet.publicKey?.toBase58();
        if (!walletAddress) {
          setNotification({
            message: 'Please connect your wallet first',
            type: 'error'
          });
          return;
        }

        const newToken = await authService.signIn(walletAddress);
        if (!newToken) {
          setNotification({
            message: 'Failed to authenticate. Please try again.',
            type: 'error'
          });
          return;
        }
      }

      // Validate the monitored wallet address
      new PublicKey(monitoredWallet);

      const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;

      const strategyInstance = StrategyService.getInstance(connection);

      // Look up saved wallet name if it exists
      let walletName: string | undefined;
      try {
        const savedWallets = await savedWalletsApi.getAll(wallet.publicKey!.toString());
        console.log('Saved wallets fetched:', savedWallets);
        console.log('Looking for wallet address:', monitoredWallet);
        const foundWallet = savedWallets.find(w => w.wallet_address === monitoredWallet);
        console.log('Found wallet:', foundWallet);
        walletName = foundWallet?.name;
        console.log('Wallet name to use:', walletName);
      } catch (error) {
        console.log('Could not fetch saved wallets for name lookup:', error);
      }

      // Always create a new job and use the backend's returned id
      const newJob = await strategyInstance.createWalletMonitorStrategy({
        tradingWallet: selectedTradingWallet,
        initialBalance,
        solPrice,
        walletAddress: monitoredWallet,
        percentage: autoTradePercentage,
        name: walletName
      });

      // Add job to manager
      jobManagerRef.current?.addJob(newJob);

      // Remove any previous job for this trading wallet and monitored wallet, then add the new job
      setJobs(prevJobs => [
        ...prevJobs.filter(job =>
          !(
            job.tradingWalletPublicKey === selectedTradingWallet.publicKey &&
            job.type === JobType.WALLET_MONITOR &&
            (job as WalletMonitoringJob).walletAddress === monitoredWallet
          )
        ),
        newJob
      ]);

      setNotification({
        message: 'Created new wallet monitor strategy',
        type: 'success'
      });

      setMonitoredWallet('');
      setIsValidAddress(false);
    } catch (error) {
      console.error('Error creating job:', error);
      setNotification({
        message: error instanceof Error ? error.message : 'Failed to create job',
        type: 'error'
      });
    }
  };

  const handleOverrideConfirm = async () => {
    if (!existingJobId || !selectedTradingWallet || !monitoredWallet || !isValidAddress) return;

    try {
      // Remove the existing job
      setJobs(prevJobs => prevJobs.filter(job => job.id !== existingJobId));
      
      // Create the new job using StrategyService
      const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;

      const strategyInstance = StrategyService.getInstance(connection);
      const newJob = await strategyInstance.createWalletMonitorStrategy({
        tradingWallet: selectedTradingWallet,
        initialBalance,
        solPrice,
        walletAddress: monitoredWallet,
        percentage: autoTradePercentage
      });

      // Add job to manager
      jobManagerRef.current?.addJob(newJob);

      // Update local state
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
    // Also clear from localStorage
    if (wallet.publicKey) {
      const storedJobs = localStorage.getItem(`jobs_${wallet.publicKey.toString()}`);
      if (storedJobs) {
        const parsedJobs = JSON.parse(storedJobs);
        const filteredJobs = parsedJobs.filter((job: any) => job.id !== jobId);
        localStorage.setItem(`jobs_${wallet.publicKey.toString()}`, JSON.stringify(filteredJobs));
      }
    }
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
            
            // Update job's last activity immediately after confirmation
            job.lastActivity = new Date().toISOString();
            setJobs(prevJobs => prevJobs.map(j => j.id === job.id ? job : j));

            // Call onSuccess callback if provided
            if (typeof onSuccess === 'function') {
              onSuccess();
            }
            
            // Trigger balance update immediately
            window.dispatchEvent(new CustomEvent('update-balances'));
            
            break;
          } catch (error) {
            retryCount++;
            if (retryCount === 3) throw error;
            await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
          }
        }

        console.log('Transaction confirmed:', signature);

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

  const handleSuccessfulTransaction = async (walletPublicKey: string) => {
    try {
      // Show initial notification
      setNotification({ type: 'info', message: 'Transaction confirmed! Updating balances...' });
      console.log('Updating balances...');

      // First get the chain balance
      const chainBalance = await connection.getBalance(new PublicKey(walletPublicKey));
      console.log('Chain balance:', chainBalance / LAMPORTS_PER_SOL, 'SOL');

      // Update backend with new balance
      const updateResponse = await fetch(API_CONFIG.WALLET.UPDATE(walletPublicKey), {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!updateResponse.ok) {
        throw new Error('Failed to update backend balances');
      }

      // Now fetch the updated balances
      const balances = await fetchBackendBalances(walletPublicKey);
      console.log('Backend balances:', balances);

      // Update local state with the chain balance immediately
      setTradingWalletBalances(prev => {
        const newBalances = { ...prev };
        newBalances[walletPublicKey] = chainBalance / LAMPORTS_PER_SOL;
        
        // Calculate new total portfolio value
        const totalValue = Object.values(newBalances).reduce((sum, val) => sum + val, 0);
        setTotalPortfolioValue(totalValue);
        
        return newBalances;
      });

      // Force a UI update by dispatching multiple events
      window.dispatchEvent(new CustomEvent('balanceUpdate', {
        detail: { walletAddress: walletPublicKey }
      }));
      window.dispatchEvent(new Event('update-balances'));

      // Schedule another update after 2 seconds
      setTimeout(async () => {
        await fetchTradingWalletBalances();
      }, 2000);

      // Show success notification
      setNotification({ type: 'success', message: 'Balances updated successfully!' });

    } catch (error) {
      console.error('Error updating balances:', error);
      setNotification({ 
        type: 'error', 
        message: 'Failed to update balances. Please try refreshing manually.' 
      });
    }
  };

  // Add toggle function for strategy expansion
  const toggleStrategy = (strategyName: string) => {
    setExpandedStrategy(expandedStrategy === strategyName ? null : strategyName);
  };

  // Add helper function to create initial profit tracking
  const createInitialProfitTracking = (initialBalance: number, currentPrice: number) => ({
    initialBalance,
    initialValue: initialBalance * currentPrice,
    currentBalance: initialBalance,
    currentValue: initialBalance * currentPrice,
    totalProfitSOL: 0,
    totalProfitUSD: 0,
    percentageChange: 0,
    lastUpdated: new Date().toISOString()
  });

  // Update createPriceMonitorJob to parse sellPercentage
  const createPriceMonitorJob = async () => {
    if (!selectedTradingWallet || !targetPrice) return;

    try {
      const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;

      const strategyInstance = StrategyService.getInstance(connection);
      const percentageToSell = sellPercentage === '' ? 0 : Number(sellPercentage);
      const newJob = await strategyInstance.createPriceMonitorStrategy({
        tradingWallet: selectedTradingWallet,
        initialBalance,
        solPrice,
        targetPrice,
        direction: priceDirection,
        percentageToSell
      });

      // Update local state
      setJobs(prevJobs => [...prevJobs, newJob]);
      setTargetPrice(0);
      setPriceDirection('above');
      setSellPercentage('');
    } catch (error) {
      console.error('Error creating price monitor strategy:', error);
      setNotification({
        message: error instanceof Error ? error.message : 'Failed to create price monitor strategy',
        type: 'error'
      });
    }
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

  // Update createVaultStrategy to parse vaultPercentage
  const createVaultStrategy = async () => {
    if (!selectedTradingWallet) {
      setNotification({
        message: 'Please select a trading wallet first',
        type: 'error'
      });
      return;
    }

    try {
      const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;

      const strategyInstance = StrategyService.getInstance(connection);
      const vaultPercent = vaultPercentage === '' ? 0 : Number(vaultPercentage);
      // Check if a vault strategy already exists for this trading wallet
      const existingJob = jobs.find(
        job => 
          job.tradingWalletPublicKey === selectedTradingWallet.publicKey && 
          job.type === JobType.VAULT
      );

      const newJob = await strategyInstance.createVaultStrategy({
        tradingWallet: selectedTradingWallet,
        initialBalance,
        solPrice,
        vaultPercentage: vaultPercent
      });

      // Add job to manager
      jobManagerRef.current?.addJob(newJob);

      // Update local state
      if (existingJob) {
        setJobs(prevJobs => prevJobs.map(job => 
          job.id === existingJob.id ? newJob : job
        ));
        setNotification({
          message: 'Updated existing vault strategy',
          type: 'success'
        });
      } else {
        setJobs(prevJobs => [...prevJobs, newJob]);
        setNotification({
          message: 'Created new vault strategy',
          type: 'success'
        });
      }

      setVaultPercentage('0.5'); // Reset to default
    } catch (error) {
      console.error('Error creating vault strategy:', error);
      setNotification({
        message: error instanceof Error ? error.message : 'Failed to create vault strategy',
        type: 'error'
      });
    }
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

    try {
        const ownerAddress = wallet.publicKey.toString();
        const existingWallets = tradingWallets;

        // Check if importing would exceed the limit
        if (existingWallets.length + mergedWallets.length > 3) {
            setShowWalletLimitDialog(true);
            return;
        }

        // Process each wallet
        for (const importedWallet of mergedWallets) {
            // Store the secret key in wallet_<publickey> format
            storeWalletSecretKey(importedWallet.publicKey, importedWallet.secretKey);
            
            // Save to backend
            try {
                await tradingWalletService.saveWallet(ownerAddress, importedWallet);
            } catch (error) {
                console.warn('Error saving imported wallet to backend:', error);
            }
        }

        // Update local state
        const allWallets = {
            [ownerAddress]: mergedWallets
        };
        localStorage.setItem('tradingWallets', JSON.stringify(allWallets));
        setTradingWallets(mergedWallets);
        
        setNotification({
            message: 'Wallets imported successfully',
            type: 'success'
        });
    } catch (error) {
        console.error('Error importing wallets:', error);
        setNotification({
            message: 'Failed to import wallets',
            type: 'error'
        });
    }
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

  // Update createLevelsStrategy to parse newLevelPercentage
  const createLevelsStrategy = async () => {
    if (!selectedTradingWallet) {
      setNotification({
        message: 'Please select a trading wallet first',
        type: 'error'
      });
      return;
    }

    if (levels.length === 0) {
      setNotification({
        message: 'Please add at least one price level',
        type: 'error'
      });
      return;
    }

    try {
      const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;

      const strategyInstance = StrategyService.getInstance(connection);
      // Check if a levels strategy already exists for this trading wallet
      const existingJob = jobs.find(
        job => 
          job.tradingWalletPublicKey === selectedTradingWallet.publicKey && 
          job.type === JobType.LEVELS
      );

      const newJob = await strategyInstance.createLevelsStrategy({
        tradingWallet: selectedTradingWallet,
        initialBalance,
        solPrice,
        levels: levels
      });

      // Add job to manager
      jobManagerRef.current?.addJob(newJob);

      // Update local state
      if (existingJob) {
        setJobs(prevJobs => prevJobs.map(job => 
          job.id === existingJob.id ? newJob : job
        ));
        setNotification({
          message: 'Updated existing levels strategy',
          type: 'success'
        });
      } else {
        setJobs(prevJobs => [...prevJobs, newJob]);
        setNotification({
          message: 'Created new levels strategy',
          type: 'success'
        });
      }

      // Reset levels
      setLevels([]);
      setNewLevelPercentage('');
    } catch (error) {
      console.error('Error creating levels strategy:', error);
      setNotification({
        message: error instanceof Error ? error.message : 'Failed to create levels strategy',
        type: 'error'
      });
    }
  };

  const loadSupportedTokens = async (retryCount = 0) => {
    if (isLoadingTokens) return;
    
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds
    
    setIsLoadingTokens(true);
    try {
      console.log('🪙 Frontend: Loading supported tokens...');
      console.log('🪙 Frontend: Auth token available:', !!authService.getToken());
      console.log('🪙 Frontend: Making API call to /strategies/tokens/supported');
      
      const response = await apiClient.get('/strategies/tokens/supported');
      
      console.log('🪙 Frontend: API response status:', response.status);
      console.log('🪙 Frontend: API response data:', response.data);
      console.log('🪙 Frontend: Number of tokens received:', response.data?.length || 0);
      
      if (response.data && Array.isArray(response.data)) {
        const activeTokens = response.data.filter(token => token.isActive);
        console.log('🪙 Frontend: Active tokens:', activeTokens.length);
        console.log('🪙 Frontend: Active token details:', activeTokens.map(t => ({ 
          symbol: t.symbol, 
          name: t.name, 
          logoURI: t.logoURI,
          hasLogo: !!t.logoURI 
        })));
        
        // Debug logo URIs specifically
        const tokensWithLogos = activeTokens.filter(t => t.logoURI);
        const tokensWithoutLogos = activeTokens.filter(t => !t.logoURI);
        console.log('🖼️ Tokens WITH logos:', tokensWithLogos.length, tokensWithLogos.map(t => `${t.symbol}: ${t.logoURI?.slice(0, 50)}...`));
        console.log('❌ Tokens WITHOUT logos:', tokensWithoutLogos.length, tokensWithoutLogos.map(t => t.symbol));
      }
      
      setSupportedTokens(response.data || []);
      console.log('✅ Frontend: Tokens set in state successfully');
    } catch (error) {
      console.error('❌ Frontend: Error loading supported tokens:', error);
      console.error('❌ Frontend: Error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      
      // Retry logic for 401 errors
      if (error.response?.status === 401 && retryCount < maxRetries) {
        console.log(`🔄 Retrying token load (attempt ${retryCount + 1}/${maxRetries}) in ${retryDelay/1000} seconds...`);
        setIsLoadingTokens(false); // Reset loading state for retry
        setTimeout(() => {
          loadSupportedTokens(retryCount + 1);
        }, retryDelay);
        return;
      }
      
      // Only show error notification after all retries failed
      if (retryCount >= maxRetries) {
        setNotification({
          message: 'Failed to load supported tokens after multiple attempts',
          type: 'error'
        });
      }
    } finally {
      setIsLoadingTokens(false);
    }
  };

  // Fetch available Drift markets with leverage info
  const fetchDriftMarkets = async () => {
    if (isDriftMarketsLoading) return;
    
    setIsDriftMarketsLoading(true);
    try {
      console.log('📊 Loading Drift markets...');
      
      const response = await fetch(`${API_CONFIG.API_BASE}/drift/markets`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch Drift markets: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('📊 Drift markets response:', data);
      
      if (data.success && Array.isArray(data.markets)) {
        setAvailableDriftMarkets(data.markets);
        console.log('✅ Loaded', data.markets.length, 'Drift markets');
        
        // Auto-select first market if none selected
        if (data.markets.length > 0 && !driftMarketSymbol) {
          const firstMarket = data.markets[0];
          setDriftMarketSymbol(firstMarket.symbol);
          setDriftMarketIndex(firstMarket.marketIndex);
        }
      }
    } catch (error) {
      console.error('❌ Error loading Drift markets:', error);
      console.log('📊 Using fallback Drift markets (server restart needed for API)');
      // Don't show error notification since fallback works perfectly
      
      // Fallback to hardcoded markets with different leverage limits
      const fallbackMarkets = [
        { marketIndex: 0, symbol: 'SOL-PERP', baseAssetSymbol: 'SOL', maxLeverage: 20 },
        { marketIndex: 1, symbol: 'BTC-PERP', baseAssetSymbol: 'BTC', maxLeverage: 15 },
        { marketIndex: 2, symbol: 'ETH-PERP', baseAssetSymbol: 'ETH', maxLeverage: 18 },
        { marketIndex: 3, symbol: 'AVAX-PERP', baseAssetSymbol: 'AVAX', maxLeverage: 12 },
        { marketIndex: 4, symbol: 'BNB-PERP', baseAssetSymbol: 'BNB', maxLeverage: 10 },
        { marketIndex: 5, symbol: 'MATIC-PERP', baseAssetSymbol: 'MATIC', maxLeverage: 8 }
      ];
      setAvailableDriftMarkets(fallbackMarkets);
    } finally {
      setIsDriftMarketsLoading(false);
    }
  };

  const createPairTradeStrategy = async () => {
    if (!selectedTradingWallet) {
      setNotification({
        message: 'Please select a trading wallet first',
        type: 'error'
      });
      return;
    }

    if (!pairTokenA || !pairTokenB) {
      setNotification({
        message: 'Please select both tokens for the pair',
        type: 'error'
      });
      return;
    }

    if (pairTokenA === pairTokenB) {
      setNotification({
        message: 'Please select different tokens for the pair',
        type: 'error'
      });
      return;
    }

    try {
      const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;

      const strategyInstance = StrategyService.getInstance(connection);
      
      // Check if a pair trade strategy already exists for this trading wallet
      const existingJob = jobs.find(
        job => 
          job.tradingWalletPublicKey === selectedTradingWallet.publicKey && 
          job.type === JobType.PAIR_TRADE
      );

      const newJob = await strategyInstance.createPairTradeStrategy({
        tradingWallet: selectedTradingWallet,
        initialBalance,
        tokenAMint: pairTokenA,
        tokenBMint: pairTokenB,
        tokenASymbol: pairTokenASymbol,
        tokenBSymbol: pairTokenBSymbol,
        allocationPercentage: Number(pairAllocationPercentage),
        maxSlippage: Number(pairMaxSlippage),
        autoRebalance: false
      });

      // Add job to manager
      jobManagerRef.current?.addJob(newJob);

      // Update local state
      if (existingJob) {
        setJobs(prevJobs => prevJobs.map(job => 
          job.id === existingJob.id ? newJob : job
        ));
        setNotification({
          message: 'Updated existing pair trade strategy',
          type: 'success'
        });
      } else {
        setJobs(prevJobs => [...prevJobs, newJob]);
        setNotification({
          message: 'Created new pair trade strategy',
          type: 'success'
        });
      }

      // Reset form
      setPairTokenA('');
      setPairTokenB('');
      setPairTokenASymbol('');
      setPairTokenBSymbol('');
      setPairAllocationPercentage('50');
      setPairMaxSlippage('1');
    } catch (error) {
      console.error('Error creating pair trade strategy:', error);
      setNotification({
        message: error instanceof Error ? error.message : 'Failed to create pair trade strategy',
        type: 'error'
      });
    }
  };

  const createDriftPerpStrategy = async () => {
    if (!selectedTradingWallet) {
      setNotification({
        message: 'Please select a trading wallet first',
        type: 'error'
      });
      return;
    }

    if (!driftEntryPrice || !driftExitPrice) {
      setNotification({
        message: 'Please enter both entry and exit prices',
        type: 'error'
      });
      return;
    }

    const entryPrice = parseFloat(driftEntryPrice.toString());
    const exitPrice = parseFloat(driftExitPrice.toString());
    const leverage = parseFloat(driftLeverage.toString());
    const allocationPercentage = parseFloat(driftAllocationPercentage.toString());

    if (entryPrice <= 0 || exitPrice <= 0 || leverage <= 0 || allocationPercentage <= 0) {
      setNotification({
        message: 'All numeric values must be greater than 0',
        type: 'error'
      });
      return;
    }

    // Dynamic leverage validation based on selected market
    const selectedMarket = availableDriftMarkets.find(m => m.symbol === driftMarketSymbol);
    const maxLeverage = selectedMarket?.maxLeverage || 10;
    
    if (leverage > maxLeverage) {
      setNotification({
        message: `Maximum leverage is ${maxLeverage}x for ${driftMarketSymbol}`,
        type: 'error'
      });
      return;
    }

    if (allocationPercentage > 100) {
      setNotification({
        message: 'Allocation percentage cannot exceed 100%',
        type: 'error'
      });
      return;
    }

    try {
      const initialBalance = await connection.getBalance(new PublicKey(selectedTradingWallet.publicKey)) / LAMPORTS_PER_SOL;
      
      const strategyInstance = StrategyService.getInstance(connection);
      
      // Allow multiple Drift Perp strategies - no existing job check needed
      const newJob = await strategyInstance.createDriftPerpStrategy({
          tradingWallet: selectedTradingWallet,
          initialBalance,
          solPrice: 150, // TODO: Get actual SOL price
          marketSymbol: driftMarketSymbol,
          marketIndex: driftMarketIndex,
          direction: driftDirection,
          allocationPercentage,
          entryPrice,
          exitPrice,
          leverage,
          stopLoss: driftStopLoss ? parseFloat(driftStopLoss.toString()) : undefined,
          takeProfit: driftTakeProfit ? parseFloat(driftTakeProfit.toString()) : undefined,
          maxSlippage: parseFloat(driftMaxSlippage.toString())
        });

      // Always add as new job since we allow multiple Drift Perp strategies
      setJobs(prevJobs => [...prevJobs, newJob]);
      setNotification({
        message: 'Created new Drift Perp strategy',
        type: 'success'
      });

      // Reset form
      setDriftMarketSymbol('SOL-PERP');
      setDriftMarketIndex(0);
      setDriftDirection('long');
      setDriftAllocationPercentage('25');
      setDriftEntryPrice('');
      setDriftExitPrice('');
      setDriftLeverage('1');
      setDriftStopLoss('');
      setDriftTakeProfit('');
      setDriftMaxSlippage('1');
    } catch (error) {
      console.error('Error creating Drift Perp strategy:', error);
      setNotification({
        message: error instanceof Error ? error.message : 'Failed to create Drift Perp strategy',
        type: 'error'
      });
    }
  };

  // Add deleteJob function before the return statement
  const deleteJob = async (jobId: string) => {
    try {
      // Find the job in state
      const job = jobs.find(j => j.id === jobId);
      console.log('Deleting job:', job); // <-- DEBUG LOG

      // If it's a saved wallet (saved wallet type), use savedWalletsApi
      if (job && job.type === JobType.SAVED_WALLET) {
        console.log('Removing saved wallet via savedWalletsApi');
        await savedWalletsApi.remove(jobId);
        // Re-fetch after delete to ensure UI is in sync
        if (wallet.publicKey) {
          const updated = await savedWalletsApi.getAll(wallet.publicKey.toString());
          const savedWalletJobs = mapSavedWalletsToJobs(updated);
          setJobs(prevJobs => [
            ...prevJobs.filter(j => j.type !== JobType.SAVED_WALLET),
            ...savedWalletJobs
          ]);
        } else {
          setJobs(prevJobs => prevJobs.filter(job => job.id !== jobId));
        }
        setNotification({
          message: 'Saved wallet removed successfully',
          type: 'success'
        });
      } else {
        // Otherwise, it's a strategy
        await strategyApiService.deleteStrategy(jobId);
        // Stop the job in the job manager
        await jobManagerRef.current?.removeJob(jobId);
        // Remove from state
        setJobs(prevJobs => prevJobs.filter(job => job.id !== jobId));
        setNotification({
          message: 'Strategy removed successfully',
          type: 'success'
        });
      }
    } catch (error) {
      console.error('Error deleting job:', error);
      setNotification({
        message: 'Failed to remove strategy or saved wallet',
        type: 'error'
      });
    }
  };

  const updateWalletName = async (publicKey: string, newName: string) => {
    try {
      // Update database first
      await tradingWalletService.updateWalletName(publicKey, newName);
      
      // Then update local state
      const updatedWallets = tradingWallets.map(wallet =>
        wallet.publicKey === publicKey ? { ...wallet, name: newName } : wallet
      );
      
      setTradingWallets(updatedWallets);
      
      // Update localStorage to stay in sync
      if (wallet && wallet.publicKey) {
        localStorage.setItem('tradingWallets', JSON.stringify({
          ...JSON.parse(localStorage.getItem('tradingWallets') || '{}'),
          [wallet.publicKey.toString()]: updatedWallets
        }));
      }

      setNotification({
        message: 'Wallet name updated successfully',
        type: 'success'
      });
    } catch (error) {
      console.error('Error updating wallet name:', error);
      setNotification({
        message: 'Failed to update wallet name',
        type: 'error'
      });
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

    // Delete from localStorage
    const storedWallets = localStorage.getItem('tradingWallets');
    if (storedWallets) {
      const allWallets: StoredTradingWallets = JSON.parse(storedWallets);
      const ownerAddress = wallet.publicKey.toString();
      
      if (allWallets[ownerAddress]) {
        allWallets[ownerAddress] = allWallets[ownerAddress].filter(
          w => w.publicKey !== walletToDelete.publicKey
        );
        localStorage.setItem('tradingWallets', JSON.stringify(allWallets));
        setTradingWallets(allWallets[ownerAddress]);
      }
    }

    // Remove wallet from localStorage
    localStorage.removeItem(`wallet_${walletToDelete.publicKey}`);

    // Remove wallet balances from localStorage
    localStorage.removeItem(`wallet_balances_${walletToDelete.publicKey}`);

    // Remove all jobs associated with this wallet
    const updatedJobs = jobs.filter(job => job.tradingWalletPublicKey !== walletToDelete.publicKey);
    setJobs(updatedJobs);
    
    // Update jobs in localStorage
    if (wallet.publicKey) {
      localStorage.setItem(`jobs_${wallet.publicKey.toString()}`, JSON.stringify(updatedJobs));
    }

    // Delete from database
    try {
      await tradingWalletService.deleteWallet(walletToDelete.publicKey);
    } catch (error) {
      console.error('Error deleting trading wallet from database:', error);
    }

    setWalletToDelete(null);
    setShowDeleteDialog(false);

    // Show success notification
    setNotification({
      message: 'Trading wallet and associated lackeys deleted successfully',
      type: 'success'
    });
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
    const price = Number(newLevelPrice);
    const percentage = newLevelPercentage === '' ? 0 : Number(newLevelPercentage);
    if (price > 0 && percentage > 0) {
      // Check if this price level already exists
      const existingLevel = levels.find(level => level.price === price);
      if (existingLevel) {
        setNotification({
          message: 'A level with this price already exists. Please use a different price.',
          type: 'error'
        });
        return;
      }
      setLevels(prevLevels => [...prevLevels, { price, percentage }]);
      setNewLevelPrice(0);
      setNewLevelPercentage('');
    }
  };

  const removeLevel = (index: number) => {
    setLevels(prevLevels => prevLevels.filter((_, i) => i !== index));
  };

  // Add handleExportLackeys function
  const handleExportLackeys = async () => {
    if (!wallet.publicKey) {
      setNotification({
        message: 'Please connect your wallet first',
        type: 'error'
      });
      return;
    }

    try {
      const exportData = {
        lackeys: jobs,
        savedWallets: tradingWallets,
        ownerAddress: wallet.publicKey.toString()
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lackeys-${wallet.publicKey.toString().slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setNotification({
        message: 'Lackeys exported successfully',
        type: 'success'
      });
    } catch (error) {
      console.error('Error exporting lackeys:', error);
      setNotification({
        message: 'Failed to export lackeys',
        type: 'error'
      });
    }
  };

  // Add effect to update balances when trading wallets change
  useEffect(() => {
    if (tradingWallets.length > 0) {
      // Update balances for each trading wallet
      tradingWallets.forEach(tw => {
        walletBalanceService.initializeWallet(tw.publicKey)
          .catch(error => console.error('Failed to initialize trading wallet balances:', error));
      });
    }
  }, [tradingWallets, walletBalanceService]);

  // Function to process logo URI
  const processLogoURI = async (logoURI: string | null | undefined): Promise<string | undefined> => {
    if (!logoURI) return undefined;

    // If it's an IPFS JSON metadata URL
    if (logoURI.includes('/ipfs/') && !logoURI.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) {
      try {
        const response = await fetch(logoURI);
        const data = await response.json();
        if (data.image) {
          return data.image;
        }
      } catch (error) {
        console.error('Error processing IPFS JSON metadata:', error);
      }
    }

    return logoURI;
  };

  const loadTradingWallets = async () => {
    if (!wallet.publicKey) return;
    
    try {
      const ownerAddress = wallet.publicKey.toString();
      const storedWallets = await tradingWalletService.getWallets(ownerAddress);
      
      if (!storedWallets || !Array.isArray(storedWallets)) {
        console.warn('No trading wallets found or invalid format');
        return;
      }

      // Process wallets to ensure consistent secret key format and fetch strategies
      const processedWallets = await Promise.all(storedWallets.map(async w => {
        const strategies = await strategyApiService.getStrategies(w.publicKey);
        return {
        ...w,
          secretKey: w.secretKey instanceof Uint8Array ? w.secretKey : new Uint8Array(Buffer.from(w.secretKey, 'base64')),
          strategies
        };
      }));

      // Ensure no duplicates by using publicKey as unique identifier
      const uniqueWallets = Array.from(
        new Map(processedWallets.map(w => [w.publicKey, w])).values()
      );

      setTradingWallets(uniqueWallets);
      
      if (uniqueWallets.length > 0) {
        const restoredWallet = restoreSelectedTradingWallet(uniqueWallets);
        if (!restoredWallet) {
          handleSetSelectedTradingWallet(uniqueWallets[0]);
        }
      }
    } catch (error) {
      console.error('Error loading trading wallets:', error);
      setNotification({
        message: 'Failed to load trading wallets',
        type: 'error'
      });
    }
  };

  // Add state for delete lackey dialog
  const [showDeleteLackeyDialog, setShowDeleteLackeyDialog] = useState(false);
  const [lackeyToDelete, setLackeyToDelete] = useState<{ id: string; name?: string } | null>(null);

  // Add confirmDeleteLackey function
  const confirmDeleteLackey = () => {
    if (!lackeyToDelete) return;
    deleteJob(lackeyToDelete.id);
    setLackeyToDelete(null);
    setShowDeleteLackeyDialog(false);
  };

  // Add state for funding modal
  const [showFundingModal, setShowFundingModal] = useState(false);
  const [isUpdatingBalances, setIsUpdatingBalances] = useState(false);
  const [totalPortfolioValue, setTotalPortfolioValue] = useState(0);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const balanceUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fundWallet = async (tradingWallet: TradingWallet, amount: number) => {
    if (!wallet.publicKey || !connection) return;
    
    try {
      // Show preparing notification
      setNotification({ type: 'info', message: 'Preparing transaction...' });
      console.log('Preparing funding transaction...');
      
      // Create and send transaction
      const transaction = new Transaction();
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new PublicKey(tradingWallet.publicKey),
          lamports: amount * LAMPORTS_PER_SOL,
        })
      );

      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      console.log('Got latest blockhash:', latestBlockhash.blockhash);
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = wallet.publicKey;

      const signed = await wallet.signTransaction(transaction);
      console.log('Transaction signed, sending...');
      const signature = await connection.sendRawTransaction(signed.serialize());
      console.log('Transaction sent with signature:', signature);
      
      // Show sending notification
      setNotification({ type: 'info', message: 'Transaction sent, waiting for confirmation...' });
      setShowFundingModal(false);
      setFundingWallet(null);
      setFundingAmount('');

      // Wait for confirmation using getSignatureStatus instead of confirmTransaction
      let retryCount = 0;
      const maxRetries = 30; // More retries with shorter intervals
      let confirmed = false;

      while (retryCount < maxRetries && !confirmed) {
        try {
          console.log(`Checking transaction status attempt ${retryCount + 1}...`);
          const status = await connection.getSignatureStatus(signature);
          console.log('Transaction status:', status);

          if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
            confirmed = true;
            console.log('Transaction confirmed:', signature);

            // Show success notification
            setNotification({ 
              type: 'success', 
              message: 'Transaction confirmed! Updating balances...' 
            });

            // Trigger backend polling for this wallet
            setBackendPollingWallet(tradingWallet.publicKey);

            // Force immediate balance updates
            console.log('Updating balances...');
            
            // Update trading wallet balances first
            await fetchTradingWalletBalances();
            
            // Small delay before fetching backend balances
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Update backend balances
            await fetchBackendBalances(tradingWallet.publicKey);
            
            console.log('Initial balance update complete');

            // Dispatch custom event for any other components that need to update
            window.dispatchEvent(new CustomEvent('balances-updated', {
              detail: { walletAddress: tradingWallet.publicKey }
            }));

            // Schedule another update after 2 seconds to ensure everything is in sync
            setTimeout(async () => {
              console.log('Performing follow-up balance update...');
              
              // Update trading wallet balances first
              await fetchTradingWalletBalances();
              
              // Small delay before fetching backend balances
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // Update backend balances
              await fetchBackendBalances(tradingWallet.publicKey);
              
              console.log('Follow-up balance update complete');
              
              // Show final success notification
              setNotification({ 
                type: 'success', 
                message: 'Balances updated successfully!' 
              });
            }, 2000);

            break;
          }

          if (status.value?.err) {
            throw new Error(`Transaction failed: ${status.value.err}`);
          }

          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 500)); // Check every 500ms
        } catch (error) {
          console.error('Error checking transaction status:', error);
          retryCount++;
          if (retryCount === maxRetries) {
            throw new Error('Failed to confirm transaction after maximum retries');
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

    } catch (error) {
      console.error('Error in funding transaction:', error);
      setNotification({ 
        type: 'error', 
        message: error instanceof Error ? error.message : 'Transaction failed' 
      });
    }
  };

  // Load saved wallets from backend when wallet connects
  useEffect(() => {
    if (wallet.publicKey) {
      (async () => {
        try {
          const savedWallets = await savedWalletsApi.getAll(wallet.publicKey.toString());
          setJobs(savedWallets);
        } catch (error) {
          console.error('Failed to fetch saved wallets:', error);
          setNotification({ message: 'Failed to load saved wallets', type: 'error' });
        }
      })();
    } else {
      setJobs([]);
      setTradingWallets([]);
      // Only clear wallet selection if we actually had wallets before (not initial load)
      if (tradingWallets.length > 0) {
        handleSetSelectedTradingWallet(null);
      }
    }
  }, [wallet.publicKey]);

  // When saving a wallet
  const handleSaveWallet = async (walletAddress: string, name?: string) => {
    if (!wallet.publicKey) return;
    try {
      // Always pass a name, default to 'Unnamed Wallet' if not provided
      await savedWalletsApi.create({
        owner_id: wallet.publicKey.toString(),
        wallet_address: walletAddress,
        name: name || 'Unnamed Wallet'
      });
      // Re-fetch after save and map to jobs
      const updated = await savedWalletsApi.getAll(wallet.publicKey.toString());
      const savedWalletJobs = mapSavedWalletsToJobs(updated);
      setJobs(prevJobs => [
        ...prevJobs.filter(j => j.type !== JobType.SAVED_WALLET),
        ...savedWalletJobs
      ]);
      setNotification({ message: 'Wallet saved successfully', type: 'success' });
    } catch {
      setNotification({ message: 'Failed to save wallet', type: 'error' });
    }
  };

  // When deleting a wallet
  const handleDeleteSavedWallet = async (id: string) => {
    if (!wallet.publicKey) return;
    try {
      await savedWalletsApi.remove(id);
      // Re-fetch after delete and map to jobs
      const updated = await savedWalletsApi.getAll(wallet.publicKey.toString());
      const savedWalletJobs = mapSavedWalletsToJobs(updated);
      setJobs(prevJobs => [
        ...prevJobs.filter(j => j.type !== JobType.SAVED_WALLET),
        ...savedWalletJobs
      ]);
      setNotification({ message: 'Wallet removed successfully', type: 'success' });
    } catch {
      setNotification({ message: 'Failed to remove wallet', type: 'error' });
    }
  };

  // When updating a saved wallet name
  const handleUpdateSavedWalletName = async (id: string, newName: string) => {
    if (!wallet.publicKey) return;
    try {
      console.log('🔄 Updating saved wallet name:', { id, newName });
      await savedWalletsApi.update(id, { name: newName });
      console.log('✅ Backend update successful');
      // Re-fetch after update and map to jobs
      const updated = await savedWalletsApi.getAll(wallet.publicKey.toString());
      const savedWalletJobs = mapSavedWalletsToJobs(updated);
      setJobs(prevJobs => [
        ...prevJobs.filter(j => j.type !== JobType.SAVED_WALLET),
        ...savedWalletJobs
      ]);
      setNotification({ message: 'Wallet name updated successfully', type: 'success' });
    } catch (error) {
      console.error('❌ Failed to update wallet name:', error);
      setNotification({ message: 'Failed to update wallet name', type: 'error' });
    }
  };

  const [savedWallets, setSavedWallets] = useState([]);

  // Fetch saved wallets from backend on wallet connect
  useEffect(() => {
    if (wallet.publicKey) {
      savedWalletsApi.getAll(wallet.publicKey.toString())
        .then(setSavedWallets)
        .catch(() => setSavedWallets([]));
    } else {
      setSavedWallets([]);
    }
  }, [wallet.publicKey]);

  // Helper to map backend saved wallets to SavedWallet jobs
  function mapSavedWalletsToJobs(savedWallets) {
    return savedWallets.map(w => ({
      id: w.id,
      type: JobType.SAVED_WALLET,  // Changed from WALLET_MONITOR to SAVED_WALLET
      walletAddress: w.wallet_address,
      name: w.name,
      percentage: 10, // Default or w.percentage if available
      isActive: false, // <-- ENSURE THIS IS ALWAYS FALSE
      tradingWalletPublicKey: '',
    }));
  }

  // Helper to get the correct strategy icon based on job type
  function getStrategyIcon(job: AnyJob, isActive: boolean, onClick: () => void) {
    const iconProps = { isActive, onClick };
    
    switch (job.type) {
      case JobType.WALLET_MONITOR:
        return <WalletMonitorIcon isActive={isActive} onClick={onClick} />;
      case JobType.PRICE_MONITOR:
        return <PriceMonitorIcon {...iconProps} />;
      case JobType.VAULT:
        return <VaultIcon {...iconProps} />;
      case JobType.LEVELS:
        return <LevelsIcon {...iconProps} />;
      case JobType.PAIR_TRADE:
        return <PairTradeIcon {...iconProps} />;
      case JobType.DRIFT_PERP:
        return <DriftPerpIcon {...iconProps} />;
      case JobType.SAVED_WALLET:
      default:
        return <LackeyIcon {...iconProps} />;
    }
  }

  // Fetch and merge saved wallets on wallet connect
  useEffect(() => {
    if (wallet.publicKey) {
      (async () => {
        try {
          const savedWallets = await savedWalletsApi.getAll(wallet.publicKey.toString());
          const savedWalletJobs = mapSavedWalletsToJobs(savedWallets);
          setJobs(prevJobs => [
            ...prevJobs.filter(j => j.type !== JobType.WALLET_MONITOR || j.isActive),
            ...savedWalletJobs
          ]);
        } catch (error) {
          console.error('Failed to fetch saved wallets:', error);
          setNotification({ message: 'Failed to load saved wallets', type: 'error' });
        }
      })();
    } else {
      setJobs([]);
      setTradingWallets([]);
      // Only clear wallet selection if we actually had wallets before (not initial load)
      if (tradingWallets.length > 0) {
        handleSetSelectedTradingWallet(null);
      }
    }
  }, [wallet.publicKey]);

  // Add state for delete saved wallet dialog
  const [showDeleteSavedWalletDialog, setShowDeleteSavedWalletDialog] = useState(false);
  const [savedWalletToDelete, setSavedWalletToDelete] = useState<{ id: string; name?: string } | null>(null);

  // Add confirmDeleteSavedWallet function
  const confirmDeleteSavedWallet = async () => {
    if (!savedWalletToDelete) return;
    await handleDeleteSavedWallet(savedWalletToDelete.id);
    setSavedWalletToDelete(null);
    setShowDeleteSavedWalletDialog(false);
  };

  // Add at the top of AppContent
  const [refreshCount, setRefreshCount] = useState(0);
  const [isBackgroundRefresh, setIsBackgroundRefresh] = useState(false);

  // Add at the top of AppContent
  const [backendBalancesByWallet, setBackendBalancesByWallet] = useState({});

  // Add at the top of AppContent
  const [backendPollingWallet, setBackendPollingWallet] = useState<string | null>(null);

  // Add this function in AppContent
  const handleBackendPollingComplete = (walletAddress: string) => {
    fetchBackendBalances(walletAddress);
  };

  // In AppContent, add a handler to update the summary value for each wallet
  const handleTotalValueChange = (walletAddress: string, value: number) => {
    setTradingWalletBalances(prev => ({
      ...prev,
      [walletAddress]: value
    }));
  };

  // Add periodic polling to fetch backend balances for all trading wallets
  useEffect(() => {
    if (tradingWallets.length === 0) return;

    let isCancelled = false;

    const fetchAllBackendBalances = async () => {
      for (const tw of tradingWallets) {
        try {
          const response = await fetch(`${API_CONFIG.WALLET.BALANCES}/${tw.publicKey}`);
          if (response.ok) {
            const data = await response.json();
            const total = data.balances.reduce((sum, balance) => sum + (balance.usdValue || 0), 0);
            setTradingWalletBalances(prev => ({
              ...prev,
              [tw.publicKey]: total,
            }));
            // Also update backendBalancesByWallet for TokenBalancesList
            setBackendBalancesByWallet(prev => ({
              ...prev,
              [tw.publicKey]: data.balances
            }));
          }
        } catch (e) {
          // Optionally handle error
        }
        // Stagger requests by 300ms to avoid rate limits
        await new Promise(res => setTimeout(res, 300));
        if (isCancelled) break;
      }
    };

    fetchAllBackendBalances();
    // Set interval to 2 seconds for real-time UI updates
    const interval = setInterval(fetchAllBackendBalances, 2000); // <-- 2 seconds

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [tradingWallets]);

  // Add this useEffect near where notification state is managed
  useEffect(() => {
    if (notification && notification.type === 'success') {
      const timeout = setTimeout(() => {
        setNotification(null);
      }, 3000); // 3 seconds
      return () => clearTimeout(timeout);
    }
  }, [notification]);

  return (
    <div className={walletStyles.container}>
      <NavigationBar currentPage={currentPage} onPageChange={setCurrentPage} />
      {currentPage === 'dashboard' ? (
        <div style={{ padding: '2rem' }}>
          <div className={walletStyles.dashboardLayout}>
            <div className={walletStyles.mainContent}>
              {/* Title Section - removed Import/Export buttons */}
              <div className={walletStyles.titleSection}>
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
              <div style={{ marginTop: '-0.6rem' }}>
                {renderTradingWalletSelector()}
              </div>

              {/* Active Jobs Section */}
              <div style={{
                backgroundColor: '#1e293b',
                borderRadius: '0.75rem',
                padding: '1.25rem',
                border: '1px solid #2d3748',
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
                  <div style={{
                    transform: `rotate(${isActiveLackeysExpanded ? '180deg' : '0deg'})`,
                    transition: 'transform 0.2s ease-in-out',
                    marginRight: '2.7px'
                  }}>
                    <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 1L6 6L11 1" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                </div>
                <div style={{
                  maxHeight: isActiveLackeysExpanded ? '100%' : '0',
                  opacity: isActiveLackeysExpanded ? '1' : '0',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease-in-out',
                  marginTop: isActiveLackeysExpanded ? '1rem' : '0'
                }}>
                {console.log(`🔍 ACTIVE LACKEYS DEBUG: jobs.length = ${jobs.length}, tradingWallets.length = ${tradingWallets.length}`)}
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
                      //console.log(`🔍 WALLET DEBUG: Checking wallet ${tw.publicKey}`);
                      //console.log(`🔍 WALLET DEBUG: Available jobs count: ${jobs.length}`);
                      
                      const walletJobs = jobs.filter(job => {
                        //console.log(`🔍 JOB DEBUG: Job ${job.id} has tradingWalletPublicKey: ${job.tradingWalletPublicKey}`);
                        //console.log(`🔍 JOB DEBUG: Comparing '${job.tradingWalletPublicKey}' === '${tw.publicKey}': ${job.tradingWalletPublicKey === tw.publicKey}`);
                        return job.tradingWalletPublicKey === tw.publicKey;
                      });
                      
                      //console.log(`🔍 WALLET DEBUG: Found ${walletJobs.length} jobs for wallet ${tw.publicKey}`);
                      if (walletJobs.length === 0) {
                        //console.log(`🔍 WALLET DEBUG: Hiding wallet ${tw.publicKey} - no matching jobs found`);
                        return null;
                      }

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
                            {walletJobs.map((job, index) => {
                              // Create unique key that includes configuration details
                              const uniqueKey = job.type === JobType.PRICE_MONITOR 
                                ? `${job.id}_${job.tradingWalletPublicKey}_${job.type}_${(job as PriceMonitoringJob).targetPrice}_${(job as PriceMonitoringJob).direction}_${(job as PriceMonitoringJob).percentageToSell}`
                                : `${job.id}_${job.tradingWalletPublicKey}_${job.type}_${index}`;
                              
                              return (
                                <div 
                                  key={uniqueKey}
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
                                        {getStrategyIcon(
                                          job, 
                                          job.isActive && !pausedJobs.has(job.id), 
                                          () => toggleJobPause(job.id)
                                        )}
                                      </span>
                                      <span style={{ color: '#94a3b8' }}>|</span>
                                      <span>
                                        {job.type === JobType.WALLET_MONITOR ? (
                                          <span>
                                            <span style={{ color: '#e2e8f0' }}>{(job as WalletMonitoringJob).name || 'Unnamed Wallet'}</span>
                                            <span style={{ color: '#94a3b8' }}> - </span>
                                            <span 
                                              className={walletStyles.copyAddress}
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
                                              className={walletStyles.copyAddress}
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
                                          : job.type === JobType.PAIR_TRADE
                                            ? `${(job as PairTradeJob).tokenASymbol} ↔ ${(job as PairTradeJob).tokenBSymbol} (${(job as PairTradeJob).allocationPercentage}%)`
                                          : job.type === JobType.DRIFT_PERP
                                            ? (() => {
                                                const driftJob = job as DriftPerpJob;
                                                const pos = driftJob.currentPosition;
                                                if (pos) {
                                                  const pnlColor = pos.unrealizedPnl >= 0 ? '#22c55e' : '#ef4444';
                                                  const pnlSign = pos.unrealizedPnl >= 0 ? '+' : '';
                                                  const distanceToLiq = ((pos.currentPrice - pos.liquidationPrice) / pos.currentPrice * 100);
                                                  const liquidationWarning = distanceToLiq < 15 ? '⚠️' : distanceToLiq < 30 ? '⚡' : '';
                                                  
                                                  return (
                                                    <div style={{ lineHeight: '1.2' }}>
                                                      <div>{driftJob.marketSymbol} {driftJob.direction.toUpperCase()} {driftJob.leverage}x ({driftJob.allocationPercentage}%)</div>
                                                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
                                                        Entry: ${pos.entryPrice.toFixed(2)} | Current: ${pos.currentPrice.toFixed(2)} | Liq: ${pos.liquidationPrice.toFixed(2)} {liquidationWarning}
                                                      </div>
                                                      <div style={{ fontSize: '0.75rem', color: pnlColor, marginTop: '1px' }}>
                                                        P&L: {pnlSign}${pos.unrealizedPnl.toFixed(2)} | Margin: {(pos.marginRatio * 100).toFixed(1)}%
                                                      </div>
                                                    </div>
                                                  );
                                                } else {
                                                  return `${driftJob.marketSymbol} ${driftJob.direction.toUpperCase()} ${driftJob.leverage}x (${driftJob.allocationPercentage}%) - No Position`;
                                                }
                                              })()
                                            : `Unknown (type: ${job.type})`}
                                      </span>
                                      {job.profitTracking?.currentProfit !== undefined && (
                                        <>
                                          <span style={{ color: '#94a3b8' }}>|</span>
                                          <span style={{
                                            color: job.profitTracking.percentageChange >= 0 ? '#22c55e' : '#ef4444',
                                            fontWeight: '500',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.25rem'
                                          }}>
                                            <span>{job.profitTracking.percentageChange > 0 ? '+' : ''}{job.profitTracking.percentageChange.toFixed(2)}%</span>
                                            <span style={{ 
                                              fontSize: '0.625rem', 
                                              backgroundColor: job.profitTracking.percentageChange >= 0 ? '#15803d' : '#991b1b',
                                              padding: '0.125rem 0.25rem',
                                              borderRadius: '0.25rem'
                                            }}>
                                              {job.profitTracking.totalProfitSOL.toFixed(4)} SOL
                                            </span>
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
                                    
                                    {/* Drift Perp position management buttons */}
                                    {job.type === JobType.DRIFT_PERP && (job as DriftPerpJob).currentPosition && (
                                      <>
                                        <button
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            const driftJob = job as DriftPerpJob;
                                            try {
                                              const response = await fetch(`${API_CONFIG.BASE_URL}/api/v1/drift/close-position`, {
                                                method: 'POST',
                                                headers: {
                                                  'Content-Type': 'application/json',
                                                  'Authorization': `Bearer ${authService.getToken()}`
                                                },
                                                body: JSON.stringify({
                                                  jobId: job.id,
                                                  marketIndex: driftJob.marketIndex
                                                })
                                              });
                                              
                                              if (response.ok) {
                                                setNotification({ message: 'Position closed successfully', type: 'success' });
                                                await loadActiveJobs();
                                              } else {
                                                const error = await response.text();
                                                setNotification({ message: `Failed to close position: ${error}`, type: 'error' });
                                              }
                                            } catch (error) {
                                              setNotification({ message: `Error closing position: ${error}`, type: 'error' });
                                            }
                                          }}
                                          style={{
                                            padding: '0.25rem 0.5rem',
                                            backgroundColor: '#f59e0b',
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
                                          Close
                                        </button>
                                        <button
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            const driftJob = job as DriftPerpJob;
                                            const reducePercentage = prompt('Reduce position by what percentage? (e.g., 50 for 50%)', '50');
                                            
                                            if (reducePercentage && !isNaN(Number(reducePercentage))) {
                                              const percentage = Math.min(Math.max(Number(reducePercentage), 1), 100);
                                              try {
                                                const response = await fetch(`${API_CONFIG.BASE_URL}/api/v1/drift/reduce-position`, {
                                                  method: 'POST',
                                                  headers: {
                                                    'Content-Type': 'application/json',
                                                    'Authorization': `Bearer ${authService.getToken()}`
                                                  },
                                                  body: JSON.stringify({
                                                    jobId: job.id,
                                                    marketIndex: driftJob.marketIndex,
                                                    reducePercentage: percentage
                                                  })
                                                });
                                                
                                                if (response.ok) {
                                                  setNotification({ message: `Position reduced by ${percentage}%`, type: 'success' });
                                                  await loadActiveJobs();
                                                } else {
                                                  const error = await response.text();
                                                  setNotification({ message: `Failed to reduce position: ${error}`, type: 'error' });
                                                }
                                              } catch (error) {
                                                setNotification({ message: `Error reducing position: ${error}`, type: 'error' });
                                              }
                                            }
                                          }}
                                          style={{
                                            padding: '0.25rem 0.5rem',
                                            backgroundColor: '#8b5cf6',
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
                                          Reduce
                                        </button>
                                      </>
                                    )}
                                    
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
                                        setLackeyToDelete({ id: job.id, name: job.name });
                                        setShowDeleteLackeyDialog(true);
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

            {/* Right sidebar content */}
            <div className={walletStyles.sidebarContent}>
              <div style={{ 
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <h2 style={{ 
                  color: '#60a5fa',
                  margin: 0,
                  fontSize: '1.25rem'
                }}>Available Lackeys</h2>
                <LackeyImportExport
                  jobs={jobs}
                  setJobs={setJobs}
                  walletConnected={!!wallet.publicKey}
                  walletPublicKey={wallet.publicKey?.toString() || ''}
                  wallet={wallet}
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
                        
                        // Use backend API to save wallet
                        handleSaveWallet(monitoredWallet);
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
                      {jobs.filter(job => job.type === JobType.SAVED_WALLET).length} Saved
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
                  <div className={walletStyles.savedWalletsContainer}>
                    {jobs
                      .filter(job => job.type === JobType.SAVED_WALLET)
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
                            key={`${job.id}_${job.type}_saved`} 
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
                                    <div className={walletStyles.walletName}>
                                      <span className={walletStyles.walletNameText}>
                                        {monitorJob.name || 'Unnamed Wallet'}
                                      </span>
                                      <button
                                        className={walletStyles.editIcon}
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
                                  setSavedWalletToDelete({ id: job.id, name: job.name });
                                  setShowDeleteSavedWalletDialog(true);
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
                    {jobs.filter(job => job.type === JobType.SAVED_WALLET).length === 0 && (
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
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                              setSellPercentage('');
                            } else {
                              const num = parseFloat(value);
                              if (!isNaN(num)) {
                                setSellPercentage(Math.min(100, Math.max(0, num)));
                              }
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
                      fontSize: '0.75rem',
                      lineHeight: '1.4'
                    }}>
                      Automatically transfer a percentage of your portfolio to your main connected wallet for safekeeping. 
                      Tokens are converted to SOL before transfer. <strong style={{ color: '#fbbf24' }}>Maximum 5%</strong> to ensure trading liquidity.
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
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                              setVaultPercentage('');
                            } else {
                              const num = parseFloat(value);
                              if (!isNaN(num)) {
                                // Enforce 5% maximum limit
                                setVaultPercentage(Math.min(5, Math.max(0, num)));
                              }
                            }
                          }}
                          style={{
                            width: '60px',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: `1px solid ${parseFloat(vaultPercentage.toString()) > 5 ? '#ef4444' : '#4b5563'}`,
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          min="0.1"
                          max="5"
                          step="0.1"
                          placeholder="0.5"
                        />
                        <span style={{ color: '#e2e8f0' }}>%</span>
                      </div>
                      <p style={{ 
                        color: '#6b7280',
                        fontSize: '0.75rem',
                        margin: '0.25rem 0 0 0'
                      }}>
                        Enter 0.1% to 5.0% (Default: 0.5%)
                      </p>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                          value={newLevelPercentage}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                              setNewLevelPercentage('');
                            } else {
                              const num = parseFloat(value);
                              if (!isNaN(num)) {
                                setNewLevelPercentage(Math.min(100, Math.max(0, num)));
                              }
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

              {/* Pair Trade Strategy */}
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
                  onClick={() => toggleStrategy('pair-trade')}
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
                    <PairTradeIcon isActive={true} onClick={() => {}} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ 
                      color: '#e2e8f0',
                      margin: 0,
                      fontSize: '0.9375rem'
                    }}>Pair Trade</h3>
                    {expandedStrategy !== 'pair-trade' && (
                      <p style={{ 
                        color: '#94a3b8',
                        margin: '0.1875rem 0 0 0',
                        fontSize: '0.75rem'
                      }}>
                        Trade between two tokens back and forth
                      </p>
                    )}
                  </div>
                  <div style={{
                    color: '#94a3b8',
                    transform: expandedStrategy === 'pair-trade' ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                    fontSize: '0.75rem'
                  }}>
                    ▼
                  </div>
                </div>
                {expandedStrategy === 'pair-trade' && (
                  <div style={{
                    marginTop: '1.125rem',
                    animation: 'fadeIn 0.2s ease'
                  }}>
                    <p style={{ 
                      color: '#94a3b8',
                      margin: '0 0 1.125rem 0',
                      fontSize: '0.75rem'
                    }}>
                      Set up automated trading between two tokens with external triggers
                    </p>

                    {/* Token A Selection */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '1rem',
                        fontWeight: '500'
                      }}>
                        Token A
                      </label>
                      <TokenDropdown
                        tokens={supportedTokens}
                        value={pairTokenA}
                        onChange={(mintAddress, token) => {
                          setPairTokenA(mintAddress);
                          setPairTokenASymbol(token?.symbol || '');
                        }}
                        placeholder="Select Token A"
                      />
                      {/* Selected Token A Display */}
                      {pairTokenA && (
                        <div style={{
                          marginTop: '0.5rem',
                          padding: '0.75rem',
                          backgroundColor: '#0f172a',
                          borderRadius: '0.375rem',
                          border: '1px solid #374151',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem'
                        }}>
                          {supportedTokens.find(t => t.mintAddress === pairTokenA)?.logoURI && (
                            <img 
                              src={supportedTokens.find(t => t.mintAddress === pairTokenA)?.logoURI} 
                              alt={supportedTokens.find(t => t.mintAddress === pairTokenA)?.symbol}
                              style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                border: '2px solid #374151'
                              }}
                            />
                          )}
                          <div>
                            <div style={{ 
                              color: '#e2e8f0', 
                              fontSize: '1.125rem', 
                              fontWeight: '600' 
                            }}>
                              {supportedTokens.find(t => t.mintAddress === pairTokenA)?.symbol}
                            </div>
                            <div style={{ 
                              color: '#94a3b8', 
                              fontSize: '0.875rem' 
                            }}>
                              {supportedTokens.find(t => t.mintAddress === pairTokenA)?.name}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Token B Selection */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '1rem',
                        fontWeight: '500'
                      }}>
                        Token B
                      </label>
                      <TokenDropdown
                        tokens={supportedTokens.filter(token => token.mintAddress !== pairTokenA)}
                        value={pairTokenB}
                        onChange={(mintAddress, token) => {
                          setPairTokenB(mintAddress);
                          setPairTokenBSymbol(token?.symbol || '');
                        }}
                        placeholder="Select Token B"
                      />
                      {/* Selected Token B Display */}
                      {pairTokenB && (
                        <div style={{
                          marginTop: '0.5rem',
                          padding: '0.75rem',
                          backgroundColor: '#0f172a',
                          borderRadius: '0.375rem',
                          border: '1px solid #374151',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem'
                        }}>
                          {supportedTokens.find(t => t.mintAddress === pairTokenB)?.logoURI && (
                            <img 
                              src={supportedTokens.find(t => t.mintAddress === pairTokenB)?.logoURI} 
                              alt={supportedTokens.find(t => t.mintAddress === pairTokenB)?.symbol}
                              style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                border: '2px solid #374151'
                              }}
                            />
                          )}
                          <div>
                            <div style={{ 
                              color: '#e2e8f0', 
                              fontSize: '1.125rem', 
                              fontWeight: '600' 
                            }}>
                              {supportedTokens.find(t => t.mintAddress === pairTokenB)?.symbol}
                            </div>
                            <div style={{ 
                              color: '#94a3b8', 
                              fontSize: '0.875rem' 
                            }}>
                              {supportedTokens.find(t => t.mintAddress === pairTokenB)?.name}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Valuation-Based Allocation Info */}
                    <div style={{ 
                      marginBottom: '1rem',
                      padding: '0.75rem',
                      backgroundColor: '#0f172a',
                      borderRadius: '0.375rem',
                      border: '1px solid #374151'
                    }}>
                      <div style={{ 
                        color: '#10b981',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        marginBottom: '0.25rem'
                      }}>
                        🤖 Automated Allocation
                      </div>
                      <div style={{ 
                        color: '#94a3b8',
                        fontSize: '0.75rem',
                        lineHeight: '1.4'
                      }}>
                        The system will automatically allocate 50% to the undervalued token based on external market analysis. 
                        Allocation will adjust automatically via external trading signals.
                      </div>
                    </div>

                    {/* Allocation Percentage */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}>
                        Allocation Percentage
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="number"
                          value={pairAllocationPercentage}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                              setPairAllocationPercentage('');
                            } else {
                              const num = parseFloat(value);
                              if (!isNaN(num)) {
                                setPairAllocationPercentage(Math.min(100, Math.max(1, num)));
                              }
                            }
                          }}
                          style={{
                            width: '80px',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          min="1"
                          max="100"
                          placeholder="50"
                        />
                        <span style={{ color: '#e2e8f0' }}>% of wallet to use</span>
                      </div>
                    </div>

                    {/* Max Slippage */}
                    <div style={{ marginBottom: '1.5rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}>
                        Max Slippage
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="number"
                          value={pairMaxSlippage}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                              setPairMaxSlippage('');
                            } else {
                              const num = parseFloat(value);
                              if (!isNaN(num)) {
                                setPairMaxSlippage(Math.min(10, Math.max(0.1, num)));
                              }
                            }
                          }}
                          style={{
                            width: '80px',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          min="0.1"
                          max="10"
                          step="0.1"
                          placeholder="1.0"
                        />
                        <span style={{ color: '#e2e8f0' }}>%</span>
                      </div>
                    </div>

                    <button
                      onClick={createPairTradeStrategy}
                      disabled={!selectedTradingWallet || !pairTokenA || !pairTokenB || pairTokenA === pairTokenB}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        backgroundColor: (selectedTradingWallet && pairTokenA && pairTokenB && pairTokenA !== pairTokenB) ? '#3b82f6' : '#1e293b',
                        border: '1px solid ' + ((selectedTradingWallet && pairTokenA && pairTokenB && pairTokenA !== pairTokenB) ? '#60a5fa' : '#4b5563'),
                        borderRadius: '0.375rem',
                        color: '#e2e8f0',
                        cursor: (selectedTradingWallet && pairTokenA && pairTokenB && pairTokenA !== pairTokenB) ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s'
                      }}
                    >
                      Create Pair Trade Strategy
                    </button>
                  </div>
                )}
              </div>

              {/* Drift Perp Strategy Card */}
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
                  onClick={() => toggleStrategy('drift-perp')}
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
                    <DriftPerpIcon isActive={true} onClick={() => {}} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ 
                      color: '#e2e8f0',
                      margin: 0,
                      fontSize: '0.9375rem'
                    }}>Drift Perp</h3>
                    {expandedStrategy !== 'drift-perp' && (
                      <p style={{ 
                        color: '#94a3b8',
                        margin: '0.1875rem 0 0 0',
                        fontSize: '0.75rem'
                      }}>
                        Trade perpetual futures with leverage on Drift Protocol
                      </p>
                    )}
                  </div>
                  <div style={{
                    color: '#94a3b8',
                    transform: expandedStrategy === 'drift-perp' ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                    fontSize: '0.75rem'
                  }}>
                    ▼
                  </div>
                </div>
                {expandedStrategy === 'drift-perp' && (
                  <div style={{
                    marginTop: '1.125rem',
                    animation: 'fadeIn 0.2s ease'
                  }}>
                    <p style={{ 
                      color: '#94a3b8',
                      margin: '0 0 1.125rem 0',
                      fontSize: '0.75rem'
                    }}>
                      Open long or short positions on perpetual futures contracts with leverage
                    </p>

                    {/* Market Selection */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}>
                        Market
                      </label>
                      <select
                        value={driftMarketSymbol}
                        onChange={(e) => {
                          setDriftMarketSymbol(e.target.value);
                          // Find the selected market and set its index
                          const selectedMarket = availableDriftMarkets.find(m => m.symbol === e.target.value);
                          if (selectedMarket) {
                            setDriftMarketIndex(selectedMarket.marketIndex);
                            
                            // Reset leverage if current value exceeds new market's max leverage
                            const currentLeverage = parseFloat(String(driftLeverage));
                            if (!isNaN(currentLeverage) && currentLeverage > selectedMarket.maxLeverage) {
                              setDriftLeverage(selectedMarket.maxLeverage.toString());
                            }
                          }
                        }}
                        style={{
                          width: '200px',
                          maxWidth: '100%',
                          padding: '0.75rem',
                          backgroundColor: '#1e293b',
                          border: '1px solid #4b5563',
                          borderRadius: '0.375rem',
                          color: '#e2e8f0',
                          fontSize: '0.875rem'
                        }}
                        disabled={isDriftMarketsLoading}
                      >
                        {isDriftMarketsLoading ? (
                          <option>Loading markets...</option>
                        ) : availableDriftMarkets.length > 0 ? (
                          availableDriftMarkets.map(market => (
                            <option key={market.marketIndex} value={market.symbol}>
                              {market.symbol} (Max {market.maxLeverage}x)
                            </option>
                          ))
                        ) : (
                          <option disabled>No markets available</option>
                        )}
                      </select>
                    </div>

                    {/* Direction Selection */}
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
                          onClick={() => setDriftDirection('long')}
                          style={{
                            flex: 1,
                            padding: '0.75rem',
                            backgroundColor: driftDirection === 'long' ? '#10b981' : '#1e293b',
                            border: '1px solid ' + (driftDirection === 'long' ? '#34d399' : '#4b5563'),
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          Long (Buy)
                        </button>
                        <button
                          onClick={() => setDriftDirection('short')}
                          style={{
                            flex: 1,
                            padding: '0.75rem',
                            backgroundColor: driftDirection === 'short' ? '#ef4444' : '#1e293b',
                            border: '1px solid ' + (driftDirection === 'short' ? '#f87171' : '#4b5563'),
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          Short (Sell)
                        </button>
                      </div>
                    </div>

                    {/* Entry and Exit Prices */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ 
                          display: 'block',
                          marginBottom: '0.5rem',
                          color: '#e2e8f0',
                          fontSize: '0.875rem'
                        }}>
                          Entry Price (USD)
                        </label>
                        <input
                          type="number"
                          value={driftEntryPrice}
                          onChange={(e) => setDriftEntryPrice(e.target.value)}
                          style={{
                            width: '140px',
                            maxWidth: '100%',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          placeholder="e.g., 150.00"
                          step="0.01"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ 
                          display: 'block',
                          marginBottom: '0.5rem',
                          color: '#e2e8f0',
                          fontSize: '0.875rem'
                        }}>
                          Exit Price (USD)
                        </label>
                        <input
                          type="number"
                          value={driftExitPrice}
                          onChange={(e) => setDriftExitPrice(e.target.value)}
                          style={{
                            width: '140px',
                            maxWidth: '100%',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          placeholder="e.g., 180.00"
                          step="0.01"
                        />
                      </div>
                    </div>

                    {/* Allocation and Leverage */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ 
                          display: 'block',
                          marginBottom: '0.5rem',
                          color: '#e2e8f0',
                          fontSize: '0.875rem'
                        }}>
                          Allocation (% of SOL)
                        </label>
                        <input
                          type="number"
                          value={driftAllocationPercentage}
                          onChange={(e) => setDriftAllocationPercentage(e.target.value)}
                          style={{
                            width: '100px',
                            maxWidth: '100%',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          placeholder="25"
                          min="1"
                          max="100"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ 
                          display: 'block',
                          marginBottom: '0.5rem',
                          color: '#e2e8f0',
                          fontSize: '0.875rem'
                        }}>
                          Leverage (1-{availableDriftMarkets.find(m => m.symbol === driftMarketSymbol)?.maxLeverage || 10}x)
                        </label>
                        <input
                          type="number"
                          value={driftLeverage}
                          onChange={(e) => {
                            const value = e.target.value;
                            const numericValue = parseFloat(value);
                            const selectedMarket = availableDriftMarkets.find(m => m.symbol === driftMarketSymbol);
                            const maxLeverage = selectedMarket?.maxLeverage || 10;
                            
                            // Allow empty string for clearing the field
                            if (value === '') {
                              setDriftLeverage('');
                              return;
                            }
                            
                            // Only allow valid numbers
                            if (isNaN(numericValue)) {
                              return;
                            }
                            
                            // Prevent values higher than max leverage
                            if (numericValue > maxLeverage) {
                              setDriftLeverage(maxLeverage.toString());
                              return;
                            }
                            
                            // Prevent negative values
                            if (numericValue < 0) {
                              return;
                            }
                            
                            setDriftLeverage(value);
                          }}
                          style={{
                            width: '80px',
                            maxWidth: '100%',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          placeholder="1"
                          min="1"
                          max={availableDriftMarkets.find(m => m.symbol === driftMarketSymbol)?.maxLeverage || 10}
                          step="0.1"
                        />
                      </div>
                    </div>

                    {/* Optional: Stop Loss and Take Profit */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ 
                          display: 'block',
                          marginBottom: '0.5rem',
                          color: '#e2e8f0',
                          fontSize: '0.875rem'
                        }}>
                          Stop Loss (USD) - Optional
                        </label>
                        <input
                          type="number"
                          value={driftStopLoss}
                          onChange={(e) => setDriftStopLoss(e.target.value)}
                          style={{
                            width: '140px',
                            maxWidth: '100%',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          placeholder="e.g., 140.00"
                          step="0.01"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ 
                          display: 'block',
                          marginBottom: '0.5rem',
                          color: '#e2e8f0',
                          fontSize: '0.875rem'
                        }}>
                          Take Profit (USD) - Optional
                        </label>
                        <input
                          type="number"
                          value={driftTakeProfit}
                          onChange={(e) => setDriftTakeProfit(e.target.value)}
                          style={{
                            width: '140px',
                            maxWidth: '100%',
                            padding: '0.75rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #4b5563',
                            borderRadius: '0.375rem',
                            color: '#e2e8f0',
                            fontSize: '0.875rem'
                          }}
                          placeholder="e.g., 200.00"
                          step="0.01"
                        />
                      </div>
                    </div>

                    {/* Max Slippage */}
                    <div style={{ marginBottom: '1.5rem' }}>
                      <label style={{ 
                        display: 'block',
                        marginBottom: '0.5rem',
                        color: '#e2e8f0',
                        fontSize: '0.875rem'
                      }}>
                        Max Slippage (%)
                      </label>
                      <input
                        type="number"
                        value={driftMaxSlippage}
                        onChange={(e) => setDriftMaxSlippage(e.target.value)}
                        style={{
                          width: '100px',
                          maxWidth: '100%',
                          padding: '0.75rem',
                          backgroundColor: '#1e293b',
                          border: '1px solid #4b5563',
                          borderRadius: '0.375rem',
                          color: '#e2e8f0',
                          fontSize: '0.875rem'
                        }}
                        placeholder="1"
                        min="0.1"
                        max="10"
                        step="0.1"
                      />
                    </div>

                    <button
                      onClick={createDriftPerpStrategy}
                      disabled={!selectedTradingWallet || !driftEntryPrice || !driftExitPrice}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        backgroundColor: (selectedTradingWallet && driftEntryPrice && driftExitPrice) ? '#3b82f6' : '#4b5563',
                        border: 'none',
                        borderRadius: '0.375rem',
                        color: '#e2e8f0',
                        cursor: (selectedTradingWallet && driftEntryPrice && driftExitPrice) ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s'
                      }}
                    >
                      Create Drift Perp Strategy
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
                endpoint={BACKEND_ENDPOINT}
              />
            </div>
          </div>
        </div>
      ) : currentPage === 'marketplace' ? (
        <div style={{
          backgroundColor: '#0f172a',
          minHeight: '100vh',
          margin: 0,
          boxSizing: 'border-box',
          isolation: 'isolate',
          position: 'relative',
          zIndex: 1
        }}>
          <StrategyMarketplace userWallet={wallet.publicKey?.toString()} />
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
                onClick={() => {
                  setFundingWallet(null);
                  setFundingAmount('');
                }}
                className={`${walletStyles.button} ${walletStyles.secondary}`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!fundingAmount || !fundingWallet) return;
                  try {
                    await fundWallet(fundingWallet, parseFloat(fundingAmount));
                  } catch (error) {
                    console.error('Error in funding transaction:', error);
                    // Modal will be closed by fundWallet function
                    // Error notification will be shown by fundWallet function
                  }
                }}
                disabled={!fundingAmount || parseFloat(fundingAmount) <= 0}
                className={`${walletStyles.button} ${walletStyles.primary}`}
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
      <DeleteLackeyDialog
        isOpen={showDeleteLackeyDialog}
        onClose={() => {
          setShowDeleteLackeyDialog(false);
          setLackeyToDelete(null);
        }}
        onConfirm={confirmDeleteLackey}
        lackeyName={lackeyToDelete?.name}
      />
      {showDeleteSavedWalletDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: '#1e293b',
            padding: '2rem',
            borderRadius: '0.75rem',
            maxWidth: '520px',
            width: '90%',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            border: '1px solid #2d3748'
          }}>
            <h3 style={{
              color: '#e2e8f0',
              margin: '0 0 1rem 0',
              fontSize: '1.25rem',
              fontWeight: '600'
            }}>
              Delete Saved Wallet
            </h3>
            <div style={{
              color: '#94a3b8',
              margin: '0 0 1.5rem 0',
              fontSize: '1rem',
              lineHeight: '1.5'
            }}>
              <p style={{ margin: '0 0 0.75rem 0' }}>
                Are you sure you want to delete <span style={{ color: '#e2e8f0', fontWeight: '500' }}>{savedWalletToDelete?.name || 'this wallet'}</span>?
              </p>
              <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
                This action cannot be undone.
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button
                onClick={() => {
                  setShowDeleteSavedWalletDialog(false);
                  setSavedWalletToDelete(null);
                }}
                style={{
                  backgroundColor: '#334155',
                  color: '#e2e8f0',
                  border: 'none',
                  borderRadius: '0.375rem',
                  padding: '0.5rem 1.25rem',
                  fontSize: '1rem',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (savedWalletToDelete) {
                    await deleteJob(savedWalletToDelete.id);
                    setSavedWalletToDelete(null);
                    setShowDeleteSavedWalletDialog(false);
                  }
                }}
                style={{
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.375rem',
                  padding: '0.5rem 1.25rem',
                  fontSize: '1rem',
                  cursor: 'pointer'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Add interface for TokenBalancesListProps
interface TokenBalancesListProps {
  walletAddress: string; 
  connection: Connection;
  tradingWallet?: TradingWallet;
  displayMode?: 'full' | 'total-only';
  onRpcError?: () => void;
  wallet: any; // Add wallet prop
  backendBalances?: any; // Add backendBalances prop
  refreshCount: number;
  isBackgroundRefresh: boolean;
  triggerBackendPolling?: string | null;
  onBackendPollingComplete?: () => void;
  onTotalValueChange?: (value: number) => void;
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

// Add interface for token metadata from backend
interface TokenMetadata {
  mint_address?: string;
  name?: string;
  symbol: string;
  decimals: number;
  logo_uri?: string | null;
}



// Add a cache for token metadata
const tokenMetadataCacheInList: Map<string, TokenMetadata> = new Map();

export const TokenBalancesList: React.FC<TokenBalancesListProps> = ({ 
  walletAddress, 
  connection, 
  tradingWallet, 
  displayMode = 'full',
  onRpcError,
  wallet,
  backendBalances,
  refreshCount,
  isBackgroundRefresh,
  triggerBackendPolling,
  onBackendPollingComplete,
  onTotalValueChange,
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
  const [showDustTokens, setShowDustTokens] = useState(false);
  const successMessageTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Minimum time between refreshes in milliseconds (15 seconds)
  const REFRESH_COOLDOWN = 15000;
  
  // Helper function to determine if a token balance is considered "dust"
  const isDustToken = (balance: TokenBalance): boolean => {
    // If USD value is available, use $0.01 threshold
    if (balance.usdValue !== undefined) {
      return balance.usdValue < 0.01;
    }
    // Otherwise, use token amount thresholds
    return balance.uiBalance < 0.0001;
  };
  
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

  // Function to fetch token metadata from backend
  const fetchTokenMetadata = async (mintAddresses: string[]): Promise<Map<string, TokenMetadata>> => {
    try {
      console.log('Fetching metadata for:', mintAddresses);
      const response = await fetch(API_CONFIG.TOKENS.BATCH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mintAddresses }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch token metadata');
      }

      const metadata: TokenMetadata[] = await response.json();
      console.log('Received metadata:', metadata);
      const metadataMap = new Map<string, TokenMetadata>();
      
      metadata.forEach(token => {
        if (token.mint_address) {  // Only add if mint_address exists
          metadataMap.set(token.mint_address, token);
          // Update cache
          tokenMetadataCache.set(token.mint_address, token);
          console.log('Added token to cache:', token);
        }
      });

      return metadataMap;
    } catch (error) {
      console.error('Error fetching token metadata:', error);
      return new Map();
    }
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
      
      // Get SOL balance
      const walletSolBalance = await withRetry(() => connection.getBalance(new PublicKey(walletAddress)));
      
      let newBalances: TokenBalance[] = [];
      
      // Get token accounts
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        new PublicKey(walletAddress),
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      // Collect all mint addresses
      const mintAddresses = ['So11111111111111111111111111111111111111112', // Include SOL
        ...tokenAccounts.value.map(account => account.account.data.parsed.info.mint)
      ];

      // Fetch metadata for all tokens at once
      const tokenMetadata = await fetchTokenMetadata(mintAddresses);
      console.log('Token metadata received:', Array.from(tokenMetadata.entries()));

      // Add SOL balance
      const solMetadata = tokenMetadata.get('So11111111111111111111111111111111111111112');
      const solToken: TokenBalance = {
        mint: 'So11111111111111111111111111111111111111112',
        symbol: solMetadata?.symbol || 'SOL',
        balance: walletSolBalance,
        decimals: 9,
        uiBalance: walletSolBalance / LAMPORTS_PER_SOL,
        logoURI: solMetadata?.logo_uri || null
      };
      
      newBalances.push(solToken);
      
      // Process token accounts
      const tokenBalanceMap = new Map<string, TokenBalance>();
      
      // Add SOL balance first
      tokenBalanceMap.set(solToken.mint, solToken);
      
      // Process token accounts
      for (const { account } of tokenAccounts.value) {
        const parsedInfo = account.data.parsed.info;
        const metadata = tokenMetadata.get(parsedInfo.mint);
        console.log(`Processing token ${parsedInfo.mint}:`, metadata);
        
        if (metadata && !tokenBalanceMap.has(parsedInfo.mint)) {
          // Process the logo URI if it exists
          let logoURI = metadata.logo_uri;
          if (logoURI?.includes('/ipfs/') && !logoURI.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) {
            try {
              const response = await fetch(logoURI);
              const data = await response.json();
              if (data.image) {
                logoURI = data.image;
              }
            } catch (error) {
              console.error('Error processing IPFS JSON metadata:', error);
            }
          }
          
          const balance = {
            mint: parsedInfo.mint,
            symbol: metadata.symbol,
            balance: Number(parsedInfo.tokenAmount.amount),
            decimals: metadata.decimals,
            uiBalance: Number(parsedInfo.tokenAmount.uiAmount),
            logoURI
          };
          console.log(`Created balance object for ${parsedInfo.mint}:`, balance);
          tokenBalanceMap.set(parsedInfo.mint, balance);
        }
      }
      
      // Convert Map back to array
      newBalances = Array.from(tokenBalanceMap.values());
      
      // Early exit if balances haven't changed significantly
      const cachedBalances = getWalletBalanceCache(walletAddress);
      if (!isInitialLoad && cachedBalances.length > 0 && !hasSignificantBalanceChange(cachedBalances, newBalances)) {
        console.log('Balance data unchanged for wallet:', walletAddress);
        setIsFetching(false);
        return;
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
              
              // Skip if we already have this token
              if (tokenBalanceMap.has(mint)) {
                return null;
              }
              
              // Check if we already have metadata
              if (tokenMetadata.has(mint)) {
                const existing = tokenMetadata.get(mint)!;
                const balance: TokenBalance = {
                  mint,
                  symbol: existing.symbol,
                  balance: Number(parsedInfo.tokenAmount.amount),
                  decimals: existing.decimals,
                  uiBalance: parsedInfo.tokenAmount.uiAmount || 0,
                  logoURI: existing.logo_uri
                };
                tokenBalanceMap.set(mint, balance);
                return balance;
              } else {
                // New token, fetch metadata
                try {
                  const metadata = await fetchTokenMetadata([mint]);
                  if (metadata.has(mint)) {
                    const tokenInfo = metadata.get(mint)!;
                    const balance: TokenBalance = {
                      mint,
                      symbol: tokenInfo.symbol,
                      balance: Number(parsedInfo.tokenAmount.amount),
                      decimals: tokenInfo.decimals,
                      uiBalance: parsedInfo.tokenAmount.uiAmount || 0,
                      logoURI: tokenInfo.logo_uri
                    };
                    tokenBalanceMap.set(mint, balance);
                    return balance;
                  }
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
        newBalances = Array.from(tokenBalanceMap.values());
        
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
          const existingBalance = tokenMetadata.get(newBalance.mint);
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

  // Handle backend polling trigger - THIS WAS MISSING!
  useEffect(() => {
    if (triggerBackendPolling === walletAddress) {
      log(`Backend polling triggered for wallet ${walletAddress}`);
      setIsBackgroundUpdate(true);
      fetchBalances().then(() => {
        // Notify parent that polling is complete
        if (onBackendPollingComplete) {
          onBackendPollingComplete();
        }
      });
    }
  }, [triggerBackendPolling, walletAddress, fetchBalances, onBackendPollingComplete]);

  // Add handleSwap, used just for swapToSol button.
  const handleSwapToSol = async (tokenBalance: TokenBalance) => {
    try {
      if (!tradingWallet) {
        throw new Error('Trading wallet not initialized');
      }

      // Get the trading wallet keypair
      const privateKey = localStorage.getItem(`wallet_${tradingWallet.publicKey}`);
      if (!privateKey) {
          throw new Error('Trading wallet private key not found');
      }

      const keypair = Keypair.fromSecretKey(new Uint8Array(Buffer.from(privateKey, 'base64')));

      // Prepare swap parameters
      const swapParams = {
          inputMint: tokenBalance.mint,
          outputMint: 'So11111111111111111111111111111111111111112', // Native SOL
          amount: tokenBalance.balance,
          slippageBps: 50, // 0.5% slippage
          walletKeypair: {
              publicKey: keypair.publicKey.toString(),
              secretKey: Array.from(keypair.secretKey)
          },
          feeWalletPubkey: wallet.publicKey?.toString(),
          feeBps: 0// 0% fee for swap to Sol.
      };
      
      console.log('Executing swap with parameters:', {
        ...swapParams,
        walletKeypair: { ...swapParams.walletKeypair, secretKey: '[REDACTED]' }
      });

      // Execute swap through backend API
      const result = await executeSwap(swapParams);

      console.log('Swap executed successfully:', result);
      // Update balances after successful swap
      window.dispatchEvent(new Event('update-balances'));
    } catch (error) {
        console.error('Swap failed:', error);
        setJupiterError(error instanceof Error ? error.message : 'Failed to execute swap');
    }
};
  // Add a manual refresh function
  const handleManualRefresh = () => {
    // Only allow manual refresh if not already fetching and cooldown period has passed
    const now = Date.now();
    if (!isFetching && now - lastRefreshTime > REFRESH_COOLDOWN) {
      setIsBackgroundUpdate(false); // Manual refresh
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
      setRefreshCount(c => c + 1);
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
        
        {/* Dust tokens toggle - positioned directly under Refresh */}
        {displayMode === 'full' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.75rem',
            color: '#94a3b8',
            marginBottom: '0.5rem'
          }}>
            <input
              type="checkbox"
              id={`dust-toggle-${walletAddress}`}
              checked={showDustTokens}
              onChange={(e) => setShowDustTokens(e.target.checked)}
              style={{
                width: '12px',
                height: '12px',
                accentColor: '#3b82f6'
              }}
            />
            <label htmlFor={`dust-toggle-${walletAddress}`} style={{ cursor: 'pointer' }}>
              Show dust tokens (&lt;$0.01)
            </label>
          </div>
        )}
        
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

      {/* Filter tokens based on balance and dust settings */}
      {balances
        .filter(balance => {
          // Always show SOL
          if (balance.mint === 'So11111111111111111111111111111111111111112') {
            return balance.uiBalance > 0;
          }
          // For other tokens, filter based on dust settings
          if (showDustTokens) {
            return balance.uiBalance > 0;
          } else {
            return balance.uiBalance > 0 && !isDustToken(balance);
          }
        })
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
                  onLoad={() => {
                    console.log(`Successfully loaded image for ${balance.symbol}:`, balance.logoURI);
                  }}
                  onError={(e) => {
                    console.error(`Failed to load image for ${balance.symbol}:`, balance.logoURI);
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
                onClick={() => handleSwapToSol(balance)}
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
  const defaultEndpoint = BACKEND_ENDPOINT;

  // Create the wallet adapter config
  const walletConfig = {
    wallets,
    autoConnect: true,
  };

  const [endpoint, setEndpoint] = useState<string>(defaultEndpoint);
  
  // Create connection configuration with WebSocket endpoint
  const connectionConfig = useMemo(() => ({
    commitment: 'confirmed',
    wsEndpoint: API_CONFIG.WS_BASE
  }), []);
  
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
  const handleRpcError = async (error: any) => {
    console.error('RPC Error:', error);
    const newEndpoint = BACKEND_ENDPOINT;
    
    if (endpoint !== newEndpoint) {
      console.log('Switching to backend endpoint:', newEndpoint);
      setEndpoint(newEndpoint);
    } else {
      console.log('Already using backend endpoint');
    }
  };
  
  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
      <WalletProvider {...walletConfig}>
        <WalletModalProvider>
          <PortfolioProvider>
            <AppContent onRpcError={handleRpcError} currentEndpoint={endpoint} />
          </PortfolioProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default App;





