import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export interface Token {
  mint_address: string;
  name: string;
  symbol: string;
  decimals: number;
  logo_uri: string;
  price_usd: number;
  price_last_updated: string;
}

export const tokenService = {
  async getTokens() {
    const { data, error } = await supabase
      .from('tokens')
      .select('*');
    
    if (error) throw error;
    return data as Token[];
  },

  async getTokenByMint(mint: string) {
    const { data, error } = await supabase
      .from('tokens')
      .select('*')
      .eq('mint_address', mint)
      .single();
    
    if (error) throw error;
    return data as Token;
  }
}; 