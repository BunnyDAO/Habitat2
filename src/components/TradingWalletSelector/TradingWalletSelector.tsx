import React, { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { TradingWallet } from '../../types/wallet';
import { tradingWalletService } from '../../services/tradingWalletService';

export const TradingWalletSelector: React.FC = () => {
  const { publicKey } = useWallet();
  const [wallets, setWallets] = useState<TradingWallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<TradingWallet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (publicKey) {
      fetchWallets();
    }
  }, [publicKey]);

  const fetchWallets = async () => {
    if (!publicKey) return;
    
    setLoading(true);
    setError(null);
    try {
      const fetchedWallets = await tradingWalletService.fetchWallets(publicKey.toString());
      setWallets(fetchedWallets);
    } catch (err) {
      setError('Failed to fetch trading wallets');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWallet = async () => {
    if (!publicKey) return;

    setLoading(true);
    setError(null);
    try {
      // Create a new wallet object with required fields
      const newWallet: TradingWallet = {
        publicKey: 'pending', // Temporary value, will be replaced by backend
        name: `Trading Wallet ${wallets.length + 1}`,
        createdAt: Date.now()
      };

      const savedWallet = await tradingWalletService.saveWallet(publicKey.toString(), newWallet);
      if (savedWallet) {
        setWallets([...wallets, savedWallet]);
      } else {
        throw new Error('Failed to save wallet');
      }
    } catch (err) {
      setError('Failed to create trading wallet');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWallet = async (walletToDelete: TradingWallet) => {
    setLoading(true);
    setError(null);
    try {
      const success = await tradingWalletService.deleteWallet(walletToDelete.publicKey);
      if (success) {
        setWallets(wallets.filter(w => w.publicKey !== walletToDelete.publicKey));
        if (selectedWallet?.publicKey === walletToDelete.publicKey) {
          setSelectedWallet(null);
        }
      } else {
        throw new Error('Failed to delete wallet');
      }
    } catch (err) {
      setError('Failed to delete trading wallet');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (!publicKey) {
    return <div>Please connect your wallet to manage trading wallets.</div>;
  }

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      
      <h3>Trading Wallets</h3>
      
      <button onClick={handleCreateWallet} disabled={loading}>
        Create New Trading Wallet
      </button>

      <div style={{ marginTop: '1rem' }}>
        {wallets.length === 0 ? (
          <div>No trading wallets found. Create one to get started.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {wallets.map((wallet) => (
              <li key={wallet.publicKey} style={{ marginBottom: '0.5rem' }}>
                <button
                  onClick={() => setSelectedWallet(wallet)}
                  style={{
                    backgroundColor: selectedWallet?.publicKey === wallet.publicKey ? '#4CAF50' : '#f0f0f0',
                    color: selectedWallet?.publicKey === wallet.publicKey ? 'white' : 'black',
                    border: 'none',
                    padding: '8px 16px',
                    marginRight: '8px',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  {wallet.name || wallet.publicKey}
                </button>
                <button
                  onClick={() => handleDeleteWallet(wallet)}
                  style={{
                    backgroundColor: '#ff4444',
                    color: 'white',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}; 