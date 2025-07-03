import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load .env file from backend directory
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

async function main() {
    console.log('Checking foreign key constraints...');
    
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        throw new Error('DATABASE_URL environment variable is not set');
    }

    const pool = new Pool({
        connectionString: dbUrl,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        // Check foreign key constraints for trading_wallets table
        const constraintsResult = await pool.query(`
            SELECT 
                tc.table_name, 
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name,
                tc.constraint_name
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' 
                AND tc.table_name='trading_wallets';
        `);
        
        console.log('Foreign key constraints for trading_wallets:');
        console.log(constraintsResult.rows);

        // Check what tables reference main wallets
        const tablesResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);
        
        console.log('\nAll tables in database:');
        console.log(tablesResult.rows.map(r => r.table_name));

    } catch (error) {
        console.error('Error querying database:', error);
    } finally {
        await pool.end();
    }
}

main().catch(console.error);
