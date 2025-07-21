import dotenv from 'dotenv';
import { URL } from 'url';

dotenv.config();

function debugConnection() {
  console.log('🔍 Debugging database connection...');
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL not found in environment variables');
    return;
  }
  
  console.log('📝 DATABASE_URL exists (length:', dbUrl.length, ')');
  console.log('📝 DATABASE_URL preview:', dbUrl.substring(0, 30) + '...');
  
  try {
    const url = new URL(dbUrl);
    console.log('✅ URL parsing successful:');
    console.log('  - Protocol:', url.protocol);
    console.log('  - Host:', url.hostname);
    console.log('  - Port:', url.port);
    console.log('  - Database:', url.pathname);
    console.log('  - Username:', url.username);
    console.log('  - Password length:', url.password?.length || 0);
    console.log('  - Password type:', typeof url.password);
    
    if (!url.password) {
      console.error('❌ Password is missing or empty');
    } else {
      console.log('✅ Password exists');
    }
    
  } catch (error) {
    console.error('❌ Error parsing DATABASE_URL:', error);
  }
}

debugConnection();