import { Connection, PublicKey, Keypair, VersionedTransaction, ParsedAccountData, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Common token decimals
const TOKEN_DECIMALS: { [key: string]: number } = {
    'So11111111111111111111111111111111111111112': 9,  // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,  // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6,  // USDT
};

// Interface for swap parameters
interface SwapParams {
  inputMint: string;           // Input token mint address (e.g., SOL or any SPL token)
  outputMint: string;          // Output token mint address
  amount: number;              // Amount of input token to swap (in human-readable format, e.g., 1 for 1 SOL)
  slippageBps?: number;        // Slippage tolerance in basis points (e.g., 50 for 0.5%)
  walletKeypair: Keypair;      // User's keypair for signing
  feeWalletPubkey?: string;    // Public key of the fee wallet (optional)
  feeBps?: number;             // Fee in basis points (optional, e.g., 5 for 0.05%)
  connection: Connection;      // Solana RPC connection
}

interface SwapResult {
  txid: string;                // Transaction ID
  inputAmount: number;         // Input amount in token's native format
  outputAmount: number;        // Expected output amount in token's native format
  inputDecimals: number;       // Decimals of input token
  outputDecimals: number;      // Decimals of output token
  fee?: number;                // Fee amount in token's native format (if applicable)
}

// Interface for swap request body
interface SwapRequestBody {
  quoteResponse: {
    inAmount: string;
    outAmount: string;
    [key: string]: unknown;
  };
  userPublicKey: string;
  wrapAndUnwrapSol: boolean;
  dynamicSlippage: { maxBps: number };
  feeAccount?: string;
}

async function getTokenDecimals(mint: string, connection: Connection): Promise<number> {
    // Check if we know this token's decimals
    if (TOKEN_DECIMALS[mint]) {
        return TOKEN_DECIMALS[mint];
    }

    try {
        const mintPubkey = new PublicKey(mint);
        const accountInfo = await connection.getParsedAccountInfo(mintPubkey);
        
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
        throw new Error(`Failed to get decimals for token ${mint}. Please verify the token exists.`);
    }
}

/**
 * Gets the associated token address for a given mint and owner
 */
async function getAssociatedTokenAddress(
    mint: PublicKey,
    owner: PublicKey,
    allowOwnerOffCurve = false
): Promise<PublicKey> {
    if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
        throw new Error('Owner must be on curve');
    }

    const [address] = await PublicKey.findProgramAddress(
        [
            owner.toBuffer(),
            TOKEN_PROGRAM_ID.toBuffer(),
            mint.toBuffer(),
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    return address;
}

/**
 * Ensures a token account exists for a given mint and owner
 * For SOL, this means creating a WSOL account if needed
 */
async function ensureTokenAccount(
    mint: PublicKey,
    owner: PublicKey,
    connection: Connection,
    payer: Keypair
): Promise<PublicKey> {
    try {
        // For wSOL, we need to create an ATA like any other token
        const ata = await getAssociatedTokenAddress(
            mint,
            owner,
            true // allowOwnerOffCurve = true to support PDAs
        );
        
        // Check if the token account exists
        const account = await connection.getAccountInfo(ata);
        if (!account) {
            console.log(`Token account ${ata.toString()} does not exist, creating...`);
            // Create ATA instruction
            const createAtaIx = await createAssociatedTokenAccountInstruction(
                payer.publicKey,
                ata,
                owner,
                mint
            );
            
            const tx = new Transaction().add(createAtaIx);
            const latestBlockhash = await connection.getLatestBlockhash();
            tx.recentBlockhash = latestBlockhash.blockhash;
            tx.feePayer = payer.publicKey;
            
            // Sign and send the transaction
            const signature = await connection.sendTransaction(tx, [payer]);
            await connection.confirmTransaction({
                signature,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
            });
            console.log(`Created token account ${ata.toString()}`);
        }
        
        return ata;
    } catch (error) {
        console.error(`Error ensuring token account for mint ${mint.toString()}:`, error);
        throw new Error(`Failed to ensure token account exists for mint ${mint.toString()}`);
    }
}

/**
 * Creates an instruction to create an Associated Token Account
 */
async function createAssociatedTokenAccountInstruction(
    payer: PublicKey,
    ata: PublicKey,
    owner: PublicKey,
    mint: PublicKey
): Promise<TransactionInstruction> {
    return new TransactionInstruction({
        keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: ata, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        data: Buffer.from([])
    });
}

/**
 * Gets the appropriate fee account for a given mint and fee wallet
 * Creates the account if it doesn't exist
 */
async function getFeeAccount(
    mint: string, 
    feeWalletPubkey: string,
    connection: Connection,
    payer: Keypair
): Promise<string> {
    const mintPubkey = new PublicKey(mint);
    const feeWallet = new PublicKey(feeWalletPubkey);
    
    try {
        // Ensure the fee account exists
        const feeAccount = await ensureTokenAccount(
            mintPubkey,
            feeWallet,
            connection,
            payer
        );
        
        return feeAccount.toString();
    } catch (error) {
        console.error(`Error getting/creating fee token account for mint ${mint}:`, error);
        throw new Error(`Failed to get/create fee token account for mint ${mint}`);
    }
}

/**
 * Confirms a transaction with robust retry logic and websocket subscription
 */
async function confirmTransaction(
  connection: Connection,
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    let retries = 5;

    // Set up websocket subscription for instant confirmation
    const subscriptionId = connection.onSignature(
      signature,
      (result) => {
        if (done) return;
        done = true;
        if (subscriptionId) connection.removeSignatureListener(subscriptionId);
        
        if (result.err) {
          reject(new Error(`Transaction failed: ${result.err.toString()}`));
        } else {
          resolve();
        }
      },
      'confirmed'
    );

    // Backup polling mechanism
    const checkConfirmation = async () => {
      if (done) return;
      
      try {
        const response = await connection.getSignatureStatus(signature);
        const status = response.value;
        
        if (status) {
          if (status.err) {
            done = true;
            if (subscriptionId) connection.removeSignatureListener(subscriptionId);
            reject(new Error(`Transaction failed: ${status.err.toString()}`));
            return;
          }
          
          if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
            done = true;
            if (subscriptionId) connection.removeSignatureListener(subscriptionId);
            resolve();
            return;
          }
        }

        // Check if we've exceeded the last valid block height
        const currentBlockHeight = await connection.getBlockHeight();
        if (currentBlockHeight > lastValidBlockHeight) {
          // Get new blockhash and retry
          if (retries > 0) {
            retries--;
            // Wait before retry
            await new Promise(res => setTimeout(res, 1000));
            checkConfirmation();
          } else {
            done = true;
            if (subscriptionId) connection.removeSignatureListener(subscriptionId);
            reject(new Error('Transaction confirmation timeout: block height exceeded'));
          }
          return;
        }

        // Continue polling if not confirmed
        setTimeout(checkConfirmation, 2000);
      } catch (err) {
        if (retries > 0) {
          retries--;
          setTimeout(checkConfirmation, 2000);
        } else {
          done = true;
          if (subscriptionId) connection.removeSignatureListener(subscriptionId);
          reject(err);
        }
      }
    };

    // Start polling
    checkConfirmation();

    // Set overall timeout
    setTimeout(() => {
      if (!done) {
        done = true;
        if (subscriptionId) connection.removeSignatureListener(subscriptionId);
        reject(new Error('Transaction confirmation timeout'));
      }
    }, 90000); // 90 second timeout
  });
}

/**
 * Pre-creates necessary token accounts for a swap
 * This includes creating wSOL account for TokenA -> SOL swaps
 */
export async function preCreateSwapAccounts(
  connection: Connection,
  wallet: Keypair,
  inputToken: PublicKey,
  outputToken: PublicKey
): Promise<void> {
  try {
    const wSOL = new PublicKey(WSOL_MINT);
    const isInputSOL = inputToken.equals(wSOL);
    const isOutputSOL = outputToken.equals(wSOL);

    // Create array to track accounts we need to ensure exist
    const tokensToEnsure: PublicKey[] = [];

    // For TokenA -> SOL swaps, we need wSOL account
    if (!isInputSOL && isOutputSOL) {
      tokensToEnsure.push(wSOL);
    }

    // For any non-SOL output token, we need its ATA
    if (!isOutputSOL) {
      tokensToEnsure.push(outputToken);
    }

    // Ensure all necessary token accounts exist
    if (tokensToEnsure.length > 0) {
      console.log(`Ensuring ${tokensToEnsure.length} token account(s) exist...`);
      
      // Process each token sequentially to avoid transaction size limits
      for (const token of tokensToEnsure) {
        await ensureTokenAccount(token, wallet.publicKey, connection, wallet);
      }
      
      console.log('All required token accounts are ready');
    } else {
      console.log('No token accounts need to be created');
    }
  } catch (error) {
    console.error('Error in preCreateSwapAccounts:', error);
    throw error;
  }
}

/**
 * Swaps tokens using Jupiter Aggregator
 * @param params Swap parameters
 * @returns Promise resolving to swap result
 */
export async function swapTokens({
  inputMint,
  outputMint,
  amount,
  slippageBps = 50,          // Default slippage of 0.5%
  walletKeypair,
  feeWalletPubkey,
  feeBps = 100,              // Default fee of 1% (maximum allowed)
  connection,
}: SwapParams): Promise<SwapResult> {
  try {
    console.log(`Starting swap: ${amount} from ${inputMint} to ${outputMint}`);
    
    // Pre-create necessary token accounts, including wSOL account for TokenA -> SOL swaps
    await preCreateSwapAccounts(
      connection,
      walletKeypair,
      new PublicKey(inputMint),
      new PublicKey(outputMint)
    );
    
    // Get input token decimals - will throw if token doesn't exist
    const inputDecimals = await getTokenDecimals(inputMint, connection);
    console.log(`Input token decimals: ${inputDecimals}`);
    
    const baseAmount = Math.floor(amount * Math.pow(10, inputDecimals));
    console.log(`Base amount: ${baseAmount}`);
    
    // Get output token decimals - will throw if token doesn't exist
    const outputDecimals = await getTokenDecimals(outputMint, connection);
    console.log(`Output token decimals: ${outputDecimals}`);

    // Check if we're swapping to SOL
    const isOutputSOL = outputMint === WSOL_MINT || outputMint.toLowerCase() === WSOL_MINT.toLowerCase();
    console.log(`Is output SOL: ${isOutputSOL}`);

    // Get the appropriate fee account if fee wallet is provided
    let feeAccount: string | undefined;
    if (feeWalletPubkey) {
        feeAccount = await getFeeAccount(outputMint, feeWalletPubkey, connection, walletKeypair);
        console.log(`Using fee account: ${feeAccount} for output mint: ${outputMint}`);
    }
    
    // Calculate fee amount if fee wallet is provided
    const feeAmount = feeWalletPubkey ? Math.floor((baseAmount * feeBps) / 10000) : 0;
    console.log(`Fee amount: ${feeAmount}`);
    
    // Step 1: Get quote from Jupiter API
    console.log(`Fetching quote from Jupiter API...`);
    const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${baseAmount}&slippageBps=${slippageBps}${feeAccount ? `&platformFeeBps=${feeBps}` : ''}`;
    
    console.log(`Quote URL: ${quoteUrl}`);
    const quoteResponse = await fetch(quoteUrl).then(res => {
      if (!res.ok) {
        return res.text().then(text => {
          throw new Error(`Quote request failed: ${text}`);
        });
      }
      return res.json();
    });

    if (!quoteResponse || quoteResponse.error) {
      throw new Error('Failed to fetch quote: ' + (quoteResponse?.error || 'Unknown error'));
    }
    
    console.log(`Quote response:`, JSON.stringify(quoteResponse, null, 2));
    
    // Step 2: Get swap transaction
    console.log(`Requesting swap transaction...`);
    const swapRequestBody: SwapRequestBody = {
      quoteResponse,
      userPublicKey: walletKeypair.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicSlippage: { maxBps: 300 },
    };

    // Only add fee account if it's provided
    if (feeAccount) {
      swapRequestBody.feeAccount = feeAccount;
    }
    
    console.log(`Swap request body:`, JSON.stringify(swapRequestBody, null, 2));
    const swapResponse = await fetch('https://api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(swapRequestBody),
    }).then(res => res.json());

    if (!swapResponse.swapTransaction) {
      throw new Error('Failed to get swap transaction: ' + (swapResponse.error || 'Unknown error'));
    }
    
    console.log(`Swap transaction received, deserializing...`);

    // Step 3: Deserialize and sign the transaction
    const swapTransactionBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    
    // Get private key from localStorage
    const privateKey = localStorage.getItem(`wallet_${walletKeypair.publicKey.toString()}`);
    if (!privateKey) {
      throw new Error('Private key not found in localStorage');
    }
    
    // Create keypair from private key
    const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(privateKey)));
    
    // Sign the transaction
    transaction.sign([keypair]);
    console.log(`Transaction signed by ${walletKeypair.publicKey.toString()}`);

    // Step 4: Execute the transaction
    console.log(`Sending transaction to network...`);
    const latestBlockHash = await connection.getLatestBlockhash('finalized');
    const rawTransaction = transaction.serialize();
    const txid = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 3,
      preflightCommitment: 'finalized'
    });
    
    console.log(`Transaction sent with ID: ${txid}`);

    // Use new confirmation logic
    try {
      await confirmTransaction(
        connection,
        txid,
        latestBlockHash.blockhash,
        latestBlockHash.lastValidBlockHeight
      );
      console.log(`Transaction confirmed: https://solscan.io/tx/${txid}`);
    } catch (error: unknown) {
      if (error instanceof Error && error.message?.includes('block height exceeded')) {
        // Get new blockhash and retry
        const newBlockhash = await connection.getLatestBlockhash('finalized');
        transaction.message.recentBlockhash = newBlockhash.blockhash;
        transaction.sign([keypair]);
        
        const newTxid = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
          preflightCommitment: 'finalized'
        });
        
        await confirmTransaction(
          connection,
          newTxid,
          newBlockhash.blockhash,
          newBlockhash.lastValidBlockHeight
        );
        console.log(`Retry transaction confirmed: https://solscan.io/tx/${newTxid}`);
      } else {
        throw error;
      }
    }

    // Return the result
    return {
      txid,
      inputAmount: Number(quoteResponse.inAmount),
      outputAmount: Number(quoteResponse.outAmount),
      inputDecimals,
      outputDecimals,
      fee: feeAmount,
    };

  } catch (error) {
    console.error('Swap failed:', error);
    throw error;
  }
}

// Example usage (commented out)
/*
async function main() {
  const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a', 'confirmed');
  const walletKeypair = Keypair.fromSecretKey(bs58.decode('YOUR_PRIVATE_KEY_BASE58'));
  const feeWalletPubkey = 'FEE_WALLET_PUBLIC_KEY';

  try {
    const result = await swapTokens({
      inputMint: 'So11111111111111111111111111111111111111112', // SOL
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      amount: 1, // 1 SOL
      slippageBps: 50, // 0.5% slippage
      walletKeypair,
      feeWalletPubkey,
      connection,
    });
    console.log('Swap result:', result);
  } catch (error) {
    console.error('Error in main:', error);
  }
}
*/