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

    let worker: WalletMonitorWorker | PriceMonitorWorker | VaultWorker | LevelsWorker;

    switch (job.type) {
      case JobType.WALLET_MONITOR:
        worker = new WalletMonitorWorker(
          job as WalletMonitoringJob,
          this.endpoint,
          new PublicKey(job.tradingWalletPublicKey)
        );
        break;
      case JobType.PRICE_MONITOR:
        worker = new PriceMonitorWorker(job as PriceMonitoringJob, this.endpoint);
        break;
      case JobType.VAULT:
        worker = new VaultWorker(job as VaultStrategy, this.endpoint);
        break;
      case JobType.LEVELS:
        worker = new LevelsWorker(job as LevelsStrategy, this.endpoint);
        break;
      case JobType.PAIR_TRADE:
        worker = new PairTradeWorker(job as PairTradeJob, this.endpoint);
        break;
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