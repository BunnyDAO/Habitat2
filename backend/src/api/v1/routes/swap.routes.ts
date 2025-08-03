import { Router } from 'express';
import { SwapController } from '../controllers/swap.controller';
import { SwapService } from '../../../services/swap.service';
import { Connection } from '@solana/web3.js';
import { Pool } from 'pg';
import { createClient } from 'redis';

export const createSwapRouter = (pool: Pool, connection: Connection) => {
    const router = Router();
    const redisClient = process.env.REDIS_URL ? createClient({ url: process.env.REDIS_URL }) : null;
    const swapService = new SwapService(pool, connection, redisClient);
    const swapController = new SwapController(swapService);

    router.post('/execute', swapController.executeSwap.bind(swapController));
    router.post('/execute-secure', swapController.executeSecureSwap.bind(swapController));

    return router;
}; 