# 🔍 Backend Connection Test

## Issue: 404 Error on Marketplace API

The marketplace is getting a 404 error when trying to access `/api/shop/strategies`. This suggests either:

1. **Backend server is not running**
2. **Backend is running the wrong entry point** (index.ts instead of server.ts)
3. **Routes are not properly registered**

## ✅ **Quick Tests to Run**

### 1. Check if Backend is Running
Open a new terminal and run:
```bash
curl http://localhost:3001/health
```

**Expected Result**: `{"status":"ok","redis":"not connected"}` or similar
**If you get**: Connection refused or timeout = Backend is not running

### 2. Test a Known Working Endpoint
```bash
curl http://localhost:3001/api/v1/health
```

**Expected Result**: Health check response
**If you get**: 404 HTML = Backend is running wrong file

### 3. Check Strategy Routes Specifically
```bash
curl -H "Authorization: Bearer your-token-here" http://localhost:3001/api/shop/strategies
```

## 🚀 **How to Start Backend Correctly**

### Option 1: Development Mode (Recommended)
```bash
cd backend
npm run dev
```

This runs: `nodemon --exec ts-node src/server.ts`

### Option 2: Production Mode
```bash
cd backend
npm run build
npm start
```

### Option 3: Direct Run
```bash
cd backend
npx ts-node src/server.ts
```

## 🔍 **What to Look For in Console**

When you start the backend with `npm run dev`, you should see:
```
🚀 Server is running on port 3001
📍 Health check: http://localhost:3001/health
🔗 API base: http://localhost:3001/api/v1
🔌 WebSocket: ws://localhost:3001/api/v1/ws
```

If you see this, the marketplace routes should be available at:
- `http://localhost:3001/api/shop/strategies`
- `http://localhost:3001/api/shop/categories`
- `http://localhost:3001/api/shop/tags`

## 🎯 **Next Steps**

1. **Stop any running backend processes**
2. **Run `cd backend && npm run dev`**
3. **Verify health endpoint works**
4. **Try marketplace again**

If you're still getting 404 errors after confirming the backend is running correctly, there might be an issue with the route registration that we need to debug further.