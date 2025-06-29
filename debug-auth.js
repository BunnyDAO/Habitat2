// Manual test script for authentication debugging
// Run this in browser console

function debugAuth() {
  console.log('=== AUTHENTICATION DEBUG ===');
  
  // Check current wallet
  if (typeof wallet !== 'undefined' && wallet.publicKey) {
    console.log('✅ Connected wallet:', wallet.publicKey.toString());
  } else {
    console.log('❌ No wallet connected');
    return;
  }
  
  // Check current auth token
  const token = localStorage.getItem('auth.token');
  if (token) {
    console.log('🔑 Auth token exists in localStorage');
    
    // Try to decode JWT token to see which wallet it's for
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      console.log('🔍 Token payload:', payload);
      console.log('🏦 Token main_wallet_pubkey:', payload.main_wallet_pubkey);
      console.log('⏰ Token expires:', new Date(payload.exp * 1000));
      
      if (payload.main_wallet_pubkey === wallet.publicKey.toString()) {
        console.log('✅ Token matches connected wallet');
      } else {
        console.log('❌ Token is for different wallet!');
        console.log('   Token wallet:', payload.main_wallet_pubkey);
        console.log('   Connected wallet:', wallet.publicKey.toString());
      }
    } catch (e) {
      console.log('❌ Could not decode token:', e);
    }
  } else {
    console.log('❌ No auth token in localStorage');
  }
  
  // Check localStorage jobs
  const jobs = localStorage.getItem(`jobs_${wallet.publicKey.toString()}`);
  if (jobs) {
    const parsed = JSON.parse(jobs);
    console.log('📋 Jobs in localStorage:', parsed.length);
    parsed.forEach(job => {
      console.log(`   Job ${job.id}: ${job.type} for wallet ${job.tradingWalletPublicKey}`);
    });
  } else {
    console.log('📭 No jobs in localStorage for current wallet');
  }
  
  console.log('=== END DEBUG ===');
}

function forceReauth() {
  console.log('🔄 Forcing re-authentication...');
  
  if (!wallet.publicKey) {
    console.log('❌ No wallet connected');
    return;
  }
  
  const walletAddress = wallet.publicKey.toString();
  
  // Clear auth token
  localStorage.removeItem('auth.token');
  console.log('🧹 Cleared auth token');
  
  // Clear jobs for current wallet
  localStorage.removeItem(`jobs_${walletAddress}`);
  console.log('🧹 Cleared jobs for current wallet');
  
  console.log('✅ Cleared. Now refresh the page to test fresh auth.');
}

function testBackendCall() {
  console.log('🌐 Testing backend call...');
  
  if (typeof strategyApiService === 'undefined') {
    console.log('❌ strategyApiService not available');
    return;
  }
  
  strategyApiService.getStrategies()
    .then(strategies => {
      console.log('✅ Backend returned', strategies.length, 'strategies');
      strategies.forEach(strategy => {
        console.log(`   Strategy ${strategy.id}: ${strategy.strategy_type} for wallet ${strategy.wallet_pubkey}`);
      });
    })
    .catch(error => {
      console.log('❌ Backend call failed:', error);
    });
}

// Make functions available globally
window.debugAuth = debugAuth;
window.forceReauth = forceReauth;
window.testBackendCall = testBackendCall;

console.log('🛠️ Auth debugging tools loaded!');
console.log('Available commands:');
console.log('  debugAuth() - check current auth state');
console.log('  forceReauth() - clear auth and jobs, then refresh');
console.log('  testBackendCall() - test what backend returns');
