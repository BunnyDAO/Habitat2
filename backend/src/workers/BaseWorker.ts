import { Connection } from '@solana/web3.js';
import { AnyJob } from '../types/jobs';

export abstract class BaseWorker {
  protected connection: Connection;
  protected job: AnyJob;
  protected endpoint: string;
  protected isRunning: boolean = false;

  constructor(job: AnyJob, endpoint: string) {
    this.job = job;
    this.endpoint = endpoint;
    this.connection = new Connection(endpoint);
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
} 