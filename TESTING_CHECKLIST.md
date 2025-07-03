# Habitat2 Testing Implementation Checklist

> **🛡️ Database Safety**: All testing will use a separate test database. Production data remains untouched.

## 📋 Phase 1: Foundation Testing Infrastructure

### **Agent 1: Test Framework Setup**

#### 1.1 Core Dependencies Installation
- [ ] Install testing framework dependencies
  ```bash
  npm install --save-dev jest @types/jest jest-environment-jsdom
  npm install --save-dev @testing-library/react @testing-library/jest-dom
  npm install --save-dev @testing-library/user-event
  npm install --save-dev vitest @vitest/ui
  ```
- [ ] Install E2E testing dependencies
  ```bash
  npm install --save-dev @playwright/test
  npx playwright install
  ```
- [ ] Verify installation: Run `npm test` (should show no tests found)
- [ ] **Verification**: Screenshot of successful dependency installation

#### 1.2 Test Configuration Files
- [ ] Create `jest.config.js` or `vitest.config.ts`
- [ ] Create `playwright.config.ts` for E2E tests
- [ ] Update `package.json` with test scripts:
  ```json
  {
    "scripts": {
      "test": "vitest",
      "test:unit": "vitest run unit",
      "test:integration": "vitest run integration",
      "test:e2e": "playwright test",
      "test:watch": "vitest watch",
      "test:coverage": "vitest run --coverage"
    }
  }
  ```
- [ ] **Verification**: Run `npm run test` shows configured test runner

#### 1.3 Test Directory Structure Creation
- [ ] Create `tests/` directory in project root
- [ ] Create subdirectories:
  ```
  tests/
  ├── __mocks__/
  │   ├── solana/
  │   ├── wallet-adapter/
  │   └── jupiter/
  ├── unit/
  │   ├── services/
  │   ├── utils/
  │   └── workers/
  ├── integration/
  │   ├── api/
  │   ├── database/
  │   └── auth/
  ├── e2e/
  │   ├── trading-flows/
  │   ├── wallet-management/
  │   └── strategy-execution/
  └── helpers/
      ├── test-data.ts
      ├── db-setup.ts
      └── mock-server.ts
  ```
- [ ] **Verification**: Directory structure exists and matches above

#### 1.4 Basic Mock Infrastructure
- [ ] Create `tests/__mocks__/solana/connection.mock.ts`
- [ ] Create `tests/__mocks__/wallet-adapter/wallet.mock.ts`
- [ ] Create `tests/__mocks__/jupiter/api.mock.ts`
- [ ] Create `tests/helpers/test-utils.tsx` for React testing utilities
- [ ] **Verification**: Mock files exist and export proper interfaces

#### 1.5 First Smoke Test
- [ ] Create `tests/unit/smoke.test.ts` with basic test
- [ ] Run `npm run test` - should pass 1 test
- [ ] **Verification**: Test runs and passes with green output

---

## 📋 Phase 2: Database Testing Setup

### **Agent 2: Test Database Configuration**

#### 2.1 Test Database Environment
- [ ] Create separate test database (PostgreSQL)
- [ ] Create `.env.test` file with test database credentials:
  ```env
  TEST_DATABASE_URL=postgresql://username:password@localhost:5432/habitat2_test
  NODE_ENV=test
  ```
- [ ] Update backend to use test database when `NODE_ENV=test`
- [ ] **Verification**: Connect to test database successfully without affecting production

#### 2.2 Database Test Utilities
- [ ] Create `tests/helpers/db-setup.ts`:
  ```typescript
  export class TestDatabaseManager {
    async setupTestDatabase(): Promise<Pool>;
    async seedTestData(): Promise<void>;
    async cleanupTestData(): Promise<void>;
    async resetDatabase(): Promise<void>;
  }
  ```
- [ ] Create `tests/helpers/test-data-factory.ts` for generating test data
- [ ] Create database migration scripts for test environment
- [ ] **Verification**: Can create, seed, and cleanup test database

#### 2.3 Test Data Seeds
- [ ] Create test user accounts
- [ ] Create test trading wallets
- [ ] Create test strategies (all types)
- [ ] Create test transaction data
- [ ] **Verification**: Test database contains realistic test data

#### 2.4 Database Integration Test Framework
- [ ] Create `tests/integration/database/connection.test.ts`
- [ ] Create `tests/integration/database/strategies.test.ts`
- [ ] Create `tests/integration/database/wallets.test.ts`
- [ ] Run database tests: `npm run test:integration`
- [ ] **Verification**: Database integration tests pass

---

## 📋 Phase 3: Backend API Testing

### **Agent 2: API Layer Testing**

#### 3.1 API Test Setup
- [ ] Create test server setup in `tests/helpers/test-server.ts`
- [ ] Create API client for testing in `tests/helpers/api-client.ts`
- [ ] Setup test authentication tokens
- [ ] **Verification**: Test server starts and accepts requests

#### 3.2 Strategy API Tests
- [ ] Create `tests/integration/api/strategies.test.ts`:
  - [ ] Test `GET /api/strategies` - returns user strategies only
  - [ ] Test `POST /api/strategies` - creates strategy successfully
  - [ ] Test `PUT /api/strategies/:id` - updates strategy
  - [ ] Test `DELETE /api/strategies/:id` - deletes strategy
  - [ ] Test authentication requirements
  - [ ] Test cross-user data isolation
- [ ] **Verification**: All strategy API tests pass

#### 3.3 Wallet API Tests
- [ ] Create `tests/integration/api/wallets.test.ts`:
  - [ ] Test `GET /api/wallets` - returns user wallets only
  - [ ] Test `POST /api/wallets` - creates trading wallet
  - [ ] Test `GET /api/wallets/:id/balances` - returns wallet balances
  - [ ] Test `POST /api/wallets/:id/update-balances` - updates balances
  - [ ] Test wallet limit enforcement
- [ ] **Verification**: All wallet API tests pass

#### 3.4 Authentication API Tests
- [ ] Create `tests/integration/api/auth.test.ts`:
  - [ ] Test `POST /api/auth/signin` - creates JWT token
  - [ ] Test `POST /api/auth/signout` - invalidates token
  - [ ] Test JWT token validation
  - [ ] Test token expiration handling
  - [ ] Test wallet switching security
- [ ] **Verification**: All authentication tests pass

#### 3.5 Real-time API Tests
- [ ] Create `tests/integration/api/realtime.test.ts`:
  - [ ] Test WebSocket connections
  - [ ] Test price feed subscriptions
  - [ ] Test balance update notifications
  - [ ] Test connection recovery
- [ ] **Verification**: Real-time API tests pass

---

## 📋 Phase 4: Business Logic Testing

### **Agent 4: Core Trading Logic Tests**

#### 4.1 Worker Logic Tests
- [ ] Create `tests/unit/workers/wallet-monitor.test.ts`:
  - [ ] Test transaction mirroring logic
  - [ ] Test percentage allocation calculations
  - [ ] Test error handling for failed transactions
  - [ ] Test profit tracking updates
- [ ] Create `tests/unit/workers/price-monitor.test.ts`:
  - [ ] Test price trigger conditions
  - [ ] Test sell order execution
  - [ ] Test duplicate order prevention
  - [ ] Test price feed disconnection handling
- [ ] Create `tests/unit/workers/vault.test.ts`:
  - [ ] Test vault allocation calculations
  - [ ] Test rebalancing logic
  - [ ] Test vault security measures
- [ ] Create `tests/unit/workers/levels.test.ts`:
  - [ ] Test level execution order
  - [ ] Test price level triggers
  - [ ] Test duplicate level prevention
- [ ] **Verification**: All worker tests pass with 90%+ coverage

#### 4.2 Service Layer Tests
- [ ] Create `tests/unit/services/strategy.test.ts`:
  - [ ] Test strategy creation validation
  - [ ] Test strategy execution coordination
  - [ ] Test strategy state management
- [ ] Create `tests/unit/services/wallet-balance.test.ts`:
  - [ ] Test balance fetching accuracy
  - [ ] Test balance caching logic
  - [ ] Test balance update triggers
- [ ] Create `tests/unit/services/price-feed.test.ts`:
  - [ ] Test price feed subscription management
  - [ ] Test price data validation
  - [ ] Test feed reconnection logic
- [ ] **Verification**: Service tests pass with high coverage

#### 4.3 Trading Algorithm Tests
- [ ] Create `tests/unit/algorithms/profit-tracking.test.ts`:
  - [ ] Test profit calculation accuracy
  - [ ] Test percentage change calculations
  - [ ] Test transaction history tracking
- [ ] Create `tests/unit/algorithms/swap-execution.test.ts`:
  - [ ] Test Jupiter integration logic
  - [ ] Test slippage handling
  - [ ] Test transaction retry logic
- [ ] **Verification**: Algorithm tests validate trading accuracy

---

## 📋 Phase 5: Frontend Component Testing

### **Agent 3: React Component Tests**

#### 5.1 Core Component Tests
- [ ] Create `tests/unit/components/TradingWalletSelector.test.tsx`:
  - [ ] Test wallet list rendering
  - [ ] Test wallet selection handling
  - [ ] Test balance display
  - [ ] Test loading and error states
- [ ] Create `tests/unit/components/StrategyConfiguration.test.tsx`:
  - [ ] Test form validation
  - [ ] Test strategy parameter input
  - [ ] Test preview functionality
- [ ] Create `tests/unit/components/WalletButton.test.tsx`:
  - [ ] Test connection states
  - [ ] Test wallet switching
  - [ ] Test disconnect functionality
- [ ] **Verification**: Component tests pass and render correctly

#### 5.2 Context and State Tests
- [ ] Create `tests/unit/contexts/PortfolioContext.test.tsx`:
  - [ ] Test portfolio value calculations
  - [ ] Test balance updates
  - [ ] Test wallet disconnection handling
- [ ] Create `tests/unit/hooks/useWalletBalance.test.ts`:
  - [ ] Test balance fetching logic
  - [ ] Test automatic refresh
  - [ ] Test error handling
- [ ] **Verification**: Context and hooks work correctly

#### 5.3 Integration Component Tests
- [ ] Create `tests/integration/components/Dashboard.test.tsx`:
  - [ ] Test full dashboard rendering with data
  - [ ] Test strategy creation flow
  - [ ] Test wallet management flow
- [ ] Create `tests/integration/components/WhaleTracker.test.tsx`:
  - [ ] Test whale tracker data loading
  - [ ] Test real-time updates
- [ ] **Verification**: Integration components work with real data

---

## 📋 Phase 6: Security Testing

### **Agent 5: Security and Validation Tests**

#### 6.1 Authentication Security Tests
- [ ] Create `tests/integration/security/auth.test.ts`:
  - [ ] Test JWT token validation
  - [ ] Test token expiration handling
  - [ ] Test invalid token rejection
  - [ ] Test wallet switching security
- [ ] **Verification**: Authentication security is robust

#### 6.2 Data Isolation Tests
- [ ] Create `tests/integration/security/data-isolation.test.ts`:
  - [ ] Test cross-user data prevention
  - [ ] Test wallet ownership validation
  - [ ] Test strategy access control
- [ ] **Verification**: Users can only access their own data

#### 6.3 Input Validation Tests
- [ ] Create `tests/unit/security/validation.test.ts`:
  - [ ] Test wallet address validation
  - [ ] Test strategy parameter validation
  - [ ] Test SQL injection prevention
  - [ ] Test XSS prevention
- [ ] **Verification**: All inputs are properly validated

#### 6.4 Private Key Security Tests
- [ ] Create `tests/unit/security/encryption.test.ts`:
  - [ ] Test private key encryption
  - [ ] Test secure storage methods
  - [ ] Test key access controls
- [ ] **Verification**: Private keys are never exposed

---

## 📋 Phase 7: Performance Testing

### **Agent 6: Performance and Load Tests**

#### 7.1 Performance Benchmarks
- [ ] Create `tests/performance/api-response-times.test.ts`:
  - [ ] Test API response times < 500ms
  - [ ] Test database query performance
  - [ ] Test concurrent request handling
- [ ] **Verification**: Performance meets SLA requirements

#### 7.2 Load Testing
- [ ] Create `tests/performance/load.test.ts`:
  - [ ] Test 50+ concurrent users
  - [ ] Test strategy execution under load
  - [ ] Test WebSocket connection limits
- [ ] **Verification**: System handles expected load

#### 7.3 Memory and Resource Tests
- [ ] Create `tests/performance/memory.test.ts`:
  - [ ] Test for memory leaks
  - [ ] Test resource cleanup
  - [ ] Test long-running operations
- [ ] **Verification**: No resource leaks detected

---

## 📋 Phase 8: End-to-End Testing

### **Agent 1 + 3: E2E User Flows**

#### 8.1 Critical User Journey Tests
- [ ] Create `tests/e2e/wallet-creation.spec.ts`:
  - [ ] Test complete wallet creation flow
  - [ ] Test wallet naming and management
  - [ ] Test wallet deletion flow
- [ ] Create `tests/e2e/strategy-lifecycle.spec.ts`:
  - [ ] Test strategy creation end-to-end
  - [ ] Test strategy activation/deactivation
  - [ ] Test strategy execution monitoring
- [ ] Create `tests/e2e/multi-wallet.spec.ts`:
  - [ ] Test switching between main wallets
  - [ ] Test data isolation between users
  - [ ] Test concurrent operations
- [ ] **Verification**: All critical user paths work end-to-end

#### 8.2 Browser Compatibility Tests
- [ ] Test in Chrome
- [ ] Test in Firefox
- [ ] Test in Safari
- [ ] Test in Edge
- [ ] **Verification**: App works across browsers

#### 8.3 Mobile Responsiveness Tests
- [ ] Test mobile wallet creation
- [ ] Test mobile strategy management
- [ ] Test mobile navigation
- [ ] **Verification**: Mobile experience is functional

---

## 📋 Phase 9: CI/CD Pipeline

### **Agent 1: Automation Setup**

#### 9.1 GitHub Actions Configuration
- [ ] Create `.github/workflows/test.yml`:
  ```yaml
  name: Test Suite
  on: [push, pull_request]
  jobs:
    unit-tests:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v3
        - uses: actions/setup-node@v3
        - run: npm install
        - run: npm run test:unit
    
    integration-tests:
      runs-on: ubuntu-latest
      services:
        postgres:
          image: postgres:13
      steps:
        - uses: actions/checkout@v3
        - uses: actions/setup-node@v3
        - run: npm install
        - run: npm run test:integration
    
    e2e-tests:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v3
        - uses: actions/setup-node@v3
        - run: npm install
        - run: npm run test:e2e
  ```
- [ ] **Verification**: GitHub Actions run successfully on push

#### 9.2 Quality Gates
- [ ] Configure code coverage requirements (90% unit, 80% integration)
- [ ] Set up automatic PR checks
- [ ] Configure deployment blocking on test failures
- [ ] **Verification**: Quality gates prevent bad code from merging

#### 9.3 Test Reporting
- [ ] Setup test result reporting
- [ ] Configure coverage reporting
- [ ] Setup performance regression alerts
- [ ] **Verification**: Clear test reports and alerts

---

## 📋 Final Verification Checklist

### **Overall System Health**
- [ ] **All unit tests pass**: `npm run test:unit` ✅
- [ ] **All integration tests pass**: `npm run test:integration` ✅
- [ ] **All E2E tests pass**: `npm run test:e2e` ✅
- [ ] **Code coverage meets targets**: Unit 90%+, Integration 80%+ ✅
- [ ] **Performance tests pass**: Response times < 500ms ✅
- [ ] **Security tests pass**: No vulnerabilities detected ✅
- [ ] **CI/CD pipeline working**: All checks pass on GitHub ✅

### **Production Safety Verification**
- [ ] **Production database untouched**: Verify no test data in production ✅
- [ ] **Test database isolated**: Test runs only affect test DB ✅
- [ ] **No production API calls**: Tests use mocks/test environment ✅
- [ ] **Environment variables correct**: Production config unchanged ✅

### **Development Workflow Ready**
- [ ] **Fast test feedback**: Test suite completes in < 10 minutes ✅
- [ ] **Easy test creation**: Templates and helpers available ✅
- [ ] **Clear test documentation**: README with testing instructions ✅
- [ ] **Developer confidence**: Team can develop without manual UI testing ✅

---

## 🎯 Success Criteria Met

When all items above are checked:

✅ **Zero manual UI testing required** for new feature development  
✅ **Comprehensive test coverage** protects against regressions  
✅ **Fast feedback loop** enables rapid development iteration  
✅ **Production database safety** guaranteed throughout process  
✅ **CI/CD pipeline** prevents buggy code from reaching production  
✅ **Developer confidence** in making changes and deploying features  

---

## 📝 Progress Tracking

**Started**: [DATE]  
**Current Phase**: ___________  
**Estimated Completion**: [DATE + 8 weeks]  
**Completion Date**: ___________  

**Total Progress**: ___/[TOTAL_ITEMS] items completed (___%)

---

> **💡 Pro Tip**: Check off items as you complete them and add verification screenshots/logs to ensure each step was properly implemented!