import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function runSecurityMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  const client = await pool.connect();

  try {
    console.log('🔒 Starting security migration...');

    // Read the migration file
    const migrationPath = path.resolve(__dirname, '../database/migrations/010_add_auth_security_tables.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute the migration
    await client.query('BEGIN');
    
    console.log('📝 Executing security migration SQL...');
    await client.query(migrationSQL);
    
    await client.query('COMMIT');
    
    console.log('✅ Security migration completed successfully!');
    
    // Verify tables were created
    console.log('🔍 Verifying security tables...');
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN (
        'auth_sessions',
        'auth_attempts',
        'audit_logs',
        'api_rate_limits',
        'security_incidents'
      )
      ORDER BY table_name
    `);

    console.log('📊 Created security tables:');
    tableCheck.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });

    // Check functions
    const functionCheck = await client.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND routine_name IN (
        'cleanup_expired_sessions',
        'cleanup_old_auth_attempts',
        'check_rate_limit',
        'log_audit_event'
      )
      ORDER BY routine_name
    `);

    console.log('⚙️  Created functions:');
    functionCheck.rows.forEach(row => {
      console.log(`  ✓ ${row.routine_name}`);
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Security migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runSecurityMigration()
    .then(() => {
      console.log('🎉 Security migration process completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Security migration process failed:', error);
      process.exit(1);
    });
}

export { runSecurityMigration };