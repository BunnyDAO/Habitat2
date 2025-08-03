import { Request, Response } from 'express';
import { SwapService } from '../../../services/swap.service';
import { EncryptionService } from '../../../services/encryption.service';
import { createClient } from '@supabase/supabase-js';
import { Keypair } from '@solana/web3.js';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
);

export class SwapController {
    private swapService: SwapService;

    constructor(swapService: SwapService) {
        if (!swapService) {
            throw new Error('SwapService is required');
        }
        this.swapService = swapService;
    }

    async executeSwap(req: Request, res: Response) {
        try {
            if (!this.swapService) {
                throw new Error('SwapService is not initialized');
            }

            const {
                inputMint,
                outputMint,
                amount,
                slippageBps,
                walletKeypair,
                feeWalletPubkey,
                feeBps
            } = req.body;

            if (!inputMint || !outputMint || !amount || !walletKeypair) {
                return res.status(400).json({ error: 'Missing required parameters' });
            }

            const result = await this.swapService.executeSwap({
                inputMint,
                outputMint,
                amount,
                slippageBps,
                walletKeypair,
                feeWalletPubkey,
                feeBps
            });

            res.json(result);
        } catch (error) {
            console.error('Error executing swap:', error);
            res.status(500).json({ 
                error: 'Failed to execute swap',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // New secure swap method that retrieves private key from backend
    async executeSecureSwap(req: Request, res: Response) {
        try {
            if (!this.swapService) {
                throw new Error('SwapService is not initialized');
            }

            const {
                inputMint,
                outputMint,
                amount,
                slippageBps = 50,
                tradingWalletPublicKey,
                feeWalletPubkey,
                feeBps = 0
            } = req.body;

            if (!inputMint || !outputMint || !amount || !tradingWalletPublicKey) {
                return res.status(400).json({ 
                    error: 'Missing required parameters: inputMint, outputMint, amount, tradingWalletPublicKey' 
                });
            }

            console.log('Executing secure swap with public key:', tradingWalletPublicKey);

            // Get trading wallet from database
            const { data: tradingWallet, error: walletError } = await supabase
                .from('trading_wallets')
                .select('id, wallet_pubkey')
                .eq('wallet_pubkey', tradingWalletPublicKey)
                .single();

            if (walletError || !tradingWallet) {
                return res.status(404).json({ error: 'Trading wallet not found' });
            }

            // Get encrypted private key securely
            const encryptionService = EncryptionService.getInstance();
            const privateKeyHex = await encryptionService.getWalletPrivateKey(tradingWallet.id);
            
            // Convert hex to Uint8Array and create Keypair
            const privateKeyBuffer = Buffer.from(privateKeyHex, 'hex');
            const keypair = Keypair.fromSecretKey(privateKeyBuffer);

            // Verify the public key matches
            if (keypair.publicKey.toString() !== tradingWalletPublicKey) {
                throw new Error('Private key does not match public key');
            }

            // Execute swap with the retrieved keypair
            const result = await this.swapService.executeSwap({
                inputMint,
                outputMint,
                amount,
                slippageBps,
                walletKeypair: {
                    publicKey: keypair.publicKey.toString(),
                    secretKey: Array.from(keypair.secretKey)
                },
                feeWalletPubkey,
                feeBps
            });

            console.log('Secure swap executed successfully:', result.signature);
            res.json(result);
        } catch (error) {
            console.error('Error executing secure swap:', error);
            res.status(500).json({ 
                error: 'Failed to execute secure swap',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
} 