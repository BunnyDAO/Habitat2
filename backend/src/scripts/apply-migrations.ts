import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

interface PostgresError extends Error {
  code?: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;
}

async function applyMigrations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Create migrations table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get list of applied migrations
    const { rows: appliedMigrations } = await pool.query(
      'SELECT name FROM migrations'
    );
    const appliedMigrationNames = new Set(appliedMigrations.map(m => m.name));

    // Read migration files
    const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Apply each migration that hasn't been applied yet
    for (const file of migrationFiles) {
      if (!appliedMigrationNames.has(file)) {
        console.log(`Applying migration: ${file}`);
        const migration = fs.readFileSync(
          path.join(migrationsDir, file),
          'utf-8'
        );

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          let shouldCommit = true;
          
          // Apply the migration
          try {
            await client.query(migration);
          } catch (error) {
            const pgError = error as PostgresError;
            // If the error is about columns already existing, skip it
            if (pgError.code === '42701') {
              console.log(`Skipping migration ${file} as columns already exist`);
              shouldCommit = false;
              await client.query('ROLLBACK');
            } else {
              throw error;
            }
          }
          
          // Only record the migration and commit if we didn't skip it
          if (shouldCommit) {
            // Record the migration
            await client.query(
              'INSERT INTO migrations (name) VALUES ($1)',
              [file]
            );
            
            await client.query('COMMIT');
            console.log(`Successfully applied migration: ${file}`);
          }
        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`Error applying migration ${file}:`, error);
          throw error;
        } finally {
          client.release();
        }
      } else {
        console.log(`Skipping already applied migration: ${file}`);
      }
    }

    console.log('All migrations applied successfully');
  } catch (error) {
    console.error('Error applying migrations:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migrations if this file is run directly
if (require.main === module) {
  applyMigrations().catch(console.error);
}