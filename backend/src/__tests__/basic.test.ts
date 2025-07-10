import { describe, it, expect } from '@jest/globals';

describe('Basic Test Suite', () => {
  it('should run basic math test', () => {
    expect(2 + 2).toBe(4);
  });

  it('should test environment setup', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('should test async operations', async () => {
    const result = await Promise.resolve('test');
    expect(result).toBe('test');
  });
});