// Manual localStorage cleanup script
// Run this in browser console to clean up mixed job IDs

function cleanupLocalStorageJobs(walletAddress) {
  const cacheKey = `jobs_${walletAddress}`;
  const storedJobs = localStorage.getItem(cacheKey);
  
  if (!storedJobs) {
    console.log('❌ No localStorage data found for wallet:', walletAddress);
    return;
  }
  
  try {
    const parsedJobs = JSON.parse(storedJobs);
    console.log('📋 Total jobs found:', parsedJobs.length);
    
    // Separate old jobs from new jobs
    const numericJobs = parsedJobs.filter(job => /^\d+$/.test(job.id));
    const nonNumericJobs = parsedJobs.filter(job => !/^\d+$/.test(job.id));
    
    console.log('✅ Valid backend jobs (numeric IDs):', numericJobs.length);
    console.log('   Valid job IDs:', numericJobs.map(j => j.id));
    
    console.log('🗑️ Old jobs to remove (non-numeric IDs):', nonNumericJobs.length);
    console.log('   Old job IDs:', nonNumericJobs.map(j => j.id));
    
    if (nonNumericJobs.length > 0) {
      // Save only the valid jobs
      localStorage.setItem(cacheKey, JSON.stringify(numericJobs));
      console.log('🧹 Cleaned up localStorage! Removed', nonNumericJobs.length, 'old jobs');
      console.log('💾 Saved', numericJobs.length, 'valid jobs to localStorage');
    } else {
      console.log('✅ localStorage is already clean!');
    }
    
    return {
      totalJobs: parsedJobs.length,
      validJobs: numericJobs.length,
      removedJobs: nonNumericJobs.length,
      cleanedUp: nonNumericJobs.length > 0
    };
    
  } catch (error) {
    console.error('❌ Error parsing localStorage:', error);
    return null;
  }
}

// Auto-detect wallet address from current page context
function autoCleanup() {
  // Try to get wallet address from current context
  if (typeof wallet !== 'undefined' && wallet.publicKey) {
    const walletAddress = wallet.publicKey.toString();
    console.log('🔍 Auto-detected wallet address:', walletAddress);
    return cleanupLocalStorageJobs(walletAddress);
  } else {
    console.log('❌ Cannot auto-detect wallet. Please provide wallet address manually:');
    console.log('   cleanupLocalStorageJobs("YOUR_WALLET_ADDRESS_HERE")');
    return null;
  }
}

// Export functions to global scope for easy access
window.cleanupLocalStorageJobs = cleanupLocalStorageJobs;
window.autoCleanup = autoCleanup;

console.log('🛠️ LocalStorage cleanup tools loaded!');
console.log('Usage:');
console.log('  autoCleanup() - auto-detect wallet and clean');
console.log('  cleanupLocalStorageJobs("wallet_address") - manual cleanup');
