import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('Starting trading wallet population script...');
    
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

        // Get wallet addresses from command line arguments
        const walletAddresses = process.argv.slice(2);
        if (walletAddresses.length === 0) {
            console.log('Please provide wallet addresses as command line arguments');
            return;
        }

        console.log(`Processing ${walletAddresses.length} wallet addresses`);

        // Process each wallet address
        for (const walletAddress of walletAddresses) {
            console.log(`Processing wallet: ${walletAddress}`);
            
            // Start a transaction
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Insert or get user
                await client.query(`
                    INSERT INTO users (main_wallet_pubkey)
                    VALUES ($1)
                    ON CONFLICT (main_wallet_pubkey) DO UPDATE
                    SET updated_at = NOW()
                `, [walletAddress]);

                // Insert trading wallet
                await client.query(`
                    INSERT INTO trading_wallets (main_wallet_pubkey, wallet_pubkey, created_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (wallet_pubkey) DO UPDATE
                    SET updated_at = NOW()
                `, [walletAddress, walletAddress]);

                await client.query('COMMIT');
                console.log(`Successfully added wallet ${walletAddress}`);

            } catch (error) {
                await client.query('ROLLBACK');
                console.error(`Error processing wallet ${walletAddress}:`, error);
            } finally {
                client.release();
            }
        }

    } catch (error) {
        console.error('Error during population:', error);
    } finally {
        await pool.end();
        console.log('Population completed');
    }
}

main().catch(console.error); 