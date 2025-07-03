/**
 * API Client for Integration Testing
 * 
 * Provides a typed HTTP client for testing API endpoints
 */

import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';

export interface ApiClientOptions {
  baseURL: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface AuthTokens {
  access_token: string;
}

export interface ApiError {
  message: string;
  code?: string;
  status: number;
  details?: any;
}

export class ApiClient {
  private client: AxiosInstance;
  private authToken: string | null = null;

  constructor(options: ApiClientOptions) {
    this.client = axios.create({
      baseURL: options.baseURL,
      timeout: options.timeout || 10000,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Add request interceptor to inject auth token
    this.client.interceptors.request.use((config) => {
      if (this.authToken) {
        config.headers.Authorization = `Bearer ${this.authToken}`;
      }
      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const apiError: ApiError = {
          message: error.message,
          status: error.response?.status || 500,
          details: error.response?.data,
        };
        
        if (error.response?.data && typeof error.response.data === 'object') {
          const data = error.response.data as any;
          if (data.error) {
            apiError.message = data.error;
          }
          if (data.code) {
            apiError.code = data.code;
          }
        }
        
        throw apiError;
      }
    );
  }

  /**
   * Set authentication token for subsequent requests
   */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Clear authentication token
   */
  clearAuthToken(): void {
    this.authToken = null;
  }

  /**
   * Sign in with wallet address
   */
  async signin(walletAddress: string): Promise<AuthTokens> {
    const response = await this.client.post<AuthTokens>('/api/auth/signin', {
      walletAddress,
    });
    
    const tokens = response.data;
    this.setAuthToken(tokens.access_token);
    return tokens;
  }

  /**
   * Sign out
   */
  async signout(): Promise<void> {
    await this.client.post('/api/auth/signout');
    this.clearAuthToken();
  }

  /**
   * Test authentication endpoint
   */
  async testAuth(): Promise<{ message: string }> {
    const response = await this.client.get<{ message: string }>('/api/auth/test');
    return response.data;
  }

  // Raw HTTP methods for flexibility
  async get<T = any>(url: string, config?: any): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }

  async post<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>> {
    return this.client.post<T>(url, data, config);
  }

  async put<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>> {
    return this.client.put<T>(url, data, config);
  }

  async delete<T = any>(url: string, config?: any): Promise<AxiosResponse<T>> {
    return this.client.delete<T>(url, config);
  }

  /**
   * Get the base URL
   */
  getBaseURL(): string {
    return this.client.defaults.baseURL || '';
  }
}

/**
 * Factory function to create an API client
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
