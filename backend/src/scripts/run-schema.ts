import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function runSchema() {
  // Create database connection
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    // Read the schema file
    const schemaPath = path.join(__dirname, '../../src/database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute the schema
    console.log('Running schema...');
    await pool.query(schema);
    console.log('Schema executed successfully!');

  } catch (error) {
    console.error('Error running schema:', error);
  } finally {
    // Close the connection
    await pool.end();
  }
}

// Run the script
runSchema(); 