import { Router } from 'express';
import { getSavedWallets, createSavedWallet, updateSavedWallet, deleteSavedWallet } from '../controllers/savedWallets.controller';

const router = Router();

// GET /api/v1/saved-wallets?owner_id=...
router.get('/', getSavedWallets);

// POST /api/v1/saved-wallets
router.post('/', createSavedWallet);

// PUT /api/v1/saved-wallets/:id
router.put('/:id', updateSavedWallet);

// DELETE /api/v1/saved-wallets/:id
router.delete('/:id', deleteSavedWallet);

export default router; 