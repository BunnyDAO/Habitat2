import { Connection, PublicKey, Keypair, VersionedTransaction, ParsedAccountData } from '@solana/web3.js';
import { Pool } from 'pg';
import { createClient } from 'redis';

// Common token decimals
const TOKEN_DECIMALS: { [key: string]: number } = {
    'So11111111111111111111111111111111111111112': 9,  // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,  // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6,  // USDT
};

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Jupiter Lite API Configuration
const JUPITER_PLATFORM_FEE_BPS = 20; // 0.2% platform fee
const JUPITER_FEE_ACCOUNT = '2yrLVmLcMyZyKaV8cZKkk79zuvMPqhVjLMWkQFQtj4g6';

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

interface JupiterLiteQuote {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    platformFee?: {
        amount: string;
        feeBps: number;
    };
    priceImpactPct: string;
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
}

interface JupiterLiteSwapResponse {
    swapTransaction: string;
    lastValidBlockHeight: number;
}

export class SwapService {
    private connection: Connection;
    private pool: Pool;
    private redisClient: ReturnType<typeof createClient> | null;

    constructor(
        pool: Pool,
        connection: Connection,
        redisClient: ReturnType<typeof createClient> | null = null
    ) {
        this.pool = pool;
        this.connection = connection;
        this.redisClient = redisClient;
    }

    async executeSwap(request: SwapRequest): Promise<SwapResponse> {
        // Progressive slippage retry system
        const maxSlippage = 1000; // 10% hard limit for extreme volatility
        const originalSlippage = request.slippageBps || 50;
        const slippageSteps = [
            originalSlippage,  // Original slippage (default 0.5%)
            150,               // 1.5%
            300,               // 3.0%
            500,               // 5.0%
            1000               // 10.0% (maximum for extreme volatility)
        ];

        let lastError: Error | null = null;

        // Try each slippage level
        for (let attempt = 0; attempt < slippageSteps.length; attempt++) {
            try {
                const currentSlippage = slippageSteps[attempt];
                
                if (attempt > 0) {
                    console.log(`Swap attempt ${attempt + 1}/${slippageSteps.length} with ${currentSlippage/100}% slippage (previous attempt failed)`);
                } else {
                    console.log(`Swap attempt ${attempt + 1}/${slippageSteps.length} with ${currentSlippage/100}% slippage (initial attempt)`);
                }

                const result = await this.executeSwapAttempt({
                    ...request,
                    slippageBps: currentSlippage
                });

                // Success! Log if we needed retries
                if (attempt > 0) {
                    console.log(`✅ Swap succeeded on attempt ${attempt + 1} with ${currentSlippage/100}% slippage`);
                    // Add slippage info to response message
                    result.message += ` (succeeded with ${currentSlippage/100}% slippage after ${attempt + 1} attempts)`;
                }

                return result;

            } catch (error) {
                lastError = error as Error;
                const currentSlippage = slippageSteps[attempt];
                
                // Enhanced error logging with error codes
                console.log(`❌ Error on attempt ${attempt + 1} with ${currentSlippage/100}% slippage:`, {
                    message: lastError.message,
                    stack: lastError.stack?.split('\n')[0], // First line of stack trace
                    errorString: lastError.toString(),
                    isSlippageError: this.isSlippageError(lastError)
                });
                
                // Check if it's a slippage-related error
                if (this.isSlippageError(lastError) && attempt < slippageSteps.length - 1) {
                    console.log(`🔄 Detected slippage error (including 6001), retrying with higher slippage...`);
                    continue;
                }
                
                // Non-slippage error or final attempt - break out
                console.log(`❌ Final error on attempt ${attempt + 1} (no more retries):`, lastError.message);
                break;
            }
        }

        // All attempts failed
        const finalSlippage = slippageSteps[slippageSteps.length - 1];
        throw new Error(
            `Swap failed after ${slippageSteps.length} attempts with slippage up to ${finalSlippage/100}%. ` +
            `Final error: ${lastError?.message || 'Unknown error'}`
        );
    }

    private isSlippageError(error: Error): boolean {
        const errorMessage = error.message.toLowerCase();
        const errorStr = error.toString().toLowerCase();
        
        // Check for Jupiter error code 6001 (SlippageToleranceExceeded)
        const isCode6001 = errorStr.includes('6001') || errorStr.includes('custom: 6001');
        
        const isSlippageMessage = errorMessage.includes('slippage') ||
               errorMessage.includes('price moved') ||
               errorMessage.includes('insufficient output amount') ||
               errorMessage.includes('would result in a loss') ||
               errorMessage.includes('price impact too high') ||
               errorMessage.includes('exceeds desired slippage') ||
               errorMessage.includes('minimum received') ||
               errorMessage.includes('slippage tolerance');
               
        return isCode6001 || isSlippageMessage;
    }

    private async executeSwapAttempt(request: SwapRequest): Promise<SwapResponse> {
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
            const baseAmount = Number.isInteger(amount) ? 
                amount : // If it's already in base units
                Math.floor(amount * Math.pow(10, inputDecimals)); // If it's in token units

            console.log('Converting amount:', {
                originalAmount: amount,
                inputDecimals,
                baseAmount,
                isInteger: Number.isInteger(amount)
            });

            // Get quote from Jupiter Lite API
            const jupiterQuote = await this.getJupiterLiteQuote(
                inputMint,
                outputMint,
                baseAmount,
                slippageBps,
                feeWalletPubkey ? JUPITER_PLATFORM_FEE_BPS : 0
            );

            console.log('Got quote from Jupiter Lite API:', {
                inAmount: jupiterQuote.inAmount,
                outAmount: jupiterQuote.outAmount,
                priceImpactPct: jupiterQuote.priceImpactPct
            });

            // Get swap transaction from Jupiter Lite API
            const swapTransaction = await this.executeJupiterLiteSwap(
                jupiterQuote,
                tradingKeypair.publicKey.toString(),
                feeWalletPubkey
            );

            console.log('Got swap transaction from Jupiter Lite API');

            // Deserialize and sign the transaction
            const transactionBuf = Buffer.from(swapTransaction.swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuf);
            
            // Sign the transaction
            transaction.sign([tradingKeypair]);

            // Send and confirm the transaction
            const signature = await this.connection.sendTransaction(transaction, {
                maxRetries: 3,
                skipPreflight: false,
            });

            console.log('Transaction sent:', signature);

            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
            
            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            console.log('Transaction confirmed:', signature);

            // TODO: Log the swap to database (requires swaps table)

            // Return formatted response
            return {
                signature,
                inputAmount: jupiterQuote.inAmount,
                outputAmount: jupiterQuote.outAmount,
                routePlan: jupiterQuote.routePlan,
                message: 'Swap completed successfully'
            };

        } catch (error) {
            console.error('Error in executeSwapAttempt:', error);
            throw error;
        }
    }

    private async getJupiterLiteQuote(
        inputMint: string,
        outputMint: string,
        amount: number,
        slippageBps: number,
        platformFeeBps: number = 0
    ): Promise<JupiterLiteQuote> {
        try {
            let url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
            
            if (platformFeeBps > 0) {
                url += `&platformFeeBps=${platformFeeBps}`;
            }

            const response = await fetch(url);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to get Jupiter Lite quote: ${response.statusText} - ${errorText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error getting Jupiter Lite quote:', error);
            throw error;
        }
    }

    private async executeJupiterLiteSwap(
        quoteResponse: JupiterLiteQuote,
        userPublicKey: string,
        feeAccount?: string
    ): Promise<JupiterLiteSwapResponse> {
        try {
            const body: any = {
                quoteResponse,
                userPublicKey,
                wrapAndUnwrapSol: true
            };

            if (feeAccount) {
                body.feeAccount = feeAccount;
            }

            const response = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Jupiter Lite swap failed: ${JSON.stringify(errorData)}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error executing Jupiter Lite swap:', error);
            throw error;
        }
    }

    private async getTokenDecimals(mint: string): Promise<number> {
        // Check if we have cached decimals for common tokens
        if (TOKEN_DECIMALS[mint]) {
            return TOKEN_DECIMALS[mint];
        }

        try {
            // For unknown tokens, query the blockchain
            const mintInfo = await this.connection.getParsedAccountInfo(new PublicKey(mint));
            if (mintInfo.value?.data && 'parsed' in mintInfo.value.data) {
                const parsedData = mintInfo.value.data as ParsedAccountData;
                return parsedData.parsed?.info?.decimals || 6; // Default to 6 if not found
            }
            
            return 6; // Default decimals for unknown tokens
        } catch (error) {
            console.warn(`Failed to get decimals for token ${mint}, using default 6:`, error);
            return 6;
        }
    }
} 