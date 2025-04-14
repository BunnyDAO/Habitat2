import { Router } from 'express';
import { TokenService } from '../services/token.service';

export function createTokenRouter(tokenService: TokenService) {
    const router = Router();

    // Get metadata for a single token
    router.get('/:mintAddress', async (req, res) => {
        try {
            const { mintAddress } = req.params;
            const metadata = await tokenService.getTokenMetadata(mintAddress);
            
            if (!metadata) {
                return res.status(404).json({ error: 'Token not found' });
            }
            
            res.json(metadata);
        } catch (error) {
            console.error('Error fetching token metadata:', error);
            res.status(500).json({ error: 'Failed to fetch token metadata' });
        }
    });

    // Get metadata for multiple tokens
    router.post('/batch', async (req, res) => {
        try {
            const { mintAddresses } = req.body;
            
            if (!Array.isArray(mintAddresses)) {
                return res.status(400).json({ error: 'mintAddresses must be an array' });
            }
            
            const metadata = await tokenService.getTokensMetadata(mintAddresses);
            res.json(metadata);
        } catch (error) {
            console.error('Error fetching tokens metadata:', error);
            res.status(500).json({ error: 'Failed to fetch tokens metadata' });
        }
    });

    return router;
} 