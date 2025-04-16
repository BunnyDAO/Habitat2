import React from 'react';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { defaultConnection } from './utils/connection';

const App: React.FC = () => {
  return (
    <ConnectionProvider endpoint={defaultConnection.rpcEndpoint}>
      <div>Your app content here</div>
    </ConnectionProvider>
  );
};

export default App; 