import { EventEmitter } from 'events';

export interface TradeSuccessEvent {
  strategyId: string;
  tradingWalletAddress: string;
  strategyType: string;
  signature: string;
  timestamp: string;
  amount?: number;
  profit?: number;
}

class TradeEventsService extends EventEmitter {
  private static instance: TradeEventsService;

  private constructor() {
    super();
  }

  public static getInstance(): TradeEventsService {
    if (!TradeEventsService.instance) {
      TradeEventsService.instance = new TradeEventsService();
    }
    return TradeEventsService.instance;
  }

  /**
   * Emit a trade success event that vault strategies can listen to
   */
  public emitTradeSuccess(event: TradeSuccessEvent): void {
    console.log(`[TradeEvents] Emitting trade success for strategy ${event.strategyId} on wallet ${event.tradingWalletAddress}`);
    this.emit('tradeSuccess', event);
  }

  /**
   * Listen for trade success events
   */
  public onTradeSuccess(callback: (event: TradeSuccessEvent) => void): void {
    this.on('tradeSuccess', callback);
  }

  /**
   * Remove trade success listener
   */
  public removeTradeSuccessListener(callback: (event: TradeSuccessEvent) => void): void {
    this.off('tradeSuccess', callback);
  }
}

export const tradeEventsService = TradeEventsService.getInstance(); 