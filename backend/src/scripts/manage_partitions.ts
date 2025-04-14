import { Pool } from 'pg';
import { config } from 'dotenv';
import { CronJob } from 'cron';
import { JupiterService } from '../services/jupiter.service';

// Load environment variables
config();

// Database connection configuration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Required for Supabase
    }
});

// Function to create new partition for next month
async function createNextMonthPartition() {
    const client = await pool.connect();
    try {
        // Get first day of next month
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextMonth.setDate(1);

        await client.query('SELECT create_transaction_partition($1)', [nextMonth]);
        console.log(`Created partition for ${nextMonth.toISOString().split('T')[0]}`);
    } catch (error) {
        console.error('Error creating partition:', error);
    } finally {
        client.release();
    }
}

// Function to archive old transactions
async function archiveOldTransactions() {
    const client = await pool.connect();
    try {
        await client.query('SELECT archive_old_transactions($1)', [6]); // Archive older than 6 months
        console.log('Archived transactions older than 6 months');
    } catch (error) {
        console.error('Error archiving transactions:', error);
    } finally {
        client.release();
    }
}

// Function to refresh materialized view
async function refreshDailySummaries() {
    const client = await pool.connect();
    try {
        await client.query('SELECT refresh_daily_summaries()');
        console.log('Refreshed daily transaction summaries');
    } catch (error) {
        console.error('Error refreshing daily summaries:', error);
    } finally {
        client.release();
    }
}

// Create cron jobs
const partitionJob = new CronJob(
    '0 0 1 * *', // Run at midnight on the 1st of every month
    createNextMonthPartition,
    null,
    true,
    'America/New_York'
);

const archiveJob = new CronJob(
    '0 0 2 * *', // Run at midnight on the 2nd of every month
    archiveOldTransactions,
    null,
    true,
    'America/New_York'
);

const refreshJob = new CronJob(
    '0 */4 * * *', // Run every 4 hours
    refreshDailySummaries,
    null,
    true,
    'America/New_York'
);

// Add token update job
const tokenUpdateJob = new CronJob(
    '0 * * * *', // Run every hour
    async () => {
        console.log('Starting token data update...');
        try {
            const jupiterService = new JupiterService(pool);
            await jupiterService.updateTokenData();
            console.log('Token data update completed successfully');
        } catch (error) {
            console.error('Error updating token data:', error);
        }
    },
    null,
    true,
    'America/New_York'
);

// Start the jobs
console.log('Starting partition management jobs...');
partitionJob.start();
archiveJob.start();
refreshJob.start();
tokenUpdateJob.start();

// Handle process termination
process.on('SIGINT', async () => {
    console.log('Stopping partition management jobs...');
    partitionJob.stop();
    archiveJob.stop();
    refreshJob.stop();
    tokenUpdateJob.stop();
    await pool.end();
    process.exit(0);
});

// Initial setup
console.log('Running initial setup...');
Promise.all([
    createNextMonthPartition(),
    archiveOldTransactions(),
    refreshDailySummaries()
]).then(() => {
    console.log('Initial setup complete');
}).catch(error => {
    console.error('Error during initial setup:', error);
}); 