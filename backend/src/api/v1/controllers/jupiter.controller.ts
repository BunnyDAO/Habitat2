import { Request, Response } from 'express';
import { JupiterService } from '../services/jupiter.service';

export class JupiterController {
  private jupiterService: JupiterService;

  constructor(jupiterService: JupiterService) {
    this.jupiterService = jupiterService;
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
      const { inputMint, outputMint, amount, slippageBps } = req.query;
      
      if (!inputMint || !outputMint || !amount) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      const quote = await this.jupiterService.getQuote(
        inputMint as string,
        outputMint as string,
        Number(amount),
        slippageBps ? Number(slippageBps) : undefined
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
} 