import { describe, it, expect, vi } from 'vitest';

describe('Smoke Test', () => {
  it('should run a basic test', () => {
    expect(true).toBe(true);
  });

  it('should have vitest globals available', () => {
    expect(describe).toBeDefined();
    expect(it).toBeDefined();
    expect(expect).toBeDefined();
    expect(vi).toBeDefined();
  });

  it('should have testing environment set up correctly', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('should have mocked localStorage available', () => {
    expect(window.localStorage).toBeDefined();
    expect(typeof window.localStorage.getItem).toBe('function');
    expect(typeof window.localStorage.setItem).toBe('function');
  });

  it('should be able to mock functions', () => {
    const mockFn = vi.fn();
    mockFn('test');
    expect(mockFn).toHaveBeenCalledWith('test');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});
