import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

console.log('🔍 Debugging environment loading...');
console.log('📁 Current working directory:', process.cwd());
console.log('📁 Script directory:', __dirname);

// Try different .env paths
const envPaths = [
  '.env',
  '../.env', 
  '../../.env',
  path.join(__dirname, '../.env'),
  path.join(__dirname, '../../.env'),
  path.join(process.cwd(), '.env')
];

for (const envPath of envPaths) {
  const fullPath = path.resolve(envPath);
  console.log(`\n📝 Checking: ${fullPath}`);
  
  if (fs.existsSync(fullPath)) {
    console.log('  ✅ File exists');
    
    // Try loading this .env file
    const result = dotenv.config({ path: fullPath });
    if (result.error) {
      console.log('  ❌ Error loading:', result.error.message);
    } else {
      console.log('  ✅ Loaded successfully');
      console.log('  📝 DATABASE_URL exists:', !!process.env.DATABASE_URL);
      console.log('  📝 DATABASE_URL preview:', process.env.DATABASE_URL?.substring(0, 30) + '...');
      break;
    }
  } else {
    console.log('  ❌ File not found');
  }
}