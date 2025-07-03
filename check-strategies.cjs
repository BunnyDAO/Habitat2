const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

// Load .env file from backend directory
const envPath = path.join(__dirname, '../backend/.env');
dotenv.config({ path: envPath });

async function checkStrategies() {
    console.log('🔍 Checking current strategies in database...\n');
    
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
        // Check all strategies for trading wallet 145
        const result = await pool.query(`
            SELECT 
                id,
                trading_wallet_id,
                strategy_type,
                config,
                created_at,
                updated_at
            FROM strategies 
            WHERE trading_wallet_id = 145
            ORDER BY created_at DESC
        `);

        console.log(`Found ${result.rows.length} strategies for trading wallet 145:`);
        console.log('=====================================');

        result.rows.forEach((row, index) => {
            console.log(`Strategy ${index + 1}:`);
            console.log(`  ID: ${row.id}`);
            console.log(`  Type: ${row.strategy_type}`);
            console.log(`  Config: ${JSON.stringify(row.config, null, 2)}`);
            console.log(`  Created: ${row.created_at}`);
            console.log(`  Updated: ${row.updated_at}`);
            console.log('---');
        });

        // Check for duplicates
        const duplicates = result.rows.filter((row, index, arr) => 
            arr.findIndex(r => 
                r.strategy_type === row.strategy_type && 
                JSON.stringify(r.config) === JSON.stringify(row.config)
            ) !== index
        );

        if (duplicates.length > 0) {
            console.log(`\n❌ Found ${duplicates.length} duplicate strategies!`);
        } else {
            console.log(`\n✅ No duplicates found`);
        }

    } catch (error) {
        console.error('Error checking strategies:', error);
    } finally {
        await pool.end();
    }
}

checkStrategies().catch(console.error);
