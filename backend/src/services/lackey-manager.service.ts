import { Pool } from 'pg';
import { Strategy, StrategyConfig } from '../types/strategy';
import { TradingWallet } from '../../src/types/wallet';

interface LackeyConfig {
    original_wallet_pubkey: string;
    position: number;
    strategy_config: StrategyConfig;
}

export class LackeyManager {
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    async importLackey(lackeyData: string, targetWallet?: TradingWallet): Promise<Strategy> {
        const config = await this.decryptLackey(lackeyData);
        
        // Create strategy with lackey flag
        const strategy = await this.createStrategy({
            strategy_type: config.strategy_config.type,
            config: config.strategy_config,
            is_lackey: true,
            original_wallet_pubkey: config.original_wallet_pubkey,
            position: config.position,
            is_active: true
        });

        // If target wallet provided, assign to it
        if (targetWallet) {
            strategy.current_wallet_pubkey = targetWallet.publicKey;
            await this.updateStrategy(strategy);
        } else {
            // Try to find appropriate wallet
            const wallet = await this.findWalletForLackey(strategy);
            if (wallet) {
                strategy.current_wallet_pubkey = wallet.publicKey;
                await this.updateStrategy(strategy);
            }
        }

        return strategy;
    }

    async exportLackey(strategyId: number): Promise<string> {
        const strategy = await this.getStrategy(strategyId);
        if (!strategy.is_lackey) {
            throw new Error('Not a lackey strategy');
        }

        return this.encryptLackey({
            original_wallet_pubkey: strategy.original_wallet_pubkey || '',
            position: strategy.position || 0,
            strategy_config: strategy.config
        });
    }

    private async createStrategy(strategyData: Partial<Strategy>): Promise<Strategy> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                INSERT INTO strategies (
                    trading_wallet_id,
                    main_wallet_pubkey,
                    strategy_type,
                    config,
                    is_active,
                    name,
                    is_lackey,
                    original_wallet_pubkey,
                    position,
                    current_wallet_pubkey
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *
            `, [
                strategyData.trading_wallet_id,
                strategyData.main_wallet_pubkey,
                strategyData.strategy_type,
                strategyData.config,
                strategyData.is_active,
                strategyData.name,
                strategyData.is_lackey,
                strategyData.original_wallet_pubkey,
                strategyData.position,
                strategyData.current_wallet_pubkey
            ]);

            return result.rows[0];
        } finally {
            client.release();
        }
    }

    private async getStrategy(strategyId: number): Promise<Strategy> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT * FROM strategies WHERE id = $1
            `, [strategyId]);

            if (result.rows.length === 0) {
                throw new Error('Strategy not found');
            }

            return result.rows[0];
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

    private async decryptLackey(lackeyData: string): Promise<LackeyConfig> {
        // TODO: Implement actual decryption
        // For now, just parse the JSON
        return JSON.parse(lackeyData);
    }

    private async encryptLackey(config: LackeyConfig): Promise<string> {
        // TODO: Implement actual encryption
        // For now, just stringify the JSON
        return JSON.stringify(config);
    }
} 