import { WhaleWallet, Trade, WhaleTrackerConfig, WhaleAnalytics } from '../../types/whale-tracker/types';

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

export class HeliusService {
  private static instance: HeliusService;
  private heliusApiKey: string;

  private constructor() {
    this.heliusApiKey = import.meta.env.VITE_HELIUS_API_KEY || '';
  }

  public static getInstance(): HeliusService {
    if (!HeliusService.instance) {
      HeliusService.instance = new HeliusService();
    }
    return HeliusService.instance;
  }

  public getApiKey(): string {
    return this.heliusApiKey;
  }

  async getTransactions(address: string): Promise<Transaction[]> {
    try {
      const response = await fetch(`http://localhost:3001/api/v1/whale-tracking/transactions/${address}`);
      
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
      const response = await fetch(`http://localhost:3001/api/v1/whale-tracking/token-price/${mintAddress}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch token price: ${response.statusText}`);
      }

      const data = await response.json();
      return data.price;
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
      // Using Helius Enhanced RPC method for transaction history
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
    // Using Helius DAS API to get historical prices
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

        const valueIn = trade.tokenIn.amount * (priceInData.result?.price || 0);
        const valueOut = trade.tokenOut.amount * (priceOutData.result?.price || 0);
        const profitPercentage = ((valueOut - valueIn) / valueIn) * 100;

        return {
          ...trade,
          isProfit: profitPercentage > 0,
          profitPercentage
        };
      } catch (error) {
        console.error('Error calculating trade profitability:', error);
        return {
          ...trade,
          isProfit: false,
          profitPercentage: 0
        };
      }
    }));
  }

  async getWhaleAnalytics(address: string, config: WhaleTrackerConfig): Promise<WhaleAnalytics> {
    try {
      const trades = await this.getWhaleTrades(address, config);
      const profitableTrades = trades.filter(trade => trade.isProfit).length;
      const totalTrades = trades.length;
      const profitabilityRate = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;
      
      const profitPercentages = trades
        .filter(trade => trade.profitPercentage !== undefined)
        .map(trade => trade.profitPercentage!);
      
      const averageProfitPercentage = profitPercentages.length > 0
        ? profitPercentages.reduce((a, b) => a + b, 0) / profitPercentages.length
        : 0;

      const lastTradeTimestamp = trades.length > 0
        ? Math.max(...trades.map(t => t.timestamp))
        : 0;

      return {
        address,
        profitableTrades,
        totalTrades,
        profitabilityRate,
        averageProfitPercentage,
        lastTradeTimestamp,
        recentTrades: trades.slice(0, 10) // Return only the 10 most recent trades
      };
    } catch (error) {
      console.error('Error getting whale analytics:', error);
      throw error;
    }
  }

  async getWhaleTrades(address: string, config: WhaleTrackerConfig): Promise<Trade[]> {
    try {
      const response = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${this.heliusApiKey}`);
      if (!response.ok) throw new Error('Failed to fetch transactions');
      
      const transactions: Transaction[] = await response.json();
      const trades: Trade[] = [];
      
      // Filter transactions within the timeframe
      const cutoffTime = Date.now() - (config.timeframe * 24 * 60 * 60 * 1000);
      
      for (const tx of transactions) {
        if (tx.timestamp < cutoffTime) continue;
        
        // Look for swap-like transactions
        if (tx.tokenTransfers && tx.tokenTransfers.length >= 2) {
          const tokenIn = tx.tokenTransfers.find(t => t.fromUserAccount === address);
          const tokenOut = tx.tokenTransfers.find(t => t.toUserAccount === address);
          
          if (tokenIn && tokenOut) {
            // Get prices at the time of the trade
            const tokenInPrice = await this.getTokenPrice(tokenIn.mint);
            const tokenOutPrice = await this.getTokenPrice(tokenOut.mint);
            
            const tokenInValue = tokenIn.tokenAmount * tokenInPrice;
            const tokenOutValue = tokenOut.tokenAmount * tokenOutPrice;
            
            const profitPercentage = ((tokenOutValue - tokenInValue) / tokenInValue) * 100;
            const isProfit = profitPercentage > (config.profitabilityThreshold || 0);
            
            trades.push({
              timestamp: tx.timestamp,
              tokenIn: {
                mint: tokenIn.mint,
                amount: tokenIn.tokenAmount,
              },
              tokenOut: {
                mint: tokenOut.mint,
                amount: tokenOut.tokenAmount,
              },
              isProfit,
              profitPercentage
            });
          }
        }
      }
      
      return trades.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Error fetching whale trades:', error);
      return [];
    }
  }

  async trackWhaleMovements(config: WhaleTrackerConfig) {
    try {
      // Subscribe to Helius webhook for real-time updates
      const response = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${this.heliusApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookURL: `${window.location.origin}/api/whale-webhook`,
          accountAddresses: [], // Will be populated with whale addresses
          transactionTypes: ['SWAP', 'TOKEN_TRANSFER'],
          webhook: {
            includeMetadata: true,
            includeTokenTransfers: true
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to set up webhook');
      }

      // Set up WebSocket connection for real-time updates
      const ws = new WebSocket(`wss://api.helius.xyz/v0/ws?api-key=${this.heliusApiKey}`);

      ws.onopen = () => {
        console.log('WebSocket connection established');
        // Subscribe to token mint address
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'accountSubscribe',
          params: [
            config.targetTokenMint,
            { encoding: 'jsonParsed', commitment: 'confirmed' }
          ]
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.method === 'accountNotification') {
            const accountInfo = data.params.result;
            
            // Check if this is a significant movement (above minTokenAmount)
            if (accountInfo.data.parsed?.info?.tokenAmount?.uiAmount >= config.minTokenAmount) {
              const address = accountInfo.data.parsed.info.owner;
              
              // Get analytics for the whale
              const analytics = await this.getWhaleAnalytics(address, config);
              
              // Dispatch custom event with whale movement data
              const whaleEvent = new CustomEvent('whale-movement', {
                detail: {
                  address,
                  timestamp: Date.now(),
                  analytics
                }
              });
              
              window.dispatchEvent(whaleEvent);
            }
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed');
        // Attempt to reconnect after a delay
        setTimeout(() => this.trackWhaleMovements(config), 5000);
      };

      return () => {
        ws.close();
      };
    } catch (error) {
      console.error('Error setting up whale tracking:', error);
      throw error;
    }
  }
} 