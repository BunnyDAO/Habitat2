import { PublicKey } from '@solana/web3.js';
import { JobType, WalletMonitoringJob, PriceMonitoringJob, VaultStrategy, LevelsStrategy, PairTradeJob, AnyJob } from '../types/jobs';
import { WalletMonitorWorker } from '../workers/WalletMonitorWorker';
import { PriceMonitorWorker } from '../workers/PriceMonitorWorker';
import { VaultWorker } from '../workers/VaultWorker';
import { LevelsWorker } from '../workers/LevelsWorker';
import { PairTradeWorker } from '../workers/PairTradeWorker';
import { PriceFeedService } from '../services/PriceFeedService';

export class JobManager {
  private workers: Map<string, WalletMonitorWorker | PriceMonitorWorker | VaultWorker | LevelsWorker | PairTradeWorker> = new Map();
  private endpoint: string;
  private userWallet: PublicKey;
  private priceFeedService: PriceFeedService;

  constructor(endpoint: string, userWallet: PublicKey) {
    this.endpoint = endpoint;
    this.userWallet = userWallet;
    this.priceFeedService = PriceFeedService.getInstance();
    this.priceFeedService.start();
  }

  async addJob(job: AnyJob): Promise<void> {
    if (this.workers.has(job.id)) {
      console.log(`Job ${job.id} already exists`);
      return;
    }

    let worker: WalletMonitorWorker | PriceMonitorWorker | VaultWorker | LevelsWorker | PairTradeWorker;

    switch (job.type) {
      case JobType.WALLET_MONITOR:
        // Wallet Monitor strategies run on backend daemon only - no frontend workers
        console.log(`Skipping frontend WalletMonitor worker for job ${job.id} - this strategy runs on backend only.`);
        return; // Skip creating worker - backend daemon will handle this
      case JobType.PRICE_MONITOR:
        // Price Monitor strategies run on backend daemon only - no frontend workers
        console.log(`Skipping frontend PriceMonitor worker for job ${job.id} - this strategy runs on backend only.`);
        return; // Skip creating worker - backend daemon will handle this
      case JobType.VAULT:
        // Vault strategies run on backend daemon only - no frontend workers
        console.log(`Skipping frontend Vault worker for job ${job.id} - this strategy runs on backend only.`);
        return; // Skip creating worker - backend daemon will handle this
      case JobType.LEVELS:
        // Levels strategies run on backend daemon only - no frontend workers
        console.log(`Skipping frontend Levels worker for job ${job.id} - this strategy runs on backend only.`);
        return; // Skip creating worker - backend daemon will handle this
      case JobType.PAIR_TRADE:
        // Pair Trade strategies run on backend daemon only - no frontend workers
        console.log(`Skipping frontend PairTrade worker for job ${job.id} - this strategy runs on backend only.`);
        return; // Skip creating worker - backend daemon will handle this
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    this.workers.set(job.id, worker);
    
    if (job.isActive) {
      await worker.start();
    }
  }

  async removeJob(jobId: string): Promise<void> {
    const worker = this.workers.get(jobId);
    if (worker) {
      await worker.stop();
      this.workers.delete(jobId);
    }
  }

  async toggleJob(jobId: string, isActive: boolean): Promise<void> {
    const worker = this.workers.get(jobId);
    if (worker) {
      if (isActive) {
        await worker.start();
      } else {
        await worker.stop();
      }
    }
  }

  stopAll(): void {
    this.workers.forEach(worker => worker.stop());
    this.workers.clear();
    this.priceFeedService.stop();
  }
} 