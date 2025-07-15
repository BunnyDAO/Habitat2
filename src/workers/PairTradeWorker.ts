import { PairTradeJob } from '../types/jobs';

export class PairTradeWorker {
  private job: PairTradeJob;
  private endpoint: string;
  private isRunning: boolean = false;

  constructor(job: PairTradeJob, endpoint: string) {
    this.job = job;
    this.endpoint = endpoint;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log(`Starting pair trade worker for ${this.job.tokenASymbol}/${this.job.tokenBSymbol}`);
    
    // Pair trade workers are typically triggered externally via API calls
    // so this worker mainly just needs to be "running" to show as active
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    console.log(`Stopping pair trade worker for ${this.job.tokenASymbol}/${this.job.tokenBSymbol}`);
  }

  getStatus(): { isRunning: boolean; lastActivity?: string } {
    return {
      isRunning: this.isRunning,
      lastActivity: this.job.lastSwapTimestamp
    };
  }

  updateJob(updatedJob: PairTradeJob): void {
    this.job = updatedJob;
  }
}