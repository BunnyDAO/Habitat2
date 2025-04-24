import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load .env file from backend directory
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

async function main() {
    console.log('Starting strategy version migration...');
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

            // Check if version column exists
            const columnCheck = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'strategies' 
                AND column_name = 'version';
            `);

            if (columnCheck.rows.length === 0) {
                // Add version column if it doesn't exist
                await client.query(`
                    ALTER TABLE strategies 
                    ADD COLUMN version INTEGER DEFAULT 1 NOT NULL;
                `);
                console.log('Successfully added version column');

                // Update all existing rows to have version = 1
                await client.query(`
                    UPDATE strategies 
                    SET version = 1 
                    WHERE version IS NULL;
                `);
                console.log('Successfully updated existing rows with version = 1');
            } else {
                console.log('Version column already exists, skipping...');
            }

            await client.query('COMMIT');
            console.log('Successfully committed transaction');

            // Verify the column was added
            const verifyResult = await client.query(`
                SELECT column_name, data_type, column_default, is_nullable
                FROM information_schema.columns
                WHERE table_name = 'strategies'
                AND column_name = 'version';
            `);
            console.log('Version column details:', verifyResult.rows[0]);

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