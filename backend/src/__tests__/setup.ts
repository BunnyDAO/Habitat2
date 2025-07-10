import { jest } from '@jest/globals';

// Global test configuration
global.console = {
  ...console,
  // Suppress console logs in tests unless needed
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/habitat_test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.APP_SECRET = 'test-app-secret-for-encryption-testing-only';
process.env.JWT_SECRET = 'test-jwt-secret';

// Global test utilities
global.beforeEach(() => {
  jest.clearAllMocks();
});

// Increase timeout for financial operations
jest.setTimeout(30000);

// Mock Date.now for consistent testing
const mockDate = new Date('2024-01-01T00:00:00.000Z');
global.Date.now = jest.fn(() => mockDate.getTime());

console.log('🧪 Test environment initialized');