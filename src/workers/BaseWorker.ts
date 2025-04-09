import { Connection } from '@solana/web3.js';
import { BaseJob } from '../types/jobs';
import { createRateLimitedConnection } from '../utils/connection';

export abstract class BaseWorker {
  protected connection: Connection;
  protected job: BaseJob;
  protected isRunning: boolean = false;

  constructor(job: BaseJob, endpoint: string) {
    this.job = job;
    this.connection = createRateLimitedConnection(endpoint);
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  protected updateJobActivity() {
    this.job.lastActivity = new Date().toISOString();
  }

  public getJobId(): string {
    return this.job.id;
  }

  public isActive(): boolean {
    return this.isRunning;
  }
} 