import '@testing-library/jest-dom';
import { vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';
import { Pool } from 'pg';
import { TestDatabaseManager } from './helpers/db-setup';

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '../backend/.env.test') });

// Global test database manager
let testDbManager: TestDatabaseManager;
let testDb: Pool;

// Mock environment variables
vi.stubEnv('NODE_ENV', 'test');

// Mock global objects that might not be available in test environment
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock fetch for API calls
global.fetch = vi.fn();

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

beforeAll(async () => {
  console.log('🧪 Setting up test environment...');
  
  // Initialize test database
  testDbManager = new TestDatabaseManager();
  testDb = await testDbManager.setupTestDatabase();
  
  // Make test database available globally
  (global as any).testDb = testDb;
  
  console.log('✅ Test environment ready');
});

afterAll(async () => {
  console.log('🧹 Cleaning up test environment...');
  
  if (testDbManager) {
    await testDbManager.cleanupTestData();
  }
  
  if (testDb) {
    await testDb.end();
  }
  
  console.log('✅ Test cleanup complete');
});

beforeEach(async () => {
  // Clean test data before each test
  if (testDbManager) {
    await testDbManager.cleanupTestData();
  }
});

// Cleanup after each test
afterEach(async () => {
  // Clean test data after each test
  if (testDbManager) {
    await testDbManager.cleanupTestData();
  }
  
  vi.clearAllMocks();
});
