import { BaseWorker } from './BaseWorker';
import { LevelsStrategy } from '../types/jobs';
import { createRateLimitedConnection } from '../utils/connection';

export class LevelsWorker extends BaseWorker {
  private subscription: number | undefined;

  constructor(job: LevelsStrategy, endpoint: string) {
    super(job, endpoint);
    this.connection = createRateLimitedConnection(endpoint);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`Starting levels strategy for wallet ${this.job.tradingWalletPublicKey}`);
    // Implement levels strategy logic here
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.subscription) {
      await this.connection.removeAccountChangeListener(this.subscription);
      this.subscription = undefined;
    }
    console.log(`Stopped levels strategy for wallet ${this.job.tradingWalletPublicKey}`);
  }
} 