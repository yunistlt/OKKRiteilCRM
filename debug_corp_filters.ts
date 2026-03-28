
const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function testCorpFilters() {
    // 6 months ago
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6);
    const dateStr = cutoff.toISOString().slice(0, 10);
    
    // Test if maxOrderDate works for corporate
    const url = `${RETAILCRM_URL}/api/v5/customers-corporate?apiKey=${RETAILCRM_API_KEY}&filter[maxOrderDate]=${dateStr}&limit=1`;
    
    console.log('Testing filters:', url);
    const res = await fetch(url);
    const data = await res.json();
    console.log('Success:', data.success);
    if (!data.success) {
        console.log('Errors:', data.errors);
    } else {
        console.log('Found:', data.customersCorporate?.length);
    }
}

testCorpFilters();
