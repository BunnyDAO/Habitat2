import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

async function main() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Strategies table foreign key constraints:');
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
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' 
                AND tc.table_name='strategies'
        `);
        console.log(constraintsResult.rows);

        // Check if trading_wallets table has the right structure
        console.log('\nTrading wallets table info:');
        const twResult = await pool.query(`
            SELECT COUNT(*) as total, 
                   COUNT(CASE WHEN name LIKE 'test_%' THEN 1 END) as test_count
            FROM trading_wallets
        `);
        console.log('Total wallets:', twResult.rows[0].total, 'Test wallets:', twResult.rows[0].test_count);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await pool.end();
    }
}

main();
