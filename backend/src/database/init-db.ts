import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function initializeDatabase() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        console.log('Reading schema file...');
        const schemaPath = join(__dirname, 'schema.sql');
        const schema = readFileSync(schemaPath, 'utf8');

        console.log('Executing schema...');
        await pool.query(schema);
        console.log('Database schema created successfully!');

        // Insert default SOL token
        await pool.query(`
            INSERT INTO tokens (mint_address, name, symbol, decimals, logo_uri)
            VALUES (
                'So11111111111111111111111111111111111111112',
                'Solana',
                'SOL',
                9,
                'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'
            )
            ON CONFLICT (mint_address) DO UPDATE
            SET name = EXCLUDED.name,
                symbol = EXCLUDED.symbol,
                decimals = EXCLUDED.decimals,
                logo_uri = EXCLUDED.logo_uri;
        `);
        console.log('Default SOL token added!');

    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        await pool.end();
    }
}

initializeDatabase(); 