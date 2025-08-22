# Habitat Environment Setup Guide

This guide covers setting up and managing different environments (development, staging, production) for the Habitat trading application.

## 🏗️ Architecture Overview

The application supports three environments:
- **Development**: Local development with local databases
- **Staging**: Pre-production testing with cloud services
- **Production**: Live application with production cloud services

## 🚀 Quick Start

### 1. Development Environment Setup

```bash
# Setup development configuration
npm run setup:dev

# Start backend in development mode
npm run backend:dev

# Start frontend in development mode (in another terminal)
npm run dev
```

### 2. Staging Environment Setup

```bash
# Setup staging configuration
npm run setup:staging

# Start backend in staging mode
npm run backend:staging

# Start frontend in staging mode
npm run dev:staging
```

### 3. Production Environment Setup

```bash
# Setup production configuration
npm run setup:prod

# Build for production
npm run build:prod

# Start backend in production mode
npm run backend:prod
```

## 📁 Environment Configuration Files

### Frontend Configuration
- `src/config/environment.ts` - Environment detection and configuration
- `public/config.json` - Runtime configuration (auto-generated)
- `scripts/setup-config.js` - Configuration generation script

### Backend Configuration
- `backend/src/config/environment.ts` - Backend environment configuration
- `backend/.env.development` - Development environment variables
- `backend/.env.staging` - Staging environment variables
- `backend/.env.production` - Production environment variables

## 🔧 Configuration Scripts

### Frontend Scripts
```bash
npm run config:dev      # Setup development configuration
npm run config:staging  # Setup staging configuration
npm run config:prod     # Setup production configuration
```

### Backend Scripts
```bash
npm run env:dev         # Switch to development environment
npm run env:staging     # Switch to staging environment
npm run env:prod        # Switch to production environment
```

### Build Scripts
```bash
npm run build:dev       # Build for development
npm run build:staging   # Build for staging
npm run build:prod      # Build for production
```

## 🌍 Environment Variables

### Required Environment Variables

#### Database
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string

#### External Services
- `HELIUS_API_KEY` - Helius API key for Solana
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key

#### Security
- `JWT_SECRET` - JWT signing secret

#### Configuration
- `NODE_ENV` - Node.js environment
- `APP_ENV` - Application environment
- `PORT` - Server port
- `LOG_LEVEL` - Logging level
- `CORS_ORIGINS` - Allowed CORS origins

### Environment-Specific Values

#### Development
```bash
NODE_ENV=development
APP_ENV=development
DATABASE_URL=postgresql://localhost:5432/habitat_dev
REDIS_URL=redis://localhost:6379
LOG_LEVEL=debug
```

#### Staging
```bash
NODE_ENV=staging
APP_ENV=staging
DATABASE_URL=your_staging_supabase_url
REDIS_URL=your_staging_upstash_url
LOG_LEVEL=info
```

#### Production
```bash
NODE_ENV=production
APP_ENV=production
DATABASE_URL=your_production_supabase_url
REDIS_URL=your_production_upstash_url
LOG_LEVEL=warn
```

## 🐳 Docker Development

### Start Local Services
```bash
cd backend
docker-compose --profile development up postgres-dev redis-dev
```

### Start Backend API
```bash
cd backend
docker-compose --profile development up api-dev
```

### Start Backend Daemon
```bash
cd backend
docker-compose --profile development up daemon-dev
```

## 📊 Database Setup

### Local Development
```bash
# Start PostgreSQL and Redis
docker-compose --profile development up postgres-dev redis-dev

# Initialize database schema
cd backend
npm run run-schema

# Initialize tokens
npm run initialize-tokens
```

### Cloud Deployment
1. **Supabase**: Create project and get connection details
2. **Upstash**: Create Redis database and get connection details
3. **Update environment files** with cloud URLs
4. **Run migrations** on cloud database

## 🔄 Environment Switching

### Frontend Environment Detection
The frontend automatically detects the environment based on:
1. `import.meta.env.MODE` (Vite build mode)
2. `import.meta.env.VITE_ENV` (Custom environment variable)
3. Runtime `config.json` file

### Backend Environment Detection
The backend detects the environment based on:
1. `NODE_ENV` environment variable
2. `APP_ENV` environment variable
3. Fallback to development if neither is set

## 🚀 Deployment Workflow

### 1. Development → Staging
```bash
# Test staging configuration locally
npm run dev:staging

# Build for staging
npm run build:staging

# Deploy to staging Vercel
# Deploy backend to staging Railway
```

### 2. Staging → Production
```bash
# Test production configuration locally
npm run dev:prod

# Build for production
npm run build:prod

# Deploy to production Vercel
# Deploy backend to production Railway
```

## 🔍 Troubleshooting

### Common Issues

#### Frontend Configuration Not Loading
- Check `public/config.json` exists
- Verify environment mode in Vite
- Check browser console for errors

#### Backend Environment Not Detected
- Verify `.env` file exists
- Check `NODE_ENV` and `APP_ENV` variables
- Restart backend after environment changes

#### Database Connection Issues
- Verify `DATABASE_URL` is correct
- Check SSL configuration for cloud databases
- Ensure database is accessible from backend

#### CORS Issues
- Verify `CORS_ORIGINS` includes frontend URL
- Check environment-specific CORS configuration
- Restart backend after CORS changes

### Debug Commands
```bash
# Check environment configuration
npm run config:dev && cat public/config.json

# Check backend environment
cd backend && npm run env:dev && npm run start:dev

# Verify database connection
cd backend && npm run debug-db-connection
```

## 📚 Additional Resources

- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)
- [Node.js Environment Variables](https://nodejs.org/api/process.html#processenv)
- [Docker Compose Profiles](https://docs.docker.com/compose/profiles/)
- [Supabase Documentation](https://supabase.com/docs)
- [Upstash Documentation](https://docs.upstash.com/)
- [Railway Documentation](https://docs.railway.app/)
- [Vercel Documentation](https://vercel.com/docs)

## 🤝 Contributing

When adding new environment-specific configurations:
1. Update `src/config/environment.ts`
2. Update `backend/src/config/environment.ts`
3. Update `scripts/setup-config.js`
4. Update this documentation
5. Test in all environments
