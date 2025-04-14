import { Request, Response } from 'express';
import { TokenMetadataService } from '../services/token-metadata.service';

export class TokenMetadataController {
  private service: TokenMetadataService;

  constructor(service: TokenMetadataService) {
    this.service = service;
  }

  async getTokenMetadata(req: Request, res: Response) {
    try {
      const { address } = req.params;
      const metadata = await this.service.getTokenMetadata(address);
      
      if (!metadata) {
        return res.status(404).json({ error: 'Token not found' });
      }

      res.json(metadata);
    } catch (error) {
      console.error('Error getting token metadata:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async hideToken(req: Request, res: Response) {
    try {
      const { walletAddress, tokenAddress } = req.body;
      
      if (!walletAddress || !tokenAddress) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      await this.service.hideToken(walletAddress, tokenAddress);
      res.json({ success: true });
    } catch (error) {
      console.error('Error hiding token:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async showToken(req: Request, res: Response) {
    try {
      const { walletAddress, tokenAddress } = req.body;
      
      if (!walletAddress || !tokenAddress) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      await this.service.showToken(walletAddress, tokenAddress);
      res.json({ success: true });
    } catch (error) {
      console.error('Error showing token:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getHiddenTokens(req: Request, res: Response) {
    try {
      const { walletAddress } = req.params;
      
      if (!walletAddress) {
        return res.status(400).json({ error: 'Missing wallet address' });
      }

      const hiddenTokens = await this.service.getHiddenTokens(walletAddress);
      res.json({ hiddenTokens });
    } catch (error) {
      console.error('Error getting hidden tokens:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
} 