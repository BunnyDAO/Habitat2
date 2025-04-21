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