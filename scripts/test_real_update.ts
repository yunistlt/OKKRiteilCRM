
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testRealStatusUpdate() {
    console.log('🧪 Testing REAL status update (NOT dry-run)...\n');

    const response = await fetch('http://localhost:3000/api/ai/route-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            dryRun: false,  // REAL update!
            limit: 1        // Only 1 order
        })
    });

    const data = await response.json();

    console.log('📊 Response:');
    console.log(JSON.stringify(data, null, 2));

    if (data.success && data.results && data.results.length > 0) {
        const result = data.results[0];
        console.log('\n✅ Result:');
        console.log(`   Order: #${result.order_id}`);
        console.log(`   From: ${result.from_status}`);
        console.log(`   To: ${result.to_status} (${result.to_status_name})`);
        console.log(`   Confidence: ${(result.confidence * 100).toFixed(0)}%`);
        console.log(`   Applied: ${result.was_applied ? '✅ YES' : '❌ NO'}`);
        console.log(`   Reasoning: ${result.reasoning}`);
        if (result.error) {
            console.log(`   ⚠️ Error: ${result.error}`);
        }
    }
}

testRealStatusUpdate().catch(console.error);
