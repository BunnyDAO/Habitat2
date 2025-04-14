import apiClient from './api-client';

export const getPrice = async (token: string): Promise<number> => {
  try {
    const response = await apiClient.get(`/price/${token}`);
    return response.data.price;
  } catch (error) {
    console.error('Error fetching price:', error);
    throw error;
  }
};

export const getPrices = async (tokens: string[]): Promise<Record<string, number>> => {
  try {
    const response = await apiClient.get('/prices', {
      params: { tokens: tokens.join(',') }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching prices:', error);
    throw error;
  }
}; 