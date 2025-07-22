import axios from 'axios';

export interface ValuationResult {
  recommendedToken: 'A' | 'B';
  reasoning: string;
  confidence: number;
  timestamp: Date;
}

interface ValuationAPIResponse {
  recommendation: 'A' | 'B';
  reasoning: string;
  confidence: number;
}

export class ValuationService {
  private cache = new Map<string, { result: ValuationResult; expiry: number }>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  async getUndervaluedToken(tokenAMint: string, tokenBMint: string): Promise<ValuationResult> {
    // Validate inputs
    if (!this.isValidMintAddress(tokenAMint) || !this.isValidMintAddress(tokenBMint)) {
      throw new Error('Invalid token mint addresses');
    }

    // Check cache first
    const cacheKey = `${tokenAMint}-${tokenBMint}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return cached.result;
    }

    try {
      const apiResponse = await this.callValuationAPI(tokenAMint, tokenBMint);
      
      const result: ValuationResult = {
        recommendedToken: apiResponse.recommendation,
        reasoning: apiResponse.reasoning,
        confidence: apiResponse.confidence,
        timestamp: new Date()
      };

      // Cache the result
      this.cache.set(cacheKey, {
        result,
        expiry: Date.now() + this.CACHE_DURATION
      });

      return result;
    } catch (error: any) {
      if (error.message === 'Request timeout') {
        throw new Error('Valuation service timeout');
      }
      throw new Error('Valuation service unavailable');
    }
  }

  private async callValuationAPI(tokenAMint: string, tokenBMint: string): Promise<ValuationAPIResponse> {
    try {
      const response = await axios.post(process.env.VALUATION_API_URL || 'http://localhost:3002/valuation', {
        tokenA: tokenAMint,
        tokenB: tokenBMint
      }, {
        timeout: 10000
      });

      return response.data;
    } catch (error: any) {
      console.log('⚠️ External valuation API unavailable, using fallback');
      // Fallback response when external API is not available
      return {
        recommendation: 'A' as 'A' | 'B',
        reasoning: 'Fallback response: External valuation service unavailable',
        confidence: 0.5
      };
    }
  }

  getCacheStatus(): { cacheSize: number; cacheEntries: string[] } {
    const entries = Array.from(this.cache.keys());
    return {
      cacheSize: this.cache.size,
      cacheEntries: entries
    };
  }

  private isValidMintAddress(mintAddress: string): boolean {
    if (!mintAddress || mintAddress.trim() === '') {
      return false;
    }
    
    // Allow known placeholder addresses for development (until real addresses are available)
    if (mintAddress === 'XsGOOGLAddress123') {
      console.log('⚠️ Using placeholder address for GOOGLx - should be updated with real mint address');
      return true;
    }
    
    // Basic validation - should be 32-44 characters (base58)
    if (mintAddress.length < 32 || mintAddress.length > 44) {
      return false;
    }

    // Check if it contains only valid base58 characters
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    return base58Regex.test(mintAddress);
  }
}