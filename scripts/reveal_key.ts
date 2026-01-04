
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

console.log('--- TELPHIN KEY CHECK ---');
const key = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
if (key) {
    console.log(`Local Key Prefix: ${key.substring(0, 10)}...`);
} else {
    console.log('Locally Key is MISSING');
}
