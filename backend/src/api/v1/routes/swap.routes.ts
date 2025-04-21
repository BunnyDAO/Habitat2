import { Router } from 'express';
import { SwapController } from '../controllers/swap.controller';
import { SwapService } from '../../../services/swap.service';
import { Connection } from '@solana/web3.js';
import { Pool } from 'pg';

export const createSwapRouter = (pool: Pool, connection: Connection) => {
    const router = Router();
    const swapService = new SwapService(pool, connection);
    const swapController = new SwapController(swapService);

    router.post('/execute', swapController.executeSwap.bind(swapController));

    return router;
}; 