import { Connection, PublicKey, Keypair, VersionedTransaction, ParsedAccountData } from '@solana/web3.js';
import { Pool } from 'pg';

// Common token decimals
const TOKEN_DECIMALS: { [key: string]: number } = {
    'So11111111111111111111111111111111111111112': 9,  // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,  // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6,  // USDT
};

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

interface SwapRequest {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps?: number;
    walletKeypair: {
        publicKey: string;
        secretKey: number[];
    };
    feeWalletPubkey?: string;
    feeBps?: number;
}

interface SwapResponse {
    signature: string;
    inputAmount: string;
    outputAmount: string;
    routePlan?: Array<{
        swapInfo: {
            label: string;
            inputMint: string;
            outputMint: string;
        };
        percent: number;
    }>;
    message: string;
}

interface JupiterQuoteResponse {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    priceImpactPct: number;
    routePlan: Array<{
        swapInfo: {
            ammKey: string;
            label: string;
            inputMint: string;
            outputMint: string;
            inAmount: string;
            outAmount: string;
            feeAmount: string;
            feeMint: string;
        };
        percent: number;
    }>;
    contextSlot: number;
    timeTaken: number;
}

export class SwapService {
    private pool: Pool;
    private connection: Connection;

    constructor(pool: Pool, connection: Connection) {
        this.pool = pool;
        this.connection = connection;
    }

    async executeSwap(request: SwapRequest): Promise<SwapResponse> {
        try {
            const {
                inputMint,
                outputMint,
                amount,
                slippageBps = 50,
                walletKeypair,
                feeWalletPubkey,
                feeBps = 100
            } = request;

            console.log('Starting swap execution with request:', {
                inputMint,
                outputMint,
                amount,
                slippageBps
            });

            // Create keypair from provided secret key
            const tradingKeypair = Keypair.fromSecretKey(new Uint8Array(walletKeypair.secretKey));
            console.log('Trading wallet public key:', tradingKeypair.publicKey.toBase58());

            // Check SOL balance for fees and rent
            const solBalance = await this.connection.getBalance(tradingKeypair.publicKey);
            console.log('Current SOL balance:', solBalance / 1e9, 'SOL');
            
            // Calculate required SOL for the transaction
            const MIN_SOL_BALANCE = 10000000; // 0.01 SOL for fees and rent
            const REQUIRED_SOL = inputMint === WSOL_MINT ? 
                Math.max(MIN_SOL_BALANCE, Math.ceil(amount * 1e9)) : // If swapping SOL, need amount + fees
                MIN_SOL_BALANCE; // If swapping tokens, just need fees
            
            if (solBalance < REQUIRED_SOL) {
                const requiredSol = REQUIRED_SOL / 1e9;
                const currentSol = solBalance / 1e9;
                throw new Error(
                    `Insufficient SOL balance for transaction. ` +
                    `Need at least ${requiredSol} SOL (${inputMint === WSOL_MINT ? 'amount + fees' : 'fees'}), ` +
                    `have ${currentSol} SOL`
                );
            }

            // Get token decimals
            const inputDecimals = await this.getTokenDecimals(inputMint);
            const outputDecimals = await this.getTokenDecimals(outputMint);

            // Convert amount to base units using correct decimals
            // If amount is already in base units (no decimal point), use it directly
            // Otherwise, multiply by 10^decimals
            const baseAmount = Number.isInteger(amount) ? 
                amount : // If it's already in base units
                Math.floor(amount * Math.pow(10, inputDecimals)); // If it's in token units

            console.log('Converting amount:', {
                originalAmount: amount,
                inputDecimals,
                baseAmount,
                isInteger: Number.isInteger(amount)
            });

            // Get quote from Jupiter API
            const quoteData = await this.getQuote(inputMint, outputMint, baseAmount, slippageBps);
            
            // Create swap request body
            const swapRequestBody = {
                quoteResponse: quoteData,
                userPublicKey: tradingKeypair.publicKey.toString(),
                wrapAndUnwrapSol: true,
                dynamicSlippage: { maxBps: slippageBps },
                ...(feeWalletPubkey && { feeAccount: feeWalletPubkey })
            };

            // Execute swap through Jupiter API
            const response = await fetch('https://quote-api.jup.ag/v6/swap', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(swapRequestBody),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Jupiter API error:', errorText);
                throw new Error(`Failed to execute swap: ${errorText}`);
            }

            const swapResult = await response.json();
            const swapTransactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
            const swapTransaction = VersionedTransaction.deserialize(swapTransactionBuf);

            // Sign and send transaction
            swapTransaction.sign([tradingKeypair]);
            const signature = await this.connection.sendTransaction(swapTransaction);

            // Log the swap in the database
            await this.logSwap({
                walletPubkey: tradingKeypair.publicKey.toString(),
                inputMint,
                outputMint,
                inputAmount: amount,
                outputAmount: Number(quoteData.outAmount) / Math.pow(10, outputDecimals),
                txid: signature,
                feeBps
            });

            return {
                signature,
                inputAmount: amount.toString(),
                outputAmount: (Number(quoteData.outAmount) / Math.pow(10, outputDecimals)).toString(),
                routePlan: quoteData.routePlan,
                message: 'Swap executed successfully!'
            };
        } catch (error) {
            console.error('Error executing swap:', error);
            throw error;
        }
    }

    private async getTokenDecimals(mint: string): Promise<number> {
        if (TOKEN_DECIMALS[mint]) {
            return TOKEN_DECIMALS[mint];
        }

        try {
            const mintPubkey = new PublicKey(mint);
            const accountInfo = await this.connection.getParsedAccountInfo(mintPubkey);
            
            if (!accountInfo.value) {
                throw new Error(`Token mint ${mint} not found`);
            }
            
            if ('parsed' in accountInfo.value.data) {
                const parsedData = accountInfo.value.data as ParsedAccountData;
                const decimals = parsedData.parsed?.info?.decimals;
                if (typeof decimals === 'number') {
                    return decimals;
                }
            }
            throw new Error(`Could not parse decimals for token ${mint}`);
        } catch (error) {
            console.error(`Error fetching token info for ${mint}:`, error);
            throw new Error(`Failed to get decimals for token ${mint}`);
        }
    }

    private async getQuote(
        inputMint: string,
        outputMint: string,
        amount: number,
        slippageBps: number
    ): Promise<JupiterQuoteResponse> {
        const response = await fetch(
            `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Jupiter quote error:', errorText);
            throw new Error(`Failed to get quote: ${errorText}`);
        }

        return await response.json();
    }

    private async logSwap(params: {
        walletPubkey: string;
        inputMint: string;
        outputMint: string;
        inputAmount: number;
        outputAmount: number;
        txid: string;
        feeBps?: number;
    }): Promise<void> {
        const client = await this.pool.connect();
        try {
            // First check if the trading wallet exists
            const walletResult = await client.query(
                'SELECT id, main_wallet_pubkey FROM trading_wallets WHERE wallet_pubkey = $1',
                [params.walletPubkey]
            );

            if (walletResult.rows.length === 0) {
                console.warn(`Trading wallet ${params.walletPubkey} not found in database, skipping transaction log`);
                return;
            }

            const { id: tradingWalletId, main_wallet_pubkey: mainWalletPubkey } = walletResult.rows[0];

            // Prepare transaction details
            const details = {
                inputMint: params.inputMint,
                outputMint: params.outputMint,
                outputAmount: params.outputAmount,
                feeBps: params.feeBps
            };

            await client.query(`
                INSERT INTO transactions (
                    trading_wallet_id,
                    main_wallet_pubkey,
                    wallet_pubkey,
                    signature,
                    type,
                    amount,
                    token_mint,
                    timestamp,
                    details
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
            `, [
                tradingWalletId,
                mainWalletPubkey,
                params.walletPubkey,
                params.txid,
                'swap',
                params.inputAmount,
                params.inputMint,
                JSON.stringify(details)
            ]);
        } catch (error) {
            console.error('Error logging swap transaction:', error);
            // Don't throw the error as we don't want to fail the swap if logging fails
        } finally {
            client.release();
        }
    }
} 