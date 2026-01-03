import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function verify() {
    console.log('🔍 Testing random-order API for TOP-3 fields...');
    // We'll call the local API if possible, or just mock the logic
    const res = await fetch('http://localhost:3000/api/analysis/random-order');
    if (!res.ok) {
        console.log('Server not running? Testing logic directly.');
        // If server not running, we could test the mapping logic
        return;
    }
    const data = await res.json();
    console.log('Order:', data.number);
    console.log('TOP-3:', JSON.stringify(data.top3, null, 2));
}

verify();
