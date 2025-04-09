# Lackey Backpack

A powerful Solana trading and wallet management tool built with React, TypeScript, and Vite.

## Overview

Lackey Backpack is a comprehensive Solana trading assistant that provides automated trading strategies, wallet monitoring, and price monitoring capabilities. It integrates with Jupiter Aggregator for optimal token swaps on Solana.

## Features

- **Trading Wallet Management**: Create, import, and manage multiple trading wallets
- **Wallet Monitoring**: Mirror transactions from any Solana wallet
- **Price Monitoring**: Set up price alerts and automated trading based on price thresholds
- **Vault Strategy**: Secure funds in a vault with customizable allocation
- **Jupiter Integration**: Seamless token swaps with the best rates via Jupiter Aggregator
- **Token Balance Tracking**: View and manage all your token balances with USD values
- **Transaction Execution**: Send and sign transactions directly from the interface

## Getting Started

### Prerequisites

- Node.js v20.10.0 or higher
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/BunnyDAO/lackey-backpack.git
cd lackey-backpack
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Start the development server:
```bash
npm run dev
# or
yarn dev
```

4. Open your browser and navigate to `http://localhost:5173`

### Backend Setup

The backend server handles API interactions and data processing.

1.  **Navigate to the backend directory**:
    ```bash
    cd backend
    ```

2.  **Install backend dependencies**:
    ```bash
    npm install
    ```
    *Note: If you encounter issues with `ts-node` not being found, try removing the `backend/node_modules` directory (`Remove-Item -Recurse -Force node_modules` on PowerShell or `rm -rf node_modules` on bash/zsh) and running `npm install` again within the `backend` directory.*

3.  **Create environment file**:
    Create a `.env` file in the `backend` directory (`backend/.env`) and populate it with the following variables. Replace the placeholder values (`<YOUR_..._KEY>`, etc.) with your actual credentials.

    ```dotenv
    # API Keys
    HELIUS_API_KEY=<YOUR_HELIUS_API_KEY>
    BIRDEYE_API_KEY=<YOUR_BIRDEYE_API_KEY>

    # Database (Supabase)
    DATABASE_URL=<YOUR_SUPABASE_DATABASE_URL> # e.g., postgresql://postgres.xxx:yyy@zzz.pooler.supabase.com:6543/postgres

    # Redis Configuration
    REDIS_HOST=<YOUR_REDIS_HOST>
    REDIS_PORT=<YOUR_REDIS_PORT>
    REDIS_PASSWORD=<YOUR_REDIS_PASSWORD>

    # Server Configuration
    PORT=3001 # Or your desired port
    NODE_ENV=development

    # Supabase
    SUPABASE_URL=<YOUR_SUPABASE_PROJECT_URL> # e.g., https://xxx.supabase.co
    SUPABASE_ANON_KEY=<YOUR_SUPABASE_ANON_KEY>
    ```

4.  **Start the backend server** (from the `backend` directory):
    ```bash
    npm run dev
    ```

## Usage

### Connecting Your Wallet

1. Click the "Connect Wallet" button in the top right corner
2. Select your wallet provider (Phantom, Solflare, etc.)
3. Approve the connection request

### Creating a Trading Wallet

1. Navigate to the Dashboard
2. Click "Generate New Wallet"
3. Fund your trading wallet from your main wallet
4. Start setting up automated strategies

### Setting Up Monitoring Jobs

#### Wallet Monitoring
- Enter a wallet address to monitor
- Set the percentage of funds to allocate
- Enable the job to start mirroring transactions

#### Price Monitoring
- Set a target price and direction (above/below)
- Configure the percentage to sell when triggered
- Enable to activate the monitoring

## Development

### Project Structure

- `src/components/`: React components
- `src/services/`: Service classes for external APIs
- `src/managers/`: Business logic managers
- `src/types/`: TypeScript type definitions
- `src/utils/`: Utility functions
- `src/workers/`: Web workers for background processing

### Building for Production

```bash
npm run build
# or
yarn build
```

## Security

- All sensitive wallet information is stored locally in your browser
- Private keys are never sent to any server
- Consider using hardware wallets for additional security

## License

This project is proprietary software owned by BunnyDAO.

## Acknowledgements

- [Jupiter Aggregator](https://jup.ag/) for swap functionality
- [Solana Web3.js](https://github.com/solana-labs/solana-web3.js) for blockchain interactions
- [Pyth Network](https://pyth.network/) for price feed data
