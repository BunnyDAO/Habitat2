console.log('Starting test daemon...');

let counter = 0;
const interval = setInterval(() => {
  counter++;
  console.log(`Test daemon alive: ${counter} (${new Date().toISOString()})`);
  
  if (counter >= 10) {
    console.log('Test daemon completed successfully');
    clearInterval(interval);
    process.exit(0);
  }
}, 5000);

console.log('Test daemon started, will check every 5 seconds...');