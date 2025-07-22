import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { VaultWorker } from '../../workers/VaultWorker';
import { VaultStrategy, JobType } from '../../types/jobs';
import { PublicKey, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { SwapService } from '../../services/swap.service';

// Mock SwapService
const mockSwapService = {
  executeSwap: jest.fn(),
  getQuote: jest.fn()
} as unknown as jest.Mocked<SwapService>;

// Mock Solana Connection
const mockConnection = {
  getBalance: jest.fn(),
  getRecentBlockhash: jest.fn(),
  sendRawTransaction: jest.fn(),
  confirmTransaction: jest.fn(),
} as any;

// Mock console to capture logs
const mockConsole = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

describe('VaultWorker - Financial Safety Critical Tests', () => {
  let worker: VaultWorker;
  let mockJob: VaultStrategy;
  let mockTradingKeypair: Keypair;
  let mockMainWallet: PublicKey;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup test keypairs
    mockTradingKeypair = Keypair.generate();
    mockMainWallet = Keypair.generate().publicKey;

    // Create base job with valid data
    mockJob = {
      id: 'test-vault-job-1',
      type: JobType.VAULT,
      tradingWalletPublicKey: mockTradingKeypair.publicKey.toString(),
      tradingWalletSecretKey: mockTradingKeypair.secretKey,
      mainWalletPublicKey: mockMainWallet.toString(),
      vaultPercentage: 0.5, // 0.5% (default value)
      isActive: true,
      lastActivity: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      profitTracking: {
        initialBalance: 10,
        currentBalance: 10,
        totalProfit: 0,
        profitHistory: [],
        trades: []
      }
    };

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation(mockConsole.log);
    jest.spyOn(console, 'warn').mockImplementation(mockConsole.warn);
    jest.spyOn(console, 'error').mockImplementation(mockConsole.error);

    // Create worker with mocked dependencies
    worker = new VaultWorker(mockJob, 'test-endpoint', mockSwapService);
    (worker as any).connection = mockConnection;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initialization & Validation - Critical Financial Safety', () => {
    it('should initialize with valid 0.5% vault percentage (default)', () => {
      expect((worker as any).vaultPercentage).toBe(0.5);
      expect(mockConsole.log).toHaveBeenCalledWith('VaultWorker initialized: 0.5% allocation to vault');
    });

    it('should cap vault percentage at 5% maximum', () => {
      const highPercentageJob = { ...mockJob, vaultPercentage: 10 }; // 10% - should be capped
      const cappedWorker = new VaultWorker(highPercentageJob, 'test-endpoint', mockSwapService);
      
      expect((cappedWorker as any).vaultPercentage).toBe(5); // Should be capped at 5%
      expect(mockConsole.warn).toHaveBeenCalledWith(
        'Vault percentage 10% exceeds maximum 5%. Capping at 5%'
      );
    });

    it('should reject negative vault percentages', () => {
      const negativeJob = { ...mockJob, vaultPercentage: -5 };
      
      expect(() => {
        new VaultWorker(negativeJob, 'test-endpoint', mockSwapService);
      }).toThrow('Vault percentage cannot be negative');
    });

    it('should store main wallet address correctly', () => {
      expect((worker as any).mainWalletPublicKey).toBe(mockMainWallet.toString());
      expect(mockConsole.log).toHaveBeenCalledWith(
        `Main wallet: ${mockMainWallet.toString()}`
      );
    });
  });

  describe('Balance Calculations - Critical Financial Logic', () => {
    it('should calculate target vault amount correctly', async () => {
      // Setup: Trading wallet has 10 SOL, main wallet has 0 SOL
      const tradingBalance = 10 * 1e9; // 10 SOL in lamports
      const mainBalance = 0 * 1e9; // 0 SOL in lamports
      
      mockConnection.getBalance
        .mockResolvedValueOnce(tradingBalance) // First call for trading wallet
        .mockResolvedValueOnce(mainBalance);   // Second call for main wallet

      // Mock the private method call
      const checkAndRebalanceSpy = jest.spyOn(worker as any, 'checkAndRebalance');
      
      await (worker as any).checkAndRebalance();

      // Verify balance checks were called
      expect(mockConnection.getBalance).toHaveBeenCalledTimes(2);
      
      // Verify calculations logged correctly
      expect(mockConsole.log).toHaveBeenCalledWith('Trading wallet balance: 10 SOL');
      expect(mockConsole.log).toHaveBeenCalledWith('Main wallet balance: 0 SOL');
      expect(mockConsole.log).toHaveBeenCalledWith('Total portfolio value: 10 SOL');
      expect(mockConsole.log).toHaveBeenCalledWith('Target vault amount: 0.05 SOL (0.5%)'); // 0.5% of 10 SOL
    });

    it('should detect when vault needs funding', async () => {
      // Setup: Trading wallet has 100 SOL, vault should have 0.5 SOL but has 0
      mockConnection.getBalance
        .mockResolvedValueOnce(100 * 1e9) // Trading wallet: 100 SOL
        .mockResolvedValueOnce(0);        // Main wallet (vault): 0 SOL

      // Mock the transfer method to prevent actual transaction
      jest.spyOn(worker as any, 'moveToVault').mockResolvedValue(undefined);

      await (worker as any).checkAndRebalance();

      // Should detect 0.5 SOL difference and trigger moveToVault
      expect(mockConsole.log).toHaveBeenCalledWith('Target vault amount: 0.5 SOL (0.5%)');
      expect(mockConsole.log).toHaveBeenCalledWith('Vault difference: 0.5 SOL');
      expect((worker as any).moveToVault).toHaveBeenCalledWith(0.5);
    });

    it('should detect when vault is over-allocated', async () => {
      // Setup: Portfolio worth 10 SOL total, but vault has 5 SOL (should only have 0.3)
      mockConnection.getBalance
        .mockResolvedValueOnce(5 * 1e9)  // Trading wallet: 5 SOL
        .mockResolvedValueOnce(5 * 1e9); // Main wallet (vault): 5 SOL (too much!)

      // Mock the withdrawal method
      jest.spyOn(worker as any, 'moveFromVault').mockResolvedValue(undefined);

      await (worker as any).checkAndRebalance();

      // Total portfolio = 5 + 5 = 10 SOL
      // Target vault = 0.5% of 10 = 0.05 SOL
      // Current vault = 5 SOL
      // Difference = 0.05 - 5 = -4.95 SOL (need to withdraw 4.95)
      expect(mockConsole.log).toHaveBeenCalledWith('Target vault amount: 0.05 SOL (0.5%)');
      expect(mockConsole.log).toHaveBeenCalledWith('Vault difference: -4.95 SOL');
      expect((worker as any).moveFromVault).toHaveBeenCalledWith(4.95);
    });

    it('should ignore small differences below threshold', async () => {
      // Setup: Vault has 0.055 SOL, should have 0.05 SOL (difference of 0.005 < 0.01 threshold)  
      mockConnection.getBalance
        .mockResolvedValueOnce(10 * 1e9)     // Trading wallet: 10 SOL
        .mockResolvedValueOnce(0.055 * 1e9); // Main wallet: 0.055 SOL

      // Mock transfer methods
      jest.spyOn(worker as any, 'moveToVault').mockResolvedValue(undefined);
      jest.spyOn(worker as any, 'moveFromVault').mockResolvedValue(undefined);

      await (worker as any).checkAndRebalance();

      // Should not trigger any transfers (difference is too small)
      expect((worker as any).moveToVault).not.toHaveBeenCalled();
      expect((worker as any).moveFromVault).not.toHaveBeenCalled();
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('Vault is balanced')
      );
    });
  });

  describe('SOL Transfer Operations - Financial Safety Critical', () => {
    beforeEach(() => {
      // Mock successful transaction responses
      mockConnection.getRecentBlockhash.mockResolvedValue({
        blockhash: 'test-blockhash'
      });
      mockConnection.sendRawTransaction.mockResolvedValue('test-signature');
      mockConnection.confirmTransaction.mockResolvedValue({
        value: { err: null }
      });
    });

    it('should transfer SOL to main wallet correctly', async () => {
      const transferAmount = 1.5; // 1.5 SOL
      
      await (worker as any).transferSolToMainWallet(transferAmount);

      // Verify transaction was sent
      expect(mockConnection.sendRawTransaction).toHaveBeenCalled();
      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith('test-signature', 'confirmed');
      expect(mockConsole.log).toHaveBeenCalledWith('✅ SOL transfer completed - Signature: test-signature');
    });

    it('should convert SOL to lamports correctly', async () => {
      const transferAmount = 2.5; // 2.5 SOL
      const expectedLamports = 2.5 * 1e9; // 2,500,000,000 lamports

      // Spy on SystemProgram.transfer to verify correct lamports
      const transferSpy = jest.spyOn(SystemProgram, 'transfer');
      
      await (worker as any).transferSolToMainWallet(transferAmount);

      expect(transferSpy).toHaveBeenCalledWith({
        fromPubkey: mockTradingKeypair.publicKey,
        toPubkey: new PublicKey(mockMainWallet.toString()),
        lamports: expectedLamports,
      });
    });

    it('should handle transfer failures gracefully', async () => {
      mockConnection.sendRawTransaction.mockRejectedValue(new Error('Network error'));
      
      await expect((worker as any).transferSolToMainWallet(1.0))
        .rejects.toThrow('Network error');
    });
  });

  describe('Vault Movement Operations - Business Logic', () => {
    it('should execute complete vault funding flow', async () => {
      const amount = 2.5;
      
      // Mock sub-operations
      jest.spyOn(worker as any, 'swapTokensToSol').mockResolvedValue(undefined);
      jest.spyOn(worker as any, 'transferSolToMainWallet').mockResolvedValue(undefined);

      await (worker as any).moveToVault(amount);

      expect((worker as any).swapTokensToSol).toHaveBeenCalled();
      expect((worker as any).transferSolToMainWallet).toHaveBeenCalledWith(amount);
      expect(mockConsole.log).toHaveBeenCalledWith(`✅ Successfully moved ${amount} SOL to vault`);
    });

    it('should log vault withdrawal operations', async () => {
      const amount = 1.5;
      
      await (worker as any).moveFromVault(amount);

      // Should log the operation (actual implementation requires user approval)
      expect(mockConsole.log).toHaveBeenCalledWith('⚠️  Vault withdrawal requires main wallet signature - operation logged only');
    });

    it('should handle vault funding failures', async () => {
      const amount = 2.5;
      const error = new Error('Swap failed');
      
      jest.spyOn(worker as any, 'swapTokensToSol').mockRejectedValue(error);

      await expect((worker as any).moveToVault(amount))
        .rejects.toThrow('Swap failed');
      
      expect(mockConsole.error).toHaveBeenCalledWith(
        `❌ Failed to move ${amount} SOL to vault:`,
        error
      );
    });
  });

  describe('Edge Cases & Error Handling - Robustness', () => {
    it('should handle zero balance scenarios', async () => {
      mockConnection.getBalance.mockResolvedValue(0); // Both wallets empty
      
      await (worker as any).checkAndRebalance();
      
      expect(mockConsole.log).toHaveBeenCalledWith('Trading wallet balance: 0 SOL');
      expect(mockConsole.log).toHaveBeenCalledWith('Total portfolio value: 0 SOL');
      expect(mockConsole.log).toHaveBeenCalledWith('Target vault amount: 0 SOL (0.5%)');
    });

    it('should handle connection failures gracefully', async () => {
      mockConnection.getBalance.mockRejectedValue(new Error('Connection failed'));
      
      await expect((worker as any).checkAndRebalance())
        .rejects.toThrow('Connection failed');
      
      expect(mockConsole.error).toHaveBeenCalledWith(
        '❌ Error checking and rebalancing vault:',
        expect.any(Error)
      );
    });

    it('should validate minimum transfer amounts', async () => {
      // Test with very small difference (less than MIN_TRANSFER_AMOUNT = 0.01)
      mockConnection.getBalance
        .mockResolvedValueOnce(10 * 1e9)      // Trading: 10 SOL
        .mockResolvedValueOnce(0.295 * 1e9);  // Vault: 0.295 SOL (target: 0.3, diff: 0.005)

      jest.spyOn(worker as any, 'moveToVault').mockResolvedValue(undefined);

      await (worker as any).checkAndRebalance();

      // Should not trigger transfer (0.005 < 0.01 threshold)
      expect((worker as any).moveToVault).not.toHaveBeenCalled();
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('Vault is balanced')
      );
    });
  });

  describe('Worker Lifecycle - System Integration', () => {
    it('should start and stop correctly', async () => {
      // Mock the monitoring loop to prevent infinite execution
      jest.spyOn(worker as any, 'monitorVault').mockResolvedValue(undefined);

      await worker.start();
      expect((worker as any).isRunning).toBe(true);
      
      worker.stop();
      expect((worker as any).isRunning).toBe(false);
    });

    it('should prevent multiple starts', async () => {
      jest.spyOn(worker as any, 'monitorVault').mockResolvedValue(undefined);
      
      await worker.start();
      await worker.start(); // Second start should be ignored
      
      expect((worker as any).isRunning).toBe(true);
    });

    it('should update job activity timestamp on rebalancing', async () => {
      const initialActivity = mockJob.lastActivity;
      
      // Setup significant difference to trigger rebalancing
      mockConnection.getBalance
        .mockResolvedValueOnce(10 * 1e9)  // Trading: 10 SOL
        .mockResolvedValueOnce(0);        // Vault: 0 SOL (should be 0.3)

      jest.spyOn(worker as any, 'moveToVault').mockResolvedValue(undefined);

      await (worker as any).checkAndRebalance();

      // Job activity should be updated
      expect(mockJob.lastActivity).not.toBe(initialActivity);
    });
  });

  describe('Financial Safety Validations', () => {
    it('should enforce 5% maximum vault percentage in all scenarios', () => {
      const testCases = [
        { input: 0, expected: 0 },
        { input: 1, expected: 1 },
        { input: 5, expected: 5 },
        { input: 6, expected: 5 }, // Capped
        { input: 10, expected: 5 }, // Capped
        { input: 100, expected: 5 }, // Capped
      ];

      testCases.forEach(({ input, expected }) => {
        const result = (worker as any).validateAndCapPercentage(input);
        expect(result).toBe(expected);
      });
    });

    it('should prevent excessive transfers', async () => {
      // Test that minimum transfer threshold prevents micro-transactions
      const MIN_TRANSFER = 0.01; // 0.01 SOL
      
      expect((worker as any).MIN_TRANSFER_AMOUNT).toBe(MIN_TRANSFER);
    });
  });
});