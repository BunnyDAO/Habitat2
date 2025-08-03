import apiClient from './api-client';

export interface SwapParams {
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

export interface SecureSwapParams {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps?: number;
    tradingWalletPublicKey: string;
    feeWalletPubkey?: string;
    feeBps?: number;
}

export interface SwapResult {
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

export const executeSwap = async (params: SwapParams): Promise<SwapResult> => {
    try {
        const response = await apiClient.post('/swap/execute', params);
        return response.data;
    } catch (error) {
        console.error('Error executing swap:', error);
        throw error;
    }
};

export const executeSecureSwap = async (params: SecureSwapParams): Promise<SwapResult> => {
    try {
        const response = await apiClient.post('/swap/execute-secure', params);
        return response.data;
    } catch (error) {
        console.error('Error executing secure swap:', error);
        throw error;
    }
}; 