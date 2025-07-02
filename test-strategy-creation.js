// Test script to verify the strategy duplication fix
// This script tests both scenarios:
// 1. Creating identical strategies (should override)
// 2. Creating different strategies of same type (should allow)

import axios from 'axios';

const API_BASE = 'http://localhost:3001/api/v1';

// Test data
const testTradingWallet = {
  id: 145, // From your error log
  wallet_pubkey: "8ChMBF2NzQnuefhCk9xsQWcMLSC2PPibUi66Ha5YGgqe"
};

const testStrategy1 = {
  trading_wallet_id: testTradingWallet.id,
  strategy_type: "wallet-monitor",
  config: {
    walletAddress: "7EmsTTR5S1NuaJ6hwwr9vAY85CbEjoT8oFSTNuJCMV5N",
    percentage: 11
  },
  current_wallet_pubkey: testTradingWallet.wallet_pubkey
};

const testStrategy2 = {
  trading_wallet_id: testTradingWallet.id,
  strategy_type: "wallet-monitor", 
  config: {
    walletAddress: "7EmsTTR5S1NuaJ6hwwr9vAY85CbEjoT8oFSTNuJCMV5N",
    percentage: 15 // Different percentage
  },
  current_wallet_pubkey: testTradingWallet.wallet_pubkey
};

async function testStrategyCreation() {
  try {
    console.log('🧪 Testing Strategy Creation Logic...\n');

    // You'll need to get an auth token first
    console.log('⚠️  Note: You need to authenticate first and get a token');
    console.log('⚠️  This is just a template - update with real auth token\n');

    const authHeaders = {
      'Authorization': 'Bearer YOUR_AUTH_TOKEN_HERE',
      'Content-Type': 'application/json'
    };

    console.log('📝 Test 1: Creating first strategy...');
    const response1 = await axios.post(`${API_BASE}/strategies`, testStrategy1, {
      headers: authHeaders
    });
    console.log('✅ First strategy created:', response1.data.id);

    console.log('📝 Test 2: Creating identical strategy (should update existing)...');
    const response2 = await axios.post(`${API_BASE}/strategies`, testStrategy1, {
      headers: authHeaders
    });
    console.log('✅ Second strategy result:', response2.data.id);

    if (response1.data.id === response2.data.id) {
      console.log('🎉 SUCCESS: Identical strategy updated existing one!');
    } else {
      console.log('❌ ISSUE: Identical strategy created new one');
    }

    console.log('📝 Test 3: Creating different strategy of same type...');
    const response3 = await axios.post(`${API_BASE}/strategies`, testStrategy2, {
      headers: authHeaders
    });
    console.log('✅ Third strategy created:', response3.data.id);

    if (response3.data.id !== response1.data.id) {
      console.log('🎉 SUCCESS: Different config created new strategy!');
    } else {
      console.log('❌ ISSUE: Different config updated existing one');
    }

    console.log('\n📊 Final Results:');
    console.log(`Strategy 1 ID: ${response1.data.id}`);
    console.log(`Strategy 2 ID: ${response2.data.id} (should be same as 1)`);
    console.log(`Strategy 3 ID: ${response3.data.id} (should be different)`);

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testStrategyCreation();
