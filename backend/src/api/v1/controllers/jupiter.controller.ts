import { Request, Response } from 'express';
import { JupiterService } from '../../../services/jupiter.service';
import { SwapService } from '../../../services/swap.service';
import { Connection } from '@solana/web3.js';

export class JupiterController {
  private jupiterService: JupiterService;
  private swapService: SwapService;

  constructor(jupiterService: JupiterService) {
    this.jupiterService = jupiterService;
    // Initialize swap service with connection
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    this.swapService = new SwapService(connection);
  }

  getTokenPrice = async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const price = await this.jupiterService.getTokenPrice(token);
      res.json({ price });
    } catch (error) {
      console.error('Error fetching token price:', error);
      res.status(500).json({ error: 'Failed to fetch token price' });
    }
  };

  getTokenPrices = async (req: Request, res: Response) => {
    try {
      const { tokens } = req.query;
      const tokenList = typeof tokens === 'string' ? tokens.split(',') : [];
      const prices = await this.jupiterService.getTokenPrices(tokenList);
      res.json(prices);
    } catch (error) {
      console.error('Error fetching token prices:', error);
      res.status(500).json({ error: 'Failed to fetch token prices' });
    }
  };

  getQuote = async (req: Request, res: Response) => {
    try {
      const { inputMint, outputMint, amount, slippageBps, platformFeeBps } = req.query;
      
      if (!inputMint || !outputMint || !amount) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      const quote = await this.jupiterService.getQuote(
        inputMint as string,
        outputMint as string,
        Number(amount),
        slippageBps ? Number(slippageBps) : undefined,
        platformFeeBps ? Number(platformFeeBps) : undefined
      );

      res.json(quote);
    } catch (error) {
      console.error('Error fetching quote:', error);
      res.status(500).json({ error: 'Failed to fetch quote' });
    }
  };

  getAllTokens = async (req: Request, res: Response) => {
    try {
      const tokens = await this.jupiterService.getAllTokens();
      res.json(tokens);
    } catch (error) {
      console.error('Error fetching tokens:', error);
      res.status(500).json({ error: 'Failed to fetch tokens' });
    }
  };

  executeSwap = async (req: Request, res: Response) => {
    try {
      const {
        quoteResponse,
        userPublicKey,
        feeAccount
      } = req.body;

      if (!quoteResponse || !userPublicKey) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      const result = await this.jupiterService.executeSwap(
        quoteResponse,
        userPublicKey,
        feeAccount
      );

      res.json(result);
    } catch (error) {
      console.error('Swap execution error:', error);
      res.status(500).json({ error: error.message });
    }
  };
} 