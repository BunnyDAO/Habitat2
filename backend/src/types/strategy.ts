export interface StrategyConfig {
  type: 'DCA' | 'GRID';
  parameters: DCAParameters | GridParameters;
}

interface DCAParameters {
  tokenMint: string;
  amount: number;
  interval: number; // in minutes
  maxPrice?: number;
  minPrice?: number;
}

interface GridParameters {
  tokenMint: string;
  gridSize: number;
  upperPrice: number;
  lowerPrice: number;
  amountPerGrid: number;
}

export interface Strategy {
  id: number;
  tradingWalletId: number;
  mainWalletPubkey: string;
  strategyType: 'DCA' | 'GRID';
  config: StrategyConfig;
  isActive: boolean;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
  lastExecuted?: Date;
  nextExecution?: Date;
  position?: number;
  isLackey: boolean;
  originalWalletPubkey?: string;
  currentWalletPubkey?: string;
} 