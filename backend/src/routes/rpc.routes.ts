import { Router } from 'express';

const router = Router();

// Proxy RPC requests to Helius
router.post('/', async (req, res) => {
  try {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error proxying RPC request:', error);
    res.status(500).json({ error: 'Failed to process RPC request' });
  }
});

export default router; 