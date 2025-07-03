/**
 * Test Server Setup for API Testing
 * 
 * Provides utilities to start/stop the backend server for integration testing
 */

import { Express } from 'express';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

export class TestServer {
  private server: Server | null = null;
  private app: Express | null = null;
  private port: number = 0;

  constructor(app: Express) {
    this.app = app;
  }

  /**
   * Start the test server on a random available port
   */
  async start(): Promise<{ port: number; url: string }> {
    if (!this.app) {
      throw new Error('No Express app provided to TestServer');
    }

    return new Promise((resolve, reject) => {
      this.server = createServer(this.app!);
      
      this.server.listen(0, 'localhost', () => {
        const address = this.server!.address() as AddressInfo;
        this.port = address.port;
        const url = `http://localhost:${this.port}`;
        
        console.log(`🧪 Test server started on ${url}`);
        resolve({ port: this.port, url });
      });

      this.server.on('error', (error) => {
        console.error('❌ Test server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the test server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          console.error('❌ Error stopping test server:', error);
          reject(error);
        } else {
          console.log('✅ Test server stopped');
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Get the current server URL
   */
  getUrl(): string {
    if (!this.server || this.port === 0) {
      throw new Error('Test server is not running');
    }
    return `http://localhost:${this.port}`;
  }

  /**
   * Get the current server port
   */
  getPort(): number {
    if (!this.server || this.port === 0) {
      throw new Error('Test server is not running');
    }
    return this.port;
  }

  /**
   * Check if the server is running
   */
  isRunning(): boolean {
    return this.server !== null && this.port !== 0;
  }
}

/**
 * Factory function to create a test server instance
 */
export function createTestServer(app: Express): TestServer {
  return new TestServer(app);
}
