# Doge Pixel Portal v3

A decentralized pixel art platform enabling fractional ownership of "The Doge NFT" through individual pixel tokens on Base L2.

Original code (v1): gainor
v3 refactor: orbism @ moon

## Project Overview

The Doge Pixel Portal allows users to own, trade, and interact with individual pixels from the iconic Doge NFT image. Each pixel is represented as an ERC721 token (PX) that can be minted by locking DOG20 tokens. The project consists of smart contracts, a backend indexer/API, and a React-based frontend.

### Core Concept

- **307,200 pixels** total (640x480 grid)
- Each pixel = individual ERC721 NFT token
- Minting requires locking $DOG
- Burning pixels unlocks $DOG
- Reservation/claim system for legacy holders
- Built on Base L2 for low transaction costs

## Architecture

```
┌─────────────────┐
│   React App     │  Vercel deployment
│   (Frontend)    │  User interface, wallet connection
└────────┬────────┘
         │ HTTP/WebSocket
┌────────▼────────┐
│   NestJS API    │  Heroku deployment
│   (Server)      │  Event indexing, data API
└────────┬────────┘
         │ WebSocket
┌────────▼────────┐
│   Base L2       │  Smart contracts
│   Blockchain    │  PX (ERC721) + $DOG (ERC20)
└─────────────────┘
```

### Repository Structure

```
doge-pixels-base/
├── packages/
│   ├── foundry/          # Smart contracts (Solidity + Foundry)
│   ├── react-app/        # Frontend application (React + TypeScript)
│   ├── server/           # Backend API (NestJS + Prisma)
│   ├── hardhat/          # Legacy hardhat configs (contract ABIs)
│   └── ciserver/         # Deployment automation
└── PROJECT_README.md     # This file
```

## Smart Contracts (packages/foundry/)

### Overview

Solidity smart contracts deployed using Foundry framework.

**Main Contract: PX.sol**
- Upgradeable ERC721 (UUPS proxy pattern)
- Custom minting/burning with DOG20 token locks
- Reservation system for legacy migrations
- Access control and pausability
- Batch operations support

**Networks:**
- Base Mainnet (Chain ID: 8453)
- Base Sepolia Testnet (Chain ID: 84532)
- Local Anvil (Chain ID: 1337)

### Key Features

1. **Token Locking**: Mint pixels by locking DOG20 tokens
2. **Reservations**: Reserve pixels for specific addresses
3. **Claims**: Claim reserved pixels with merkle proofs
4. **Batch Operations**: Mint/burn multiple pixels in one transaction
5. **Upgradeable**: UUPS proxy for contract upgrades

### Setup

```bash
cd packages/foundry

# Install dependencies
forge install

# Compile contracts
forge build

# Run tests
forge test

# Deploy (requires .env with PRIVATE_KEY and RPC_URL)
./deploy.sh uups
```

### Environment Variables

Create `.env` in `packages/foundry/`:

```bash
PRIVATE_KEY=your_private_key_here
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
ETHERSCAN_API_KEY=your_basescan_api_key  # Optional, for verification
```

### Deployment Process

1. Deploy contracts with Foundry
2. Contracts write to `broadcast/` directory
3. Export ABIs to `hardhat_contracts.json`
4. Frontend and server read contract addresses/ABIs from this file

## Backend Server (packages/server/)

### Overview

NestJS-based API server that indexes blockchain events and provides data to the frontend.

**Key Responsibilities:**
- Listen to blockchain events (Transfer, etc.)
- Index pixel ownership to Postgres database
- Cache data in Redis for performance
- Resolve Basenames (Base's ENS equivalent)
- Provide REST API endpoints
- Generate social sharing images
- Handle support ticket submissions

### Tech Stack

- **Framework**: NestJS
- **Database**: PostgreSQL (via Prisma ORM)
- **Cache**: Redis
- **Blockchain**: ethers.js v6 + viem
- **Name Resolution**: Basenames (Base L2)

### Setup

```bash
cd packages/server

# Install dependencies
yarn install

# Start Docker services (Postgres + Redis)
docker-compose up -d postgres redis

# Setup database
yarn prisma:generate
yarn prisma:deploy

# Start development server
yarn start:dev
```

### Environment Variables

Create `.env` in `packages/server/`:

```bash
# Server
PORT=3000
APP_ENV=development

# Database
DATABASE_URL=postgresql://dogepixels:dogepixels@localhost:15432/dogepixels?schema=public
POSTGRES_USER=dogepixels
POSTGRES_PASSWORD=dogepixels
POSTGRES_DB=dogepixels

# Redis
REDIS_URL=redis://:redis_password@localhost:16379
REDIS_PORT=16379
REDIS_PASSWORD=redis_password

# Blockchain - Use Alchemy for both WebSocket and HTTP
CB_WS_ENDPOINT=wss://base-sepolia.g.alchemy.com/v2/YOUR_KEY
CB_HTTP_ENDPOINT=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
CB_PROJECT_ID=alchemy
CB_SECRET=not_used

# Alchemy (for Basename resolution)
ALCHEMY_KEY=YOUR_ALCHEMY_KEY

# Contract deployment block (start indexing from here)
CONTRACT_BLOCK_NUMBER_DEPLOYMENT=0

# Optional: Email, Discord, AWS for additional features
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SUPPORT_EMAIL_RECIPIENTS=your@email.com

# Optional: FreeMoney/Faucet feature (leave blank to disable)
DRIP_KEY=
```

### Key Endpoints

```
GET  /v1/config                    # Pixel ownership map with Basenames
GET  /v1/config/refresh            # Refresh recent transfers
POST /v1/transfers                 # Query transfer history
GET  /v1/px/owner/:tokenId         # Get owner of specific pixel
GET  /v1/ens/:address              # Resolve Basename for address
GET  /v1/px/metadata/:tokenId      # Get pixel metadata
GET  /v1/contract/addresses        # Get deployed contract addresses
POST /v1/support                   # Submit support ticket

# Migration / Claims
GET  /v1/migration/eligible/:address # Get claimable pixels for address
GET  /v1/migration/stats             # Snapshot statistics
POST /v1/migration/verify-burns      # Verify burns on-demand (frontend)
POST /v1/migration/verify-burns/sweep # Sweep all unconfirmed (X-Cron-Secret)
```

### Database Schema

**PixelTransfers**: Complete transfer history
- from, to, tokenId, blockNumber, blockCreatedAt
- Unique constraint on blockHash:txHash:logIndex

**SupportTicket**: User support requests
- email, message, status, social handles

### Architecture Notes

**Event Processing Flow:**
1. WebSocket connection to Base RPC (used for contract calls)
2. Poll for PX contract Transfer events every 5 minutes
3. Parse events → emit internal events
4. PixelTransferService handles each event
5. Upsert to Postgres via Prisma
6. Frontend calls `GET /v1/config/refresh` after user actions for immediate sync
7. Cache Basename lookups in Redis
8. Serve aggregated data via REST API

**Name Resolution:**
- ENS lookup disabled (Ethereum L1)
- Basename resolution enabled (Base L2)
- Uses Base L2 resolver contract directly
- No CCIP-Read required

## Frontend Application (packages/react-app/)

### Overview

React-based web application for interacting with pixel NFTs.

**Key Features:**
- Interactive 1000x1000 pixel viewer/explorer
- Wallet connection (RainbowKit + Wagmi)
- Mint/burn pixel operations
- Claim reserved pixels (merkle proof verification)
- Leaderboard of top pixel holders
- Real-time ownership updates
- Mobile-responsive design

### Tech Stack

- **Framework**: React 18 + TypeScript
- **State Management**: MobX
- **Wallet**: RainbowKit + Wagmi v2
- **UI**: Chakra UI
- **Blockchain**: ethers.js v5 + viem
- **Build**: Create React App (customized)

### Setup

```bash
cd packages/react-app

# Install dependencies
yarn install

# Start development server
yarn start
```

### Environment Variables

Create `.env.local` in `packages/react-app/`:

**For Local Development (Anvil):**
```bash
# Chain Configuration
REACT_APP_CHAIN_ID=1337
REACT_APP_NETWORK_NAME=anvil-local
REACT_APP_RPC_URL=http://localhost:8545

# Server
REACT_APP_SERVER_URL=http://localhost:3000

# Services
REACT_APP_ALCHEMY_ID=your_alchemy_key
REACT_APP_WALLETCONNECT_PROJECTID=your_walletconnect_project_id

# Environment
NODE_ENV=development
REACT_APP_DOG_ENV=development
```

**For Base Sepolia (Testnet):**
```bash
REACT_APP_CHAIN_ID=84532
REACT_APP_NETWORK_NAME=base-sepolia
REACT_APP_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
REACT_APP_SERVER_URL=https://your-server.herokuapp.com
REACT_APP_ALCHEMY_ID=YOUR_KEY
REACT_APP_WALLETCONNECT_PROJECTID=YOUR_PROJECT_ID
NODE_ENV=development
REACT_APP_DOG_ENV=development
```

**For Base Mainnet (Production):**
```bash
REACT_APP_CHAIN_ID=8453
REACT_APP_NETWORK_NAME=base-mainnet
REACT_APP_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
REACT_APP_SERVER_URL=https://your-production-server.herokuapp.com
REACT_APP_ALCHEMY_ID=YOUR_KEY
REACT_APP_WALLETCONNECT_PROJECTID=YOUR_PROJECT_ID
REACT_APP_SENTRY_DSN=YOUR_SENTRY_DSN
NODE_ENV=production
REACT_APP_DOG_ENV=production
```

### Configuration System

The app uses an environment-driven configuration system:

1. **Contract Addresses**: Auto-loaded from `hardhat_contracts.json`
2. **Chain Config**: Driven by `REACT_APP_CHAIN_ID` environment variable
3. **Network Switching**: Change `.env.local` and restart app
4. **No Hardcoded Values**: All network configs come from environment

**Configuration Flow:**
```
.env.local → config.ts → index.tsx (chain setup) → App components
```

### Key Components

**Viewer/Explorer**: Interactive pixel canvas
- Zoom/pan controls
- Pixel selection
- Owner information display
- Mint/burn actions

**Leaderboard**: Top pixel holders
- Sorted by pixel count
- Displays Basenames
- Filter and search
- Activity feed

**Claim Dialog**: Reserved pixel claiming
- Merkle proof generation
- Batch claim support
- Transaction confirmation

### Build and Deploy

```bash
# Production build
yarn build

# Analyze bundle size
yarn analyze

# Deploy to Vercel
# (Vercel automatically builds on git push)
```

### Contract Integration

The frontend reads contract addresses from `src/contracts/hardhat_contracts.json`:

```javascript
// Auto-generated during prestart
deployedContracts[chainId][networkName].contracts.PX.address
deployedContracts[chainId][networkName].contracts.PX.abi
```

This file is generated by `scripts/create_contracts.js` which copies from `packages/hardhat/hardhat_contracts.json`.

## Development Workflow

### Full Local Stack

**Terminal 1 - Blockchain:**
```bash
cd packages/foundry
anvil --port 8545
```

**Terminal 2 - Deploy Contracts:**
```bash
cd packages/foundry
forge script script/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast
```

**Terminal 3 - Backend:**
```bash
cd packages/server
docker-compose up -d postgres redis
yarn prisma:generate && yarn prisma:deploy
yarn start:dev
```

**Terminal 4 - Frontend:**
```bash
cd packages/react-app
yarn start
```

### Testing Smart Contracts

```bash
cd packages/foundry

# Run all tests
forge test

# Run specific test file
forge test --match-path test/PX.t.sol

# Run with verbosity
forge test -vvv

# Run with gas reports
forge test --gas-report
```

### Testing Server

```bash
cd packages/server

# Unit tests
yarn test

# E2E tests
yarn test:e2e

# Test coverage
yarn test:cov
```

### Testing Frontend

```bash
cd packages/react-app

# Run tests
yarn test

# Run with coverage
yarn test --coverage
```

## Deployment

### Smart Contracts

**Base Sepolia (Testnet):**
```bash
cd packages/foundry
# Set .env with Base Sepolia RPC and private key
./deploy.sh uups
```

**Base Mainnet (Production):**
```bash
cd packages/foundry
# Set .env with Base Mainnet RPC and private key
# Double-check all parameters
./deploy.sh uups
```

After deployment:
1. Copy deployed addresses to `hardhat_contracts.json`
2. Commit and push updated JSON file
3. Redeploy frontend and server

### Backend Server (Heroku)

```bash
cd packages/server

# Login to Heroku
heroku login

# Create app (first time only)
heroku create your-app-name

# Add Postgres addon
heroku addons:create heroku-postgresql:mini

# Add Redis addon
heroku addons:create heroku-redis:mini

# Set environment variables
heroku config:set APP_ENV=production
heroku config:set CB_WS_ENDPOINT=wss://base-mainnet.g.alchemy.com/v2/YOUR_KEY
heroku config:set CB_HTTP_ENDPOINT=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
heroku config:set ALCHEMY_KEY=YOUR_KEY
# ... set all required env vars

# Deploy
git push heroku main

# Run migrations
heroku run yarn prisma:deploy

# View logs
heroku logs --tail
```

### Frontend (Vercel)

1. Connect GitHub repo to Vercel
2. Set build settings:
   - Build Command: `cd packages/react-app && yarn build`
   - Output Directory: `packages/react-app/build`
3. Add environment variables in Vercel dashboard
4. Deploy automatically on git push

## Environment Variable Reference

### Required for All Environments

**Foundry:**
- `PRIVATE_KEY`: Deployer wallet private key
- `RPC_URL`: Blockchain RPC endpoint

**Server:**
- `APP_ENV`: development | staging | production
- `DATABASE_URL`: Postgres connection string
- `REDIS_URL`: Redis connection string
- `CB_WS_ENDPOINT`: Blockchain WebSocket URL
- `CB_HTTP_ENDPOINT`: Blockchain HTTP URL
- `ALCHEMY_KEY`: Alchemy API key (for Basenames)
- `CONTRACT_BLOCK_NUMBER_DEPLOYMENT`: Start block for indexing

**Frontend:**
- `REACT_APP_CHAIN_ID`: Target blockchain chain ID
- `REACT_APP_NETWORK_NAME`: Network name matching contracts
- `REACT_APP_SERVER_URL`: Backend API URL
- `REACT_APP_ALCHEMY_ID`: Alchemy API key
- `REACT_APP_WALLETCONNECT_PROJECTID`: WalletConnect project ID

### Optional Production Features

**Server:**
- `SMTP_*`: Email configuration for support tickets
- `DISCORD_SECRET`: Discord webhook for notifications
- `AWS_*`: S3 configuration for image storage
- `SENTRY_DNS`: Error tracking
- `DRIP_KEY`: Private key for freemoney/faucet feature (leave blank to disable)
- `BURN_VERIFICATION_KEY`: Private key for admin wallet that sets burn flags on V3 contract
- `INFURA_KEY`: Infura API key for V1/V2 burn verification (Ethereum + Base)
- `CRON_SECRET`: Protects the `POST /v1/migration/verify-burns/sweep` endpoint

**Frontend:**
- `REACT_APP_SENTRY_DSN`: Error tracking

### FreeMoney Feature (Optional)

The freemoney feature allows users to claim free DOG tokens once per address. This feature is **disabled by default** and can be enabled by providing a private key for the drip wallet.

**To Enable:**
1. Set `DRIP_KEY` environment variable in server with a wallet private key
2. Ensure the wallet has sufficient DOG tokens and ETH for gas
3. Feature automatically enables when valid key is detected

**To Disable (Default):**
1. Leave `DRIP_KEY` blank or unset
2. Server will start normally without freemoney functionality
3. API endpoints return "feature disabled" errors if accessed

**Frontend Route:**
- Path: `/freemoney`
- Hidden from navigation (`showOnDesktop: false`, `showOnMobile: false`)
- Can be accessed directly when feature is enabled server-side

**API Endpoints (when enabled):**
- `POST /v1/freemoney` - Claim free tokens
- `GET /v1/freemoney/balance` - Check drip wallet balance
- `GET /v1/freemoney/txs/:address` - Get user's claim history
- `GET /v1/freemoney/txs` - Get all claims

## Troubleshooting

### Frontend won't connect to wallet
- Check `REACT_APP_CHAIN_ID` matches your target network
- Verify wallet is on correct network
- Check RainbowKit configuration in `index.tsx`

### Server can't connect to blockchain
- Verify `CB_WS_ENDPOINT` is a valid WebSocket URL
- Check Alchemy/Infura API key is valid
- Ensure firewall allows WebSocket connections

### Contract addresses not found
- Verify `hardhat_contracts.json` exists in `packages/hardhat/`
- Check `REACT_APP_NETWORK_NAME` matches JSON structure
- Run `yarn create-contracts` in react-app to refresh

### Database connection errors
- Verify Postgres is running: `docker ps`
- Check `DATABASE_URL` connection string
- Run migrations: `yarn prisma:deploy`

### Redis connection errors
- Verify Redis is running: `docker ps`
- Check `REDIS_URL` and `REDIS_PASSWORD`
- Test connection: `redis-cli -a your_password ping`

### Basename resolution not working
- Verify `ALCHEMY_KEY` is set in server
- Check server is connecting to Base (not Ethereum)
- Only works on Base mainnet (not testnet)

## Contributing

### Code Style

- **Solidity**: Follow Solidity style guide
- **TypeScript**: Prettier + ESLint configured
- **Commits**: Descriptive commit messages

### Pull Request Process

1. Create feature branch from `main`
2. Make changes with tests
3. Run linters and tests
4. Submit PR with description
5. Wait for review

## Support

For questions or issues:
- Open GitHub issue
- Use in-app support form
- Contact development team

## License

MIT License - see LICENSE file for details

## Additional Resources

- [Base Network Docs](https://docs.base.org/)
- [Foundry Book](https://book.getfoundry.sh/)
- [NestJS Documentation](https://docs.nestjs.com/)
- [Wagmi Documentation](https://wagmi.sh/)
- [Basenames Documentation](https://www.base.org/names)
