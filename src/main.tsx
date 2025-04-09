import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { UnifiedWalletProvider } from '@jup-ag/wallet-adapter';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';

const wallets = [
  new PhantomWalletAdapter(),
];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ConnectionProvider endpoint="https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a">
    <WalletProvider wallets={wallets} autoConnect={false}>
      <UnifiedWalletProvider
        wallets={wallets}
        config={{
          autoConnect: false,
          env: 'mainnet-beta',
          metadata: {
            name: 'Jupiter Terminal App',
            description: 'Swap UI with Jupiter',
            url: 'http://localhost:5173',
            iconUrls: [],
          },
        }}
      >
        <App />
      </UnifiedWalletProvider>
    </WalletProvider>
  </ConnectionProvider>
);