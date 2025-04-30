import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load .env file from backend directory
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

async function main() {
    console.log('Starting strategy table update migration...');
    console.log('Using env file from:', envPath);
    
    // Validate environment variables
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        throw new Error('DATABASE_URL environment variable is not set');
    }

    // Initialize database connection
    const pool = new Pool({
        connectionString: dbUrl,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        // Test database connection
        const result = await pool.query('SELECT NOW()');
        console.log('Successfully connected to database at:', result.rows[0].now);

        // Start a transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            console.log('Started transaction');

            // 1. Find any duplicate strategies (same trading_wallet_id and strategy_type)
            const duplicatesResult = await client.query(`
                SELECT trading_wallet_id, strategy_type, COUNT(*), array_agg(id ORDER BY updated_at DESC) as strategy_ids
                FROM strategies
                GROUP BY trading_wallet_id, strategy_type
                HAVING COUNT(*) > 1;
            `);

            // 2. Handle duplicates by keeping the most recently updated one and removing others
            if (duplicatesResult.rows.length > 0) {
                console.log(`Found ${duplicatesResult.rows.length} sets of duplicate strategies`);
                
                for (const row of duplicatesResult.rows) {
                    const [keepId, ...removeIds] = row.strategy_ids;
                    console.log(`For wallet ${row.trading_wallet_id}, strategy type ${row.strategy_type}:`);
                    console.log(`- Keeping strategy ${keepId}`);
                    console.log(`- Removing strategies ${removeIds.join(', ')}`);

                    // Delete older duplicates
                    await client.query(`
                        DELETE FROM strategies
                        WHERE id = ANY($1);
                    `, [removeIds]);
                }
                
                console.log('Successfully handled duplicate strategies');
            } else {
                console.log('No duplicate strategies found');
            }

            // 3. Add the unique constraint
            try {
                await client.query(`
                    ALTER TABLE strategies
                    ADD CONSTRAINT unique_wallet_strategy_type
                    UNIQUE (trading_wallet_id, strategy_type);
                `);
                console.log('Successfully added unique constraint');
            } catch (error: any) {
                if (error?.code === '42P07') {
                    console.log('Unique constraint already exists, skipping...');
                } else {
                    throw error;
                }
            }

            await client.query('COMMIT');
            console.log('Successfully committed transaction');

            // Verify the constraint was added
            const verifyResult = await client.query(`
                SELECT con.*
                FROM pg_catalog.pg_constraint con
                INNER JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
                INNER JOIN pg_catalog.pg_namespace nsp ON nsp.oid = connamespace
                WHERE rel.relname = 'strategies'
                AND con.conname = 'unique_wallet_strategy_type';
            `);
            
            if (verifyResult.rows.length > 0) {
                console.log('Unique constraint verification successful');
            } else {
                console.log('Warning: Could not verify unique constraint');
            }

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error executing migration:', error);
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Error during migration:', error);
    } finally {
        await pool.end();
        console.log('Migration completed');
    }
}

// Run the migration
main().catch(console.error); 