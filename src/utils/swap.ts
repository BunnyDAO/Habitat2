import { Keypair } from '@solana/web3.js';

// Interface for swap parameters
interface SwapParams {
  inputMint: string;           // Input token mint address (e.g., SOL or any SPL token)
  outputMint: string;          // Output token mint address
  amount: number;              // Amount of input token to swap (in human-readable format, e.g., 1 for 1 SOL)
  slippageBps?: number;        // Slippage tolerance in basis points (e.g., 50 for 0.5%)
  walletKeypair: Keypair;      // User's keypair for signing
  feeWalletPubkey?: string;    // Public key of the fee wallet (optional)
  feeBps?: number;             // Fee in basis points (optional, e.g., 5 for 0.05%)
}

interface SwapResult {
  txid: string;                // Transaction ID
  inputAmount: number;         // Input amount in token's native format
  outputAmount: number;        // Expected output amount in token's native format
  inputDecimals: number;       // Decimals of input token
  outputDecimals: number;      // Decimals of output token
  fee?: number;                // Fee amount in token's native format (if applicable)
}

const API_BASE_URL = 'http://localhost:3001';
const MIN_SOL_AMOUNT = 0.005; // Minimum SOL amount for swaps

/**
 * Swaps tokens using the backend Jupiter Aggregator endpoint
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
}: SwapParams): Promise<SwapResult> {
  try {
    // Check if amount meets minimum requirements
    if (inputMint === 'So11111111111111111111111111111111111111112' && amount < MIN_SOL_AMOUNT) {
      throw new Error(`Amount ${amount} SOL is below minimum ${MIN_SOL_AMOUNT} SOL`);
    }

    console.log(`Starting swap: ${amount} from ${inputMint} to ${outputMint}`);
    
    // Get private key from localStorage
    const privateKey = localStorage.getItem(`wallet_${walletKeypair.publicKey.toString()}`);
    if (!privateKey) {
      throw new Error('Private key not found in localStorage');
    }
    
    // Call backend swap endpoint
    const response = await fetch(`${API_BASE_URL}/api/v1/swap/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputMint,
        outputMint,
        amount,
        slippageBps,
        walletKeypair: {
          publicKey: walletKeypair.publicKey.toString(),
          secretKey: Array.from(new Uint8Array(JSON.parse(privateKey)))
        },
        feeWalletPubkey,
        feeBps,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Swap API error:', errorText);
      throw new Error(`Swap request failed: ${errorText}`);
    }

    const result = await response.json();
    console.log('Swap completed successfully:', result);
    return result;
  } catch (error) {
    console.error('Swap failed:', error);
    throw error;
  }
}