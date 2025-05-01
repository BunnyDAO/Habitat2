import { BaseWorker } from './BaseWorker';
import { VaultStrategy } from '../types/jobs';
import { createRateLimitedConnection } from '../utils/connection';

export class VaultWorker extends BaseWorker {
  private subscription: number | undefined;

  constructor(job: VaultStrategy, endpoint: string) {
    super(job, endpoint);
    this.connection = createRateLimitedConnection(endpoint);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`Starting vault strategy for wallet ${this.job.tradingWalletPublicKey}`);
    // Implement vault strategy logic here
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.subscription) {
      await this.connection.removeAccountChangeListener(this.subscription);
      this.subscription = undefined;
    }
    console.log(`Stopped vault strategy for wallet ${this.job.tradingWalletPublicKey}`);
  }
} 