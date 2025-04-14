import React, { useState, useEffect, useCallback } from 'react';
import { PublicKey, Connection } from '@solana/web3.js';
import { tokenService } from '../services/tokenService';
import { TokenLogo } from './TokenLogo';

interface TokenAccountData {
  parsed: {
    info: {
      mint: string;
      tokenAmount: {
        amount: string;
        uiAmount: number | null;
      };
    };
  };
}

interface TokenBalance {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
  balance: number;
  uiBalance: number;
  priceUSD: number;
  usdValue: number;
}

interface TokenBalancesListProps {
  walletAddress: string;
  connection: Connection;
  displayMode?: 'full' | 'total-only';
  onRpcError?: () => void;
}

export const TokenBalancesList: React.FC<TokenBalancesListProps> = ({ 
  walletAddress, 
  connection, 
  displayMode = 'full',
  onRpcError 
}) => {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [totalUsdValue, setTotalUsdValue] = useState(0);

  const fetchBalances = useCallback(async () => {
    if (!walletAddress || !connection) return;

    try {
      // Get token accounts from RPC
      const tokenAccounts = await connection.getTokenAccountsByOwner(
        new PublicKey(walletAddress),
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      const newBalances: TokenBalance[] = [];

      // Process each token account
      for (const account of tokenAccounts.value) {
        const accountData = account.account.data;
        if (typeof accountData === 'object' && 'parsed' in accountData) {
          const parsedInfo = (accountData as TokenAccountData).parsed.info;
          if (parsedInfo && 'tokenAmount' in parsedInfo) {
            // Get token metadata from Supabase
            const token = await tokenService.getTokenByMint(parsedInfo.mint);
            
            if (token) {
              newBalances.push({
                mint: parsedInfo.mint,
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals,
                logoURI: token.logo_uri,
                balance: Number(parsedInfo.tokenAmount.amount),
                uiBalance: parsedInfo.tokenAmount.uiAmount || 0,
                priceUSD: token.price_usd,
                usdValue: token.price_usd * (parsedInfo.tokenAmount.uiAmount || 0)
              });
            }
          }
        }
      }

      // Calculate total USD value
      const total = newBalances.reduce((sum, balance) => sum + (balance.usdValue || 0), 0);
      
      setBalances(newBalances);
      setTotalUsdValue(total);
    } catch (error) {
      console.error('Error fetching balances:', error);
      if (onRpcError) onRpcError();
    } finally {
      setIsInitialLoad(false);
    }
  }, [walletAddress, connection, onRpcError]);

  // Initial fetch
  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  // Show loading state
  if (isInitialLoad) {
    return (
      <div style={{ color: '#94a3b8', padding: '1rem' }}>
        <div>Fetching token balances...</div>
      </div>
    );
  }

  // Show empty state
  if (balances.length === 0) {
    return <div style={{ color: '#94a3b8' }}>No tokens found</div>;
  }

  // Show total only mode
  if (displayMode === 'total-only') {
    return (
      <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
        Portfolio Value: ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    );
  }

  // Show full list
  return (
    <div>
      {balances.map(balance => (
        <div key={balance.mint} style={{ 
          display: 'flex', 
          alignItems: 'center', 
          padding: '0.5rem',
          borderBottom: '1px solid #2d3748'
        }}>
          <TokenLogo 
            logoURI={balance.logoURI} 
            symbol={balance.symbol} 
            size={24}
          />
          <div style={{ flex: 1, marginLeft: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{balance.symbol}</span>
              <span>${balance.usdValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8' }}>
              <span>{balance.uiBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              <span>${balance.priceUSD?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}; 