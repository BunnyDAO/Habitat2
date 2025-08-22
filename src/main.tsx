import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { UnifiedWalletProvider } from '@jup-ag/wallet-adapter';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { API_CONFIG } from './config/api';

// You must import the styles for the modal
import '@solana/wallet-adapter-react-ui/styles.css';

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ConnectionProvider endpoint={API_CONFIG.RPC_BASE}>
    <WalletProvider wallets={wallets} autoConnect={false}>
      <WalletModalProvider>
        <UnifiedWalletProvider
          wallets={wallets}
          config={{
            autoConnect: false,
            env: 'mainnet-beta',
            metadata: {
              name: 'Lackey',
              description: 'Lackey is a comprehensive Solana trading platform that enables automated cryptocurrency trading through intelligent wallet management and strategy execution. The application allows users to create and manage multiple trading wallets, monitor real-time token balances, and deploy automated trading strategies like level-based buying/selling and vault management. With integrated Jupiter swap functionality, whale tracking capabilities, and a user-friendly dashboard, Habitat streamlines portfolio management while providing advanced tools for both manual and automated SOL and SPL token trading.',
              url: window.location.origin,
              iconUrls: [],
            },
          }}
        >
          <App />
        </UnifiedWalletProvider>
      </WalletModalProvider>
    </WalletProvider>
  </ConnectionProvider>
);