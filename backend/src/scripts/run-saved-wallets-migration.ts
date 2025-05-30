import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const sqlPath = path.resolve(__dirname, '../database/migrations/007_create_saved_wallets.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    await pool.query(sql);
    console.log('Migration ran successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
})(); 