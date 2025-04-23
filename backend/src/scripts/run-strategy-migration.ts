import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load .env file from backend directory
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

async function main() {
    console.log('Starting strategy management migration...');
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

        // Read the migration file
        const migrationPath = path.join(__dirname, '../database/migrations/004_add_strategy_management.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        // Start a transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            console.log('Started transaction');

            // Execute the migration
            await client.query(migrationSQL);
            console.log('Successfully executed migration');

            await client.query('COMMIT');
            console.log('Successfully committed transaction');
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