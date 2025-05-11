import axios from 'axios';
import { authService } from '../auth.service';
import { API_CONFIG } from '../../config/api';

// Create an unauthenticated client for auth requests
const unauthenticatedClient = axios.create({
  baseURL: API_CONFIG.API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Create the main authenticated client
const apiClient = axios.create({
  baseURL: API_CONFIG.API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Add request interceptor to include auth token
apiClient.interceptors.request.use(
  async (config) => {
    const accessToken = await authService.getSession();
    console.log('API Request - Auth Token:', accessToken ? 'Token exists' : 'No token');
    
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
      console.log('Added Authorization header to request');
    } else {
      console.log('No auth token available for request');
    }
    return config;
  },
  (error) => {
    console.error('Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error);
    if (error.response) {
      console.error('Error response:', {
        status: error.response.status,
        data: error.response.data
      });
    }
    return Promise.reject(error);
  }
);

export { unauthenticatedClient };
export default apiClient; 