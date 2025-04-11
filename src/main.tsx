import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { UnifiedWalletProvider } from '@jup-ag/wallet-adapter';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';

// You must import the styles for the modal
import '@solana/wallet-adapter-react-ui/styles.css';

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ConnectionProvider endpoint="https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a">
    <WalletProvider wallets={wallets} autoConnect={false}>
      <WalletModalProvider>
        <UnifiedWalletProvider
          wallets={wallets}
          config={{
            autoConnect: false,
            env: 'mainnet-beta',
            metadata: {
              name: 'Resonance',
              description: 'Trading Assistant',
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