import { Router } from 'express';
import { TokenMetadataController } from '../controllers/token-metadata.controller';
import { TokenMetadataService } from '../services/token-metadata.service';
import { Pool } from 'pg';
import { createClient } from 'redis';

export function createTokenMetadataRouter(pool: Pool, redis?: ReturnType<typeof createClient> | null): Router {
  const router = Router();
  const service = new TokenMetadataService(pool, redis);
  const controller = new TokenMetadataController(service);

  // Get token metadata
  router.get('/:address', controller.getTokenMetadata.bind(controller));

  // Hide a token for a wallet
  router.post('/hide', controller.hideToken.bind(controller));

  // Show a token for a wallet
  router.post('/show', controller.showToken.bind(controller));

  // Get hidden tokens for a wallet
  router.get('/hidden/:walletAddress', controller.getHiddenTokens.bind(controller));

  return router;
} 