import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testAPI() {
    const prompt = "test";

    const res = await fetch('http://localhost:3000/api/analysis/test-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
    });

    const data = await res.json();

    console.log('Status from API:');
    console.log('- order.status:', data.order?.status);
    console.log('- order.statusCode:', data.order?.statusCode);
    console.log('\nFull order data:');
    console.log(JSON.stringify(data.order, null, 2));
}

testAPI();
