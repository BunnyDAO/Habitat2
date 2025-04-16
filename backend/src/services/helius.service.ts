import { createClient } from 'redis';
import { TokenBalance } from '../types';
import { Connection } from '@solana/web3.js';
import { WhaleWallet, Trade, WhaleTrackerConfig, WhaleAnalytics } from '../types/whale-tracker/types';

interface TokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  tokenAmount: number;
  mint: string;
  type: 'in' | 'out';
  amount: string;
  symbol?: string;
}

interface Transaction {
  signature: string;
  timestamp: number;
  type: string;
  source: string;
  tokenTransfers: TokenTransfer[];
}

interface TokenHolder {
  address: string;
  amount: string;
  decimals: number;
  symbol?: string;
}

interface RateLimiter {
  check: (key: string) => Promise<boolean>;
  reset: (key: string) => void;
}

export class HeliusService {
  private connection: Connection;
  private heliusApiKey: string;
  private redisClient: ReturnType<typeof createClient> | null;
  private rateLimiter: RateLimiter | null;

  constructor(heliusApiKey: string, redisClient: ReturnType<typeof createClient> | null = null) {
    this.heliusApiKey = heliusApiKey;
    this.redisClient = redisClient;
    this.connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
    this.rateLimiter = null;
  }

  async getWalletBalances(walletAddress: string): Promise<TokenBalance[]> {
    console.log(`Fetching balances for wallet: ${walletAddress}`);
    
    try {
      // Check Redis cache first if available
      if (this.redisClient?.isOpen) {
        try {
          const cachedBalances = await this.redisClient.get(`balances:${walletAddress}`);
          if (cachedBalances) {
            console.log('Cache hit! Returning cached balances');
            return JSON.parse(cachedBalances);
          }
        } catch (redisError) {
          console.error('Redis error:', redisError);
          // Continue with Helius API call if Redis fails
        }
      }
      
      console.log('Cache miss or Redis unavailable, fetching from Helius');
      console.log('Making Helius API request...');
      
      const maxRetries = 3;
      const baseDelay = 1000; // 1 second
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          // First get SOL balance
          const solResponse = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: '1',
              method: 'getBalance',
              params: [walletAddress]
            }),
          });

          if (solResponse.status === 429) {
            if (attempt < maxRetries - 1) {
              const delay = baseDelay * Math.pow(2, attempt);
              console.log(`Rate limited. Retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            } else {
              throw new Error('Rate limit exceeded after multiple retries');
            }
          }

          if (!solResponse.ok) {
            throw new Error(`Helius API error: ${solResponse.statusText}`);
          }

          const solData = await solResponse.json();
          console.log('SOL balance response:', JSON.stringify(solData, null, 2));
          console.log('SOL balance raw value:', solData.result);
          console.log('SOL balance type:', typeof solData.result?.value);
          console.log('SOL balance value:', solData.result?.value);
          console.log('SOL balance in lamports:', solData.result?.value ? BigInt(solData.result.value).toString() : 'undefined');
          console.log('SOL balance in SOL:', solData.result?.value ? (Number(solData.result.value) / 1e9).toFixed(9) : 'undefined');

          // Then get token accounts
          const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: '1',
              method: 'getTokenAccountsByOwner',
              params: [
                walletAddress,
                {
                  programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
                },
                {
                  encoding: 'jsonParsed'
                }
              ]
            }),
          });

          if (!response.ok) {
            throw new Error(`Helius API error: ${response.statusText}`);
          }

          const data = await response.json();
          console.log('Token accounts response:', JSON.stringify(data, null, 2));

          if (data.error) {
            throw new Error(`Helius API error: ${data.error.message}`);
          }

          // Start with SOL balance
          const balances: TokenBalance[] = [];
          
          if (solData.result?.value !== undefined) {
            const solBalanceInSol = Number(solData.result.value) / 1e9;
            console.log('Calculated SOL balance:', solBalanceInSol);
            const solBalance = {
              mint: 'So11111111111111111111111111111111111111112',
              symbol: 'SOL',
              name: 'Solana',
              balance: solBalanceInSol,
              decimals: 9,
              logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
              lastUpdated: new Date()
            };
            console.log('Adding SOL balance to final list:', JSON.stringify(solBalance, null, 2));
            balances.push(solBalance);
          } else {
            console.warn('No SOL balance found in response for wallet:', walletAddress);
          }

          // Add token balances
          if (data.result?.value) {
            const tokenBalances = data.result.value.map((account: { 
              account: { 
                data: { 
                  parsed: { 
                    info: { 
                      mint: string; 
                      tokenAmount: { 
                        amount: string; 
                        decimals: number; 
                      }; 
                    }; 
                  }; 
                }; 
              }; 
            }) => {
              const info = account.account.data.parsed.info;
              const tokenAmount = info.tokenAmount;
              return {
                mint: info.mint,
                symbol: info.mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC' : 
                       info.mint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' ? 'USDT' :
                       info.mint.slice(0, 6),
                name: info.mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USD Coin' :
                      info.mint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' ? 'USDT' :
                      info.mint.slice(0, 6),
                balance: Number(tokenAmount.amount) / Math.pow(10, tokenAmount.decimals),
                decimals: tokenAmount.decimals,
                logoURI: info.mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 
                        'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' :
                        info.mint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' ?
                        'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' :
                        undefined,
                lastUpdated: new Date()
              };
            });
            balances.push(...tokenBalances);
          }

          // Try to cache the results in Redis
          if (this.redisClient?.isOpen) {
            try {
              await this.redisClient.setEx(
                `balances:${walletAddress}`,
                5, // Cache for 5 seconds
                JSON.stringify(balances)
              );
              console.log('Successfully cached balances in Redis');
            } catch (redisError) {
              console.error('Error caching in Redis:', redisError);
              // Continue even if caching fails
            }
          }

          return balances;
        } catch (error) {
          console.error(`Error in attempt ${attempt + 1}:`, error);
          if (error instanceof Error && error.message.includes('Rate limit exceeded')) {
            throw error;
          }
        }
      }

      throw new Error('All attempts failed');
    } catch (error) {
      console.error('Error in getWalletBalances:', error);
      throw error;
    }
  }

  async getTransactions(address: string): Promise<Transaction[]> {
    try {
      const response = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${this.heliusApiKey}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch transactions: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching transactions:', error);
      throw error;
    }
  }

  async getTokenPrice(mintAddress: string): Promise<number> {
    try {
      const response = await fetch(`https://price.jup.ag/v4/price?ids=${mintAddress}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch token price: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data[mintAddress]?.price || 0;
    } catch (error) {
      console.error('Error fetching token price:', error);
      throw error;
    }
  }

  async getTokenHolders(tokenMint: string, minAmount: number): Promise<WhaleWallet[]> {
    try {
      const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'my-id',
          method: 'getTokenLargestAccounts',
          params: [tokenMint]
        })
      });

      const data = await response.json();
      const holders = data.result?.value || [];

      const whaleHolders = holders
        .filter((holder: TokenHolder) => {
          const amount = parseFloat(holder.amount) / Math.pow(10, holder.decimals || 0);
          return amount >= minAmount;
        })
        .map((holder: TokenHolder) => ({
          address: holder.address,
          tokenHoldings: [{
            mint: tokenMint,
            amount: parseFloat(holder.amount) / Math.pow(10, holder.decimals || 0),
            symbol: holder.symbol || 'Unknown'
          }]
        }));

      return whaleHolders;
    } catch (error) {
      console.error('Error fetching token holders:', error);
      return [];
    }
  }

  async getWalletTrades(address: string, timeframe: number): Promise<Trade[]> {
    const endTime = new Date();
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - timeframe);

    try {
      const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'my-id',
          method: 'searchTransactions',
          params: {
            account: address,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            type: 'SWAP'
          }
        })
      });

      const data = await response.json();
      return this.parseTradesFromTransactions(data.result);
    } catch (error) {
      console.error('Error fetching wallet trades:', error);
      return [];
    }
  }

  private parseTradesFromTransactions(transactions: Transaction[]): Trade[] {
    return transactions
      .map(tx => {
        if (!tx.tokenTransfers || tx.tokenTransfers.length < 2) return null;

        const tokenIn = tx.tokenTransfers.find(t => t.type === 'out');
        const tokenOut = tx.tokenTransfers.find(t => t.type === 'in');

        if (!tokenIn || !tokenOut) return null;

        return {
          timestamp: new Date(tx.timestamp).getTime(),
          tokenIn: {
            mint: tokenIn.mint,
            amount: parseFloat(tokenIn.amount),
            symbol: tokenIn.symbol
          },
          tokenOut: {
            mint: tokenOut.mint,
            amount: parseFloat(tokenOut.amount),
            symbol: tokenOut.symbol
          }
        };
      })
      .filter(Boolean) as Trade[];
  }

  async calculateTradesProfitability(trades: Trade[]): Promise<Trade[]> {
    return Promise.all(trades.map(async trade => {
      try {
        const [priceInResponse, priceOutResponse] = await Promise.all([
          fetch(`https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'price-in',
              method: 'getAssetPriceByMint',
              params: {
                mint: trade.tokenIn.mint,
                timestamp: new Date(trade.timestamp).toISOString()
              }
            })
          }),
          fetch(`https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'price-out',
              method: 'getAssetPriceByMint',
              params: {
                mint: trade.tokenOut.mint,
                timestamp: new Date(trade.timestamp).toISOString()
              }
            })
          })
        ]);

        const [priceInData, priceOutData] = await Promise.all([
          priceInResponse.json(),
          priceOutResponse.json()
        ]);

        const priceIn = priceInData.result?.price || 0;
        const priceOut = priceOutData.result?.price || 0;

        const valueIn = trade.tokenIn.amount * priceIn;
        const valueOut = trade.tokenOut.amount * priceOut;
        const profit = valueOut - valueIn;
        const profitPercentage = (profit / valueIn) * 100;

        return {
          ...trade,
          profit,
          profitPercentage
        };
      } catch (error) {
        console.error('Error calculating trade profitability:', error);
        return trade;
      }
    }));
  }

  async getWhaleAnalytics(address: string, config: WhaleTrackerConfig): Promise<WhaleAnalytics> {
    try {
      const response = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${this.heliusApiKey}`);
      const transactions = await response.json();

      // Calculate analytics based on transactions and config
      const trades = this.parseTradesFromTransactions(transactions);
      const profitableTrades = trades.filter(trade => (trade.profitPercentage || 0) > 0);
      const totalVolume = trades.reduce((sum, trade) => sum + (trade.tokenIn.amount || 0), 0);
      const averageTradeSize = trades.length > 0 ? totalVolume / trades.length : 0;
      const winRate = trades.length > 0 ? (profitableTrades.length / trades.length) * 100 : 0;
      const averageProfitPercentage = profitableTrades.length > 0 
        ? profitableTrades.reduce((sum, trade) => sum + (trade.profitPercentage || 0), 0) / profitableTrades.length 
        : 0;
      const largestTrade = trades.length > 0 
        ? Math.max(...trades.map(trade => trade.tokenIn.amount || 0)) 
        : 0;

      // Find most traded and most profitable tokens
      const tokenStats = new Map<string, { count: number; totalProfit: number }>();
      trades.forEach(trade => {
        const tokenIn = trade.tokenIn.mint;
        const tokenOut = trade.tokenOut.mint;
        const profit = trade.profit || 0;

        tokenStats.set(tokenIn, {
          count: (tokenStats.get(tokenIn)?.count || 0) + 1,
          totalProfit: (tokenStats.get(tokenIn)?.totalProfit || 0) + profit
        });
        tokenStats.set(tokenOut, {
          count: (tokenStats.get(tokenOut)?.count || 0) + 1,
          totalProfit: (tokenStats.get(tokenOut)?.totalProfit || 0) + profit
        });
      });

      const mostTradedToken = Array.from(tokenStats.entries())
        .sort((a, b) => b[1].count - a[1].count)[0]?.[0] || '';
      const mostProfitableToken = Array.from(tokenStats.entries())
        .sort((a, b) => b[1].totalProfit - a[1].totalProfit)[0]?.[0] || '';

      return {
        totalTrades: trades.length,
        profitableTrades: profitableTrades.length,
        totalVolume,
        averageTradeSize,
        winRate,
        averageProfitPercentage,
        largestTrade,
        mostTradedToken,
        mostProfitableToken
      };
    } catch (error) {
      console.error('Error getting whale analytics:', error);
      throw error;
    }
  }

  async getWhaleTrades(address: string, config: WhaleTrackerConfig): Promise<Trade[]> {
    try {
      const response = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${this.heliusApiKey}`);
      const transactions = await response.json();

      // Filter and process trades based on config
      const trades = this.parseTradesFromTransactions(transactions);
      
      // Apply config filters
      return trades.filter(trade => {
        if (config.minTradeSize && (trade.tokenIn.amount < config.minTradeSize)) {
          return false;
        }
        if (config.minProfitPercentage && (trade.profitPercentage || 0) < config.minProfitPercentage) {
          return false;
        }
        if (config.timeframe) {
          const cutoffTime = Date.now() - (config.timeframe * 24 * 60 * 60 * 1000);
          if (trade.timestamp < cutoffTime) {
            return false;
          }
        }
        return true;
      });
    } catch (error) {
      console.error('Error getting whale trades:', error);
      throw error;
    }
  }
} 