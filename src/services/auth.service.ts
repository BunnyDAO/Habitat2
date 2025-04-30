import apiClient from './api/api-client';
import { AxiosError } from 'axios';

export class AuthService {
  private static instance: AuthService;

  private constructor() {}

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  async signIn(walletAddress: string): Promise<string | null> {
    try {
      console.log('Attempting sign in with wallet:', walletAddress);
      const response = await apiClient.post('/auth/signin', { walletAddress });
      const { access_token } = response.data;
      
      if (!access_token) {
        console.error('No access token received from server');
        return null;
      }

      console.log('Sign in successful, storing token');
      localStorage.setItem('auth.token', access_token);
      
      // Verify token is stored correctly
      const storedToken = localStorage.getItem('auth.token');
      if (!storedToken) {
        console.error('Failed to store token in localStorage');
        return null;
      }

      return access_token;
    } catch (error) {
      console.error('Error signing in:', error);
      if (error instanceof AxiosError && error.response) {
        console.error('Error response:', error.response.data);
      }
      return null;
    }
  }

  async signOut(): Promise<boolean> {
    try {
      const token = await this.getSession();
      if (!token) {
        return true; // Already signed out
      }

      await apiClient.post('/auth/signout');
      localStorage.removeItem('auth.token');
      return true;
    } catch (error) {
      console.error('Error signing out:', error);
      // Still remove the token from localStorage even if the server request fails
      localStorage.removeItem('auth.token');
      return true;
    }
  }

  async getSession(): Promise<string | null> {
    try {
      const token = localStorage.getItem('auth.token');
      if (!token) {
        console.log('No session found in localStorage');
        return null;
      }

      console.log('Retrieved session token successfully');
      return token;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  }

  isAuthenticated(): boolean {
    return !!localStorage.getItem('auth.token');
  }
}

export const authService = AuthService.getInstance(); 