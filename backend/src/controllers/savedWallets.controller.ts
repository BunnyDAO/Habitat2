import { Request, Response } from 'express';
import db from '../database/pool';
import { v4 as uuidv4 } from 'uuid';

// GET /api/v1/saved-wallets?owner_id=...
export async function getSavedWallets(req: Request, res: Response) {
  const { owner_id } = req.query;
  if (!owner_id) return res.status(400).json({ error: 'owner_id is required' });
  try {
    const { rows } = await db.query(
      'SELECT * FROM saved_wallets WHERE owner_id = $1 ORDER BY created_at DESC',
      [owner_id]
    );
    res.json(rows);
  } catch (_err) {
    res.status(500).json({ error: 'Failed to fetch saved wallets' });
  }
}

// POST /api/v1/saved-wallets
export async function createSavedWallet(req: Request, res: Response) {
  const { owner_id, wallet_address, name, extra_data } = req.body;
  if (!owner_id || !wallet_address) return res.status(400).json({ error: 'owner_id and wallet_address are required' });
  try {
    const id = uuidv4();
    const { rows } = await db.query(
      `INSERT INTO saved_wallets (id, owner_id, wallet_address, name, extra_data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, owner_id, wallet_address, name || null, extra_data || null]
    );
    res.status(201).json(rows[0]);
  } catch (_err) {
    res.status(500).json({ error: 'Failed to create saved wallet' });
  }
}

// PUT /api/v1/saved-wallets/:id
export async function updateSavedWallet(req: Request, res: Response) {
  const { id } = req.params;
  const { name, extra_data } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    const { rows } = await db.query(
      `UPDATE saved_wallets SET name = $1, extra_data = $2, updated_at = now() WHERE id = $3 RETURNING *`,
      [name || null, extra_data || null, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Saved wallet not found' });
    res.json(rows[0]);
  } catch (_err) {
    res.status(500).json({ error: 'Failed to update saved wallet' });
  }
}

// DELETE /api/v1/saved-wallets/:id
export async function deleteSavedWallet(req: Request, res: Response) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    const { rowCount } = await db.query('DELETE FROM saved_wallets WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Saved wallet not found' });
    res.status(204).send();
  } catch (_err) {
    res.status(500).json({ error: 'Failed to delete saved wallet' });
  }
} 