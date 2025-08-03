import { Connection, PublicKey, Keypair, VersionedTransaction, ParsedAccountData } from '@solana/web3.js';
import { getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Pool } from 'pg';
import { createClient } from 'redis';

// Common token decimals
const TOKEN_DECIMALS: { [key: string]: number } = {
    'So11111111111111111111111111111111111111112': 9,  // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,  // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6,  // USDT
};

// Constants
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUPITER_PLATFORM_FEE_BPS = 20; // 0.2% platform fee
const MIN_SOL_BALANCE = 10000000; // 0.01 SOL for fees and rent
const JUPITER_FEE_ACCOUNT = '5PkZKoYHDoNwThvqdM5U35ACcYdYrT4ZSQdU2bY3iqKV';

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
        const errorStr = error.message.toLowerCase();
        
        // Check for Jupiter error codes that should trigger retry
        const isCode6001 = errorStr.includes('6001') || errorStr.includes('custom: 6001'); // SlippageToleranceExceeded
        const isCode1789 = errorStr.includes('1789') || errorStr.includes('0x1789'); // Jupiter routing error - retryable
        
        // Check for slippage-related message patterns
        const isSlippageMessage = errorStr.includes('slippage') || 
                                 errorStr.includes('price impact') || 
                                 errorStr.includes('tolerance exceeded');

        const shouldRetry = isCode6001 || isCode1789 || isSlippageMessage;
        
        console.log('🔍 Error analysis:', {
            errorMessage: error.message,
            isCode6001,
            isCode1789,
            isSlippageMessage,
            shouldRetry
        });

        return shouldRetry;
    }

    private async executeSwapAttempt(request: SwapRequest): Promise<SwapResponse> {
        const { inputMint, outputMint, amount, slippageBps = 50, walletKeypair, feeWalletPubkey } = request;
        
        try {
            // Get trading wallet keypair
            const tradingKeypair = Keypair.fromSecretKey(new Uint8Array(walletKeypair.secretKey));
            
            // Get token decimals for amount conversion
            const inputDecimals = await this.getTokenDecimals(inputMint);
            
            // Convert amount to base units (with decimals) for Jupiter API
            const baseAmount = Math.floor(amount * Math.pow(10, inputDecimals));
            
            console.log('Converting amount:', {
                originalAmount: amount,
                inputDecimals,
                baseAmount,
                isInteger: Number.isInteger(amount),
                baseAmountFormatted: `${baseAmount} (${baseAmount / Math.pow(10, inputDecimals)} ${inputMint === WSOL_MINT ? 'SOL' : 'tokens'})`
            });

            // Check SOL balance requirements
            const solBalance = await this.connection.getBalance(tradingKeypair.publicKey);
            const solBalanceFormatted = solBalance / 1e9;
            
            console.log(`Current SOL balance: ${solBalanceFormatted} SOL`);
            
            const REQUIRED_SOL = inputMint === WSOL_MINT ?
                Math.max(MIN_SOL_BALANCE, baseAmount) : // If swapping SOL, need baseAmount + fees
                MIN_SOL_BALANCE; // If swapping tokens, just need fees
            
            if (solBalance < REQUIRED_SOL) {
                throw new Error(`Insufficient SOL balance for transaction. Need at least ${REQUIRED_SOL / 1e9} SOL (amount + fees), have ${solBalanceFormatted} SOL`);
            }

            // Ensure Associated Token Accounts exist for both input and output tokens
            try {
                // For input token (if not SOL)
                if (inputMint !== WSOL_MINT) {
                    console.log(`Creating/getting ATA for input token ${inputMint}`);
                    await getOrCreateAssociatedTokenAccount(
                        this.connection,
                        tradingKeypair,
                        new PublicKey(inputMint),
                        tradingKeypair.publicKey,
                        false // allowOwnerOffCurve
                    );
                }

                // For output token (if not SOL)
                if (outputMint !== WSOL_MINT) {
                    console.log(`Creating/getting ATA for output token ${outputMint}`);
                    await getOrCreateAssociatedTokenAccount(
                        this.connection,
                        tradingKeypair,
                        new PublicKey(outputMint),
                        tradingKeypair.publicKey,
                        false // allowOwnerOffCurve
                    );
                }

                // For wrapped SOL (always needed when dealing with SOL)
                if (inputMint === WSOL_MINT || outputMint === WSOL_MINT) {
                    console.log('Creating/getting ATA for wrapped SOL');
                    await getOrCreateAssociatedTokenAccount(
                        this.connection,
                        tradingKeypair,
                        new PublicKey(WSOL_MINT),
                        tradingKeypair.publicKey,
                        false // allowOwnerOffCurve
                    );
                }

                console.log('All required token accounts are ready');
            } catch (ataError) {
                console.error('Error creating/getting token accounts:', ataError);
                const errorMessage = ataError instanceof Error ? ataError.message : String(ataError);
                throw new Error(`Failed to prepare token accounts: ${errorMessage}`);
            }

            // Try swap with fallback approaches for 0x1789 errors
            return await this.trySwapWithFallbacks(
                inputMint,
                outputMint,
                baseAmount,
                slippageBps,
                tradingKeypair,
                feeWalletPubkey
            );

        } catch (error) {
            console.error('Error in executeSwapAttempt:', error);
            
            // Check if this is a serialization error and retry
            if (error instanceof Error && error.message.includes('Compilation failed')) {
                console.log('🔄 Detected compilation error, retrying...');
                // Add a small delay and retry
                await new Promise(resolve => setTimeout(resolve, 1000));
                throw error; // Let the retry mechanism handle this
            }
            
            throw error;
        }
    }

    private async trySwapWithFallbacks(
        inputMint: string,
        outputMint: string,
        baseAmount: number,
        slippageBps: number,
        tradingKeypair: Keypair,
        feeWalletPubkey?: string
    ): Promise<SwapResponse> {
        
        // Approach 1: Try with platform fees (original approach)
        try {
            console.log('🎯 Attempting swap with platform fees...');
            return await this.executeSwapWithJupiter(
                inputMint,
                outputMint,
                baseAmount,
                slippageBps,
                tradingKeypair,
                feeWalletPubkey
            );
        } catch (error1) {
            console.log('❌ Swap with platform fees failed:', error1 instanceof Error ? error1.message : String(error1));
            
            if (error1 instanceof Error && error1.message.includes('0x1789')) {
                // Approach 2: Try without platform fees
                try {
                    console.log('🎯 Attempting swap without platform fees...');
                    return await this.executeSwapWithJupiter(
                        inputMint,
                        outputMint,
                        baseAmount,
                        slippageBps,
                        tradingKeypair,
                        undefined // No fee wallet
                    );
                } catch (error2) {
                    console.log('❌ Swap without platform fees failed:', error2 instanceof Error ? error2.message : String(error2));
                    
                    if (error2 instanceof Error && error2.message.includes('0x1789')) {
                        // Approach 3: Try with slightly adjusted amount (sometimes fixes routing issues)
                        try {
                            console.log('🎯 Attempting swap with adjusted amount...');
                            const adjustedAmount = Math.floor(baseAmount * 0.999); // Reduce by 0.1%
                            console.log(`Adjusted amount: ${baseAmount} -> ${adjustedAmount}`);
                            return await this.executeSwapWithJupiter(
                                inputMint,
                                outputMint,
                                adjustedAmount,
                                slippageBps,
                                tradingKeypair,
                                undefined // No fee wallet for this fallback
                            );
                        } catch (error3) {
                            console.log('❌ Swap with adjusted amount failed:', error3 instanceof Error ? error3.message : String(error3));
                            throw error1; // Throw the original error
                        }
                    } else {
                        throw error2;
                    }
                }
            } else {
                throw error1;
            }
        }
    }

    private async executeSwapWithJupiter(
        inputMint: string,
        outputMint: string,
        baseAmount: number,
        slippageBps: number,
        tradingKeypair: Keypair,
        feeWalletPubkey?: string
    ): Promise<SwapResponse> {
        // Get quote from Jupiter Lite API
        console.log('Requesting Jupiter quote with:', {
            inputMint,
            outputMint,
            baseAmount,
            slippageBps,
            platformFeeBps: feeWalletPubkey ? JUPITER_PLATFORM_FEE_BPS : 0
        });
        
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

        // Get the appropriate fee account for the input mint (if fee collection is enabled)
        let feeAccount: string | undefined;
        if (feeWalletPubkey) {
            try {
                feeAccount = await this.getFeeAccountForMint(inputMint, feeWalletPubkey, tradingKeypair);
                console.log('✅ Fee account prepared:', {
                    inputMint: inputMint === WSOL_MINT ? 'SOL (native)' : 'SPL Token',
                    feeWalletPubkey,
                    feeAccount
                });
            } catch (feeError) {
                console.error('❌ Failed to prepare fee account:', feeError);
                // Continue without fees rather than failing the entire swap
                console.log('🔄 Continuing swap without platform fees due to fee account error');
                feeAccount = undefined;
            }
        }

        // Get swap transaction from Jupiter Lite API
        const swapTransaction = await this.executeJupiterLiteSwap(
            jupiterQuote,
            tradingKeypair.publicKey.toString(),
            feeAccount
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

        console.log('✅ Swap transaction confirmed:', signature);

        return {
            signature,
            inputAmount: baseAmount.toString(),
            outputAmount: jupiterQuote.outAmount,
            message: 'Swap completed successfully'
        };
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

            console.log('🔍 Jupiter Lite API quote URL:', url);

            const response = await fetch(url);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Jupiter Lite quote API error:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorText
                });
                throw new Error(`Failed to get Jupiter Lite quote: ${response.statusText} - ${errorText}`);
            }

            const quote = await response.json();
            console.log('✅ Jupiter Lite quote response:', JSON.stringify(quote, null, 2));
            return quote;
        } catch (error) {
            console.error('❌ Error in getJupiterLiteQuote:', error);
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

            console.log('🔍 Jupiter Lite swap request body:', JSON.stringify(body, null, 2));

            const response = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('❌ Jupiter Lite swap API error:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorData
                });
                throw new Error(`Jupiter Lite swap failed: ${JSON.stringify(errorData)}`);
            }

            const swapResponse = await response.json();
            console.log('✅ Jupiter Lite swap response received (transaction length:', swapResponse.swapTransaction?.length || 'unknown', 'bytes)');
            return swapResponse;
        } catch (error) {
            console.error('❌ Error executing Jupiter Lite swap:', error);
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

    /**
     * Gets or creates the appropriate fee account for the given input mint.
     * For all tokens (including SOL/WSOL): Creates/gets the Associated Token Account for that mint
     */
    private async getFeeAccountForMint(
        inputMint: string,
        feeWalletPubkey: string,
        payerKeypair: Keypair
    ): Promise<string> {
        console.log('🎯 Getting fee account for mint:', {
            inputMint,
            mintType: inputMint === WSOL_MINT ? 'SOL (WSOL ATA)' : 'SPL Token',
            feeWalletPubkey
        });

        // For all tokens (including SOL/WSOL), create/get the Associated Token Account
        try {
            const tokenType = inputMint === WSOL_MINT ? 'WSOL (for SOL fees)' : 'SPL token';
            console.log(`🔨 Creating/getting ATA for fee collection (${tokenType}): ${inputMint} -> ${feeWalletPubkey}`);
            
            const feeTokenAccount = await getOrCreateAssociatedTokenAccount(
                this.connection,
                payerKeypair, // Trading wallet pays for account creation
                new PublicKey(inputMint), // Token mint (including WSOL for SOL fees)
                new PublicKey(feeWalletPubkey), // Fee wallet owner
                false // allowOwnerOffCurve
            );

            const feeAccountAddress = feeTokenAccount.address.toBase58();
            console.log('✅ Fee token account ready:', {
                mint: inputMint,
                tokenType,
                owner: feeWalletPubkey,
                tokenAccount: feeAccountAddress,
                existed: feeTokenAccount.address.equals(await getAssociatedTokenAddress(
                    new PublicKey(inputMint),
                    new PublicKey(feeWalletPubkey)
                ))
            });

            return feeAccountAddress;
        } catch (error) {
            console.error('❌ Error creating fee token account:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create fee token account for ${inputMint}: ${errorMessage}`);
        }
    }
} 