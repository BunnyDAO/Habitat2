import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('Starting trading wallet migration script...');
    
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

        // Get all trading wallets from localStorage
        const storedWallets = localStorage.getItem('tradingWallets');
        if (!storedWallets) {
            console.log('No trading wallets found in localStorage');
            return;
        }

        const allWallets: Record<string, any[]> = JSON.parse(storedWallets);
        console.log(`Found ${Object.keys(allWallets).length} wallet owners`);

        // Process each owner's wallets
        for (const [ownerAddress, wallets] of Object.entries(allWallets)) {
            console.log(`Processing wallets for owner: ${ownerAddress}`);
            
            // Start a transaction
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Insert or get user
                const userResult = await client.query(`
                    INSERT INTO users (main_wallet_pubkey)
                    VALUES ($1)
                    ON CONFLICT (main_wallet_pubkey) DO UPDATE
                    SET updated_at = NOW()
                    RETURNING id
                `, [ownerAddress]);

                const userId = userResult.rows[0].id;
                console.log(`User ID: ${userId}`);

                // Insert trading wallets
                for (const wallet of wallets) {
                    await client.query(`
                        INSERT INTO trading_wallets (user_id, wallet_pubkey, name, created_at)
                        VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
                        ON CONFLICT (wallet_pubkey) DO UPDATE
                        SET name = EXCLUDED.name,
                            updated_at = NOW()
                    `, [userId, wallet.publicKey, wallet.name || null, wallet.createdAt]);
                }

                await client.query('COMMIT');
                console.log(`Successfully migrated ${wallets.length} wallets for owner ${ownerAddress}`);

            } catch (error) {
                await client.query('ROLLBACK');
                console.error(`Error processing wallets for owner ${ownerAddress}:`, error);
            } finally {
                client.release();
            }
        }

    } catch (error) {
        console.error('Error during migration:', error);
    } finally {
        await pool.end();
        console.log('Migration completed');
    }
}

main().catch(console.error); 