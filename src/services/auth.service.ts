import apiClient from './api/api-client';

export class AuthService {
  private static instance: AuthService;
  private constructor() {}

  static getInstance(): AuthService {
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
      return null;
    }
  }

  async signOut(): Promise<void> {
    try {
      const token = await this.getSession();
      if (token) {
        await apiClient.post('/auth/signout');
      }
      localStorage.removeItem('auth.token');
      console.log('Sign out successful');
    } catch (error) {
      console.error('Error signing out:', error);
      // Still remove the token from localStorage even if the API call fails
      localStorage.removeItem('auth.token');
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
}

export const authService = AuthService.getInstance(); 