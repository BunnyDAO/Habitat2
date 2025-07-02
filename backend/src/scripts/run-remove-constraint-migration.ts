import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load .env file from backend directory
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

async function runMigration() {
    console.log('Running strategy unique constraint removal migration...');
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
        const migrationPath = path.join(__dirname, '../database/migrations/008_remove_strategy_unique_constraint.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        
        console.log('Executing migration from:', migrationPath);
        
        // Execute the migration
        await pool.query(migrationSQL);
        console.log('Migration executed successfully!');

    } catch (error) {
        console.error('Error during migration:', error);
        throw error;
    } finally {
        await pool.end();
        console.log('Migration completed');
    }
}

// Run the migration
runMigration().catch(console.error);
