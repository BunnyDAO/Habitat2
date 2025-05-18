import { Router } from 'express';
import { WhaleTrackingController } from '../controllers/whale-tracking.controller';
import { WebSocketServer } from 'ws';
import { HeliusService } from '../services/helius.service';

if (!process.env.HELIUS_API_KEY) {
  throw new Error('HELIUS_API_KEY environment variable is required');
}

const router = Router();
const heliusService = new HeliusService(process.env.HELIUS_API_KEY);
const controller = new WhaleTrackingController(heliusService);

// Create WebSocket server
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'subscribe') {
        // Handle subscription logic here
        // You can store the WebSocket connection and config for later use
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});

// Token holders endpoints
router.get('/token-holders', controller.getTokenHolders.bind(controller));

// Wallet trades endpoints
router.get('/wallet-trades', controller.getWalletTrades.bind(controller));
router.post('/calculate-profitability', controller.calculateTradesProfitability.bind(controller));

// Whale analytics endpoints
router.post('/analytics/:address', controller.getWhaleAnalytics.bind(controller));
router.post('/trades/:address', controller.getWhaleTrades.bind(controller));

export { router, wss }; 