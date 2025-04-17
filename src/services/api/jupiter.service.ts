import apiClient from './api-client';

export interface JupiterQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  marketInfos: any[];
  amount: string;
  slippageBps: number;
  otherAmountThreshold: string;
  swapMode: string;
  fees: {
    signatureFee: number;
    openOrdersDeposits: number[];
    ataDeposits: number[];
    totalFeeAndDeposits: number;
    minimumSOLForTransaction: number;
  };
}

export const getQuote = async (
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number = 50
): Promise<JupiterQuote> => {
  try {
    const response = await apiClient.get('/jupiter/quote', {
      params: { inputMint, outputMint, amount, slippageBps }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching quote:', error);
    throw error;
  }
};

export const getAllTokens = async (): Promise<any[]> => {
  try {
    const response = await apiClient.get('/jupiter/tokens');
    return response.data;
  } catch (error) {
    console.error('Error fetching tokens:', error);
    throw error;
  }
}; 