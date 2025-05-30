import { API_CONFIG } from '../../config/api';
import axios from 'axios';

const API_BASE = `${API_CONFIG.API_BASE}/saved-wallets`;

export const savedWalletsApi = {
  async getAll(owner_id: string) {
    const { data } = await axios.get(API_BASE, { params: { owner_id } });
    return data;
  },
  async create(wallet: { owner_id: string, wallet_address: string, name?: string, extra_data?: Record<string, unknown> }) {
    const { data } = await axios.post(API_BASE, wallet);
    return data;
  },
  async update(id: string, updates: { name?: string, extra_data?: Record<string, unknown> }) {
    const { data } = await axios.put(`${API_BASE}/${id}`, updates);
    return data;
  },
  async remove(id: string) {
    await axios.delete(`${API_BASE}/${id}`);
  }
}; 