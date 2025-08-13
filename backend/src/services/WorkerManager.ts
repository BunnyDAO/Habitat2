import { Pool } from 'pg';
import { Connection } from '@solana/web3.js';
import { PairTradeWorker } from '../workers/PairTradeWorker';
import { DriftPerpWorker } from '../workers/DriftPerpWorker';
import { TokenService } from './TokenService';
import { SwapService } from './swap.service';
import { PairTradeJob, DriftPerpJob, JobType, AnyJob } from '../types/jobs';
import { BaseWorker } from '../workers/BaseWorker';

/**
 * Manages worker instances for different job types
 * Provides centralized access to workers for the daemon
 */
export class WorkerManager {
  private static workers: Map<string, BaseWorker> = new Map();
  private static pool: Pool;
  private static tokenService: TokenService;
  private static swapService: SwapService;

  /**
   * Initialize the WorkerManager with required services
   */
  static initialize(pool: Pool, tokenService: TokenService, connection: Connection): void {
    this.pool = pool;
    this.tokenService = tokenService;
    this.swapService = new SwapService(pool, connection);
  }

  /**
   * Create and register a worker for a job
   */
  static async createWorker(job: AnyJob, endpoint: string): Promise<BaseWorker> {
    const workerId = job.id;

    // Remove existing worker if it exists
    if (this.workers.has(workerId)) {
      const existingWorker = this.workers.get(workerId)!;
      await existingWorker.stop();
      this.workers.delete(workerId);
    }

    let worker: BaseWorker;

    switch (job.type) {
      case JobType.PAIR_TRADE:
        worker = new PairTradeWorker(
          job as PairTradeJob, 
          endpoint, 
          this.pool,
          this.swapService
        );
        break;
      
      case JobType.DRIFT_PERP:
        worker = new DriftPerpWorker(
          job as DriftPerpJob,
          endpoint,
          this.tokenService,
          this.pool
        );
        break;
      
      // Add other worker types as needed
      // case JobType.LEVELS:
      //   worker = new LevelsWorker(job as LevelsStrategy, endpoint, this.swapService);
      //   break;
      
      default:
        throw new Error(`Unsupported job type: ${job.type}`);
    }

    this.workers.set(workerId, worker);
    console.log(`[WorkerManager] Created worker for job ${workerId} (${job.type})`);
    
    return worker;
  }

  /**
   * Get an existing worker by ID
   */
  static async getWorker(jobId: string): Promise<BaseWorker | null> {
    const worker = this.workers.get(jobId);
    
    if (!worker) {
      // Check if WorkerManager is initialized
      if (!this.pool) {
        console.warn('[WorkerManager] WorkerManager not initialized, cannot create worker');
        return null;
      }
      
      // Try to load the job from database and create worker
      try {
        const result = await this.pool.query(
          'SELECT * FROM jobs WHERE id = $1 AND is_active = true', 
          [jobId]
        );
        
        if (result.rows.length === 0) {
          console.warn(`[WorkerManager] Job ${jobId} not found or inactive`);
          return null;
        }
        
        const jobData = result.rows[0];
        const job: AnyJob = {
          ...jobData.data,
          id: jobData.id,
          tradingWalletPublicKey: jobData.trading_wallet_public_key,
          tradingWalletSecretKey: new Uint8Array(jobData.trading_wallet_secret_key),
          isActive: jobData.is_active,
          createdAt: jobData.created_at
        };
        
        // Use default endpoint - you might want to make this configurable
        const worker = await this.createWorker(job, 'https://api.mainnet-beta.solana.com');
        await worker.start();
        
        return worker;
      } catch (error) {
        console.error(`[WorkerManager] Error loading worker ${jobId}:`, error);
        return null;
      }
    }
    
    return worker;
  }

  /**
   * Remove and stop a worker
   */
  static async removeWorker(jobId: string): Promise<void> {
    const worker = this.workers.get(jobId);
    if (worker) {
      await worker.stop();
      this.workers.delete(jobId);
      console.log(`[WorkerManager] Removed worker for job ${jobId}`);
    }
  }

  /**
   * Get all active workers
   */
  static getActiveWorkers(): Map<string, BaseWorker> {
    return new Map(this.workers);
  }

  /**
   * Stop all workers
   */
  static async stopAll(): Promise<void> {
    console.log(`[WorkerManager] Stopping ${this.workers.size} workers...`);
    
    const stopPromises = Array.from(this.workers.values()).map(worker => 
      worker.stop().catch(error => 
        console.error('[WorkerManager] Error stopping worker:', error)
      )
    );
    
    await Promise.all(stopPromises);
    this.workers.clear();
    
    console.log('[WorkerManager] All workers stopped');
  }

  /**
   * Get worker count by type
   */
  static getWorkerStats(): { [key: string]: number } {
    const stats: { [key: string]: number } = {};
    
    for (const worker of this.workers.values()) {
      const type = (worker as any).job?.type || 'unknown';
      stats[type] = (stats[type] || 0) + 1;
    }
    
    return stats;
  }

  /**
   * Restart a worker
   */
  static async restartWorker(jobId: string): Promise<BaseWorker | null> {
    await this.removeWorker(jobId);
    return await this.getWorker(jobId);
  }
}