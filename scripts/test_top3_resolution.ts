import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { resolveRetailCRMLabel } from '../lib/retailcrm-mapping';

async function testResolution() {
    console.log('🧪 Testing TOP-3 Label Resolution...');

    const priceRes = await resolveRetailCRMLabel('top3Price', 'yes');
    const timingRes = await resolveRetailCRMLabel('top3Timing', 'no');
    const specsRes = await resolveRetailCRMLabel('top3Specs', null);

    console.log('Price (yes) ->', priceRes);
    console.log('Timing (no) ->', timingRes);
    console.log('Specs (null) ->', specsRes);

    if (priceRes === 'Да' && timingRes === 'Нет' && specsRes === 'Не указано') {
        console.log('✅ Resolution works perfectly!');
    } else {
        console.log('❌ Resolution failed.');
    }
}

testResolution();
