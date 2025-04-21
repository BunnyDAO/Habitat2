import { Request, Response } from 'express';
import { SwapService } from '../../../services/swap.service';

export class SwapController {
    private swapService: SwapService;

    constructor(swapService: SwapService) {
        if (!swapService) {
            throw new Error('SwapService is required');
        }
        this.swapService = swapService;
    }

    async executeSwap(req: Request, res: Response) {
        try {
            if (!this.swapService) {
                throw new Error('SwapService is not initialized');
            }

            const {
                inputMint,
                outputMint,
                amount,
                slippageBps,
                walletKeypair,
                feeWalletPubkey,
                feeBps
            } = req.body;

            if (!inputMint || !outputMint || !amount || !walletKeypair) {
                return res.status(400).json({ error: 'Missing required parameters' });
            }

            const result = await this.swapService.executeSwap({
                inputMint,
                outputMint,
                amount,
                slippageBps,
                walletKeypair,
                feeWalletPubkey,
                feeBps
            });

            res.json(result);
        } catch (error) {
            console.error('Error executing swap:', error);
            res.status(500).json({ 
                error: 'Failed to execute swap',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
} 