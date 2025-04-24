import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load .env file from backend directory
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

async function main() {
    console.log('Checking strategies table...');
    
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
        // First, let's check the table structure
        console.log('\nChecking table structure...');
        const columnsResult = await pool.query(`
            SELECT column_name, data_type, column_default
            FROM information_schema.columns
            WHERE table_name = 'strategies'
            ORDER BY ordinal_position;
        `);
        console.log('Table columns:', columnsResult.rows);

        // Get the most recent strategy
        console.log('\nChecking most recent strategy...');
        const result = await pool.query(`
            SELECT 
                id, 
                trading_wallet_id, 
                strategy_type, 
                config, 
                is_active, 
                name,
                created_at,
                updated_at,
                last_executed,
                next_execution
            FROM strategies 
            ORDER BY created_at DESC 
            LIMIT 1;
        `);

        if (result.rows.length > 0) {
            console.log('Most recent strategy:', result.rows[0]);
        } else {
            console.log('No strategies found in the database.');
        }

        // Get total count of strategies
        const countResult = await pool.query('SELECT COUNT(*) FROM strategies;');
        console.log('\nTotal number of strategies:', countResult.rows[0].count);

    } catch (error) {
        console.error('Error querying database:', error);
    } finally {
        await pool.end();
    }
}

// Run the script
main().catch(console.error); 