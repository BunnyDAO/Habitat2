import { Pool } from 'pg';
import { Strategy } from '../types/strategy';
import { TradingWallet } from '../../src/types/wallet';

interface StrategyJob {
    strategyId: number;
    tradingWalletId: number;
    walletPublicKey: string;
    lastExecuted: Date | null;
    nextExecution: Date | null;
}

// FUTURE: Add interfaces for secure wallet storage
/*
interface SecureKeyStore {
    encryptWallet(wallet: TradingWallet): Promise<EncryptedWallet>;
    decryptWallet(encrypted: EncryptedWallet): Promise<TradingWallet>;
    rotateKeys(): Promise<void>;
}

interface EncryptedWallet {
    publicKey: string;
    encryptedPrivateKey: string;
    encryptionMethod: 'HSM' | 'ENCLAVE' | 'SPLIT_KEY';
    metadata: Record<string, any>;
}
*/

export class StrategyManager {
    private pool: Pool;
    // CURRENT: In-memory wallet storage (requires browser to be open)
    private activeWallets: Map<string, TradingWallet> = new Map();
    
    // FUTURE: Secure wallet storage (allows running without browser)
    // private secureKeyStore: SecureKeyStore;
    // private encryptedWallets: Map<string, EncryptedWallet>;
    
    private jobQueue: StrategyJob[] = [];

    constructor(pool: Pool) {
        this.pool = pool;
        // FUTURE: Initialize secure key store
        // this.secureKeyStore = new SecureKeyStore(config);
        // this.encryptedWallets = new Map();
    }

    async initialize() {
        // Load all active strategies
        const strategies = await this.getActiveStrategies();
        
        // FUTURE: Load encrypted wallets from secure storage
        // await this.loadEncryptedWallets();
        
        // Queue them for execution
        for (const strategy of strategies) {
            await this.queueStrategy(strategy);
        }

        // Start the execution loop
        this.startExecutionLoop();
    }

    // FUTURE: Add method to load encrypted wallets
    /*
    private async loadEncryptedWallets() {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT encrypted_data FROM secure_wallets
                WHERE is_active = true
            `);
            for (const row of result.rows) {
                const wallet = await this.secureKeyStore.decryptWallet(row.encrypted_data);
                this.encryptedWallets.set(wallet.publicKey, wallet);
            }
        } finally {
            client.release();
        }
    }
    */

    private async getActiveStrategies(): Promise<Strategy[]> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT s.*, tw.wallet_pubkey
                FROM strategies s
                JOIN trading_wallets tw ON s.trading_wallet_id = tw.id
                WHERE s.is_active = true
            `);
            return result.rows;
        } finally {
            client.release();
        }
    }

    private async queueStrategy(strategy: Strategy) {
        // If it's a lackey, check if we need to reassign it
        if (strategy.is_lackey) {
            const currentWallet = await this.findWalletForLackey(strategy);
            if (currentWallet) {
                strategy.current_wallet_pubkey = currentWallet.publicKey;
                await this.updateStrategy(strategy);
            }
        }

        // Queue the strategy for execution
        this.jobQueue.push({
            strategyId: strategy.id,
            tradingWalletId: strategy.trading_wallet_id,
            walletPublicKey: strategy.current_wallet_pubkey || strategy.original_wallet_pubkey || '',
            lastExecuted: strategy.last_executed ? new Date(strategy.last_executed) : null,
            nextExecution: strategy.next_execution ? new Date(strategy.next_execution) : null
        });
    }

    private async findWalletForLackey(strategy: Strategy): Promise<TradingWallet | null> {
        const client = await this.pool.connect();
        try {
            // First try to find by original wallet
            if (strategy.original_wallet_pubkey) {
                const result = await client.query(`
                    SELECT * FROM trading_wallets 
                    WHERE wallet_pubkey = $1
                `, [strategy.original_wallet_pubkey]);
                
                if (result.rows.length > 0) {
                    return result.rows[0];
                }
            }

            // If not found, try to find by position
            if (strategy.position) {
                const result = await client.query(`
                    SELECT * FROM trading_wallets 
                    WHERE main_wallet_pubkey = $1
                    ORDER BY created_at
                    OFFSET $2 LIMIT 1
                `, [strategy.main_wallet_pubkey, strategy.position - 1]);
                
                if (result.rows.length > 0) {
                    return result.rows[0];
                }
            }

            return null;
        } finally {
            client.release();
        }
    }

    private async updateStrategy(strategy: Strategy) {
        const client = await this.pool.connect();
        try {
            await client.query(`
                UPDATE strategies 
                SET current_wallet_pubkey = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [strategy.current_wallet_pubkey, strategy.id]);
        } finally {
            client.release();
        }
    }

    private startExecutionLoop() {
        setInterval(async () => {
            const now = new Date();
            const jobsToExecute = this.jobQueue.filter(job => 
                job.nextExecution && job.nextExecution <= now
            );

            for (const job of jobsToExecute) {
                await this.executeStrategy(job);
            }
        }, 60000); // Check every minute
    }

    private async executeStrategy(job: StrategyJob) {
        // CURRENT: Get wallet from active memory (requires browser)
        const wallet = this.activeWallets.get(job.walletPublicKey);
        if (!wallet) {
            console.log(`Wallet ${job.walletPublicKey} not currently active`);
            return;
        }

        // FUTURE: Get wallet from secure storage
        /*
        let wallet;
        try {
            // Try getting from active wallets first (for backward compatibility)
            wallet = this.activeWallets.get(job.walletPublicKey);
            
            // If not active, try getting from secure storage
            if (!wallet) {
                const encrypted = this.encryptedWallets.get(job.walletPublicKey);
                if (encrypted) {
                    wallet = await this.secureKeyStore.decryptWallet(encrypted);
                }
            }
            
            if (!wallet) {
                console.log(`Wallet ${job.walletPublicKey} not available`);
                return;
            }
        } catch (error) {
            console.error(`Error accessing secure wallet: ${error}`);
            return;
        }
        */

        try {
            // Execute the strategy
            // TODO: Implement actual strategy execution
            console.log(`Executing strategy ${job.strategyId} for wallet ${job.walletPublicKey}`);

            // Update last executed time
            const client = await this.pool.connect();
            try {
                await client.query(`
                    UPDATE strategies 
                    SET last_executed = CURRENT_TIMESTAMP,
                        next_execution = CURRENT_TIMESTAMP + interval '1 hour'
                    WHERE id = $1
                `, [job.strategyId]);

                // Update job in queue
                job.lastExecuted = new Date();
                job.nextExecution = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
            } finally {
                client.release();
            }
        } catch (error) {
            console.error(`Error executing strategy ${job.strategyId}:`, error);
        }
    }

    // CURRENT: Simple wallet management (browser-dependent)
    public addActiveWallet(wallet: TradingWallet) {
        this.activeWallets.set(wallet.publicKey, wallet);
    }

    public removeActiveWallet(publicKey: string) {
        this.activeWallets.delete(publicKey);
    }

    // FUTURE: Secure wallet management methods
    /*
    public async addSecureWallet(wallet: TradingWallet, securityOpts: SecurityOptions) {
        // Encrypt and store wallet
        const encrypted = await this.secureKeyStore.encryptWallet(wallet);
        this.encryptedWallets.set(wallet.publicKey, encrypted);
        
        // Save to database
        const client = await this.pool.connect();
        try {
            await client.query(`
                INSERT INTO secure_wallets (
                    public_key, 
                    encrypted_data,
                    encryption_method,
                    created_at
                ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            `, [wallet.publicKey, encrypted, securityOpts.method]);
        } finally {
            client.release();
        }
    }

    public async removeSecureWallet(publicKey: string) {
        this.encryptedWallets.delete(publicKey);
        
        const client = await this.pool.connect();
        try {
            await client.query(`
                UPDATE secure_wallets 
                SET is_active = false,
                    deactivated_at = CURRENT_TIMESTAMP
                WHERE public_key = $1
            `, [publicKey]);
        } finally {
            client.release();
        }
    }
    */
} 