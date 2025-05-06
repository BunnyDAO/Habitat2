import express from 'express';
import cors from 'cors';
import { StrategyExecutorService } from './services/strategy-executor.service';

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Start automation service
const strategyExecutor = StrategyExecutorService.getInstance();
strategyExecutor.start().catch(error => {
  console.error('Failed to start strategy executor:', error);
  process.exit(1);
});

// Routes
// ... existing routes ...

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 