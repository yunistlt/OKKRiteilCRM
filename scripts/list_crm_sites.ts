import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function listSites() {
    console.log('🔍 Fetching RetailCRM Sites...');
    const url = `${process.env.RETAILCRM_URL?.replace(/\/+$/, '')}/api/v5/reference/sites?apiKey=${process.env.RETAILCRM_API_KEY}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.success) {
            console.log('✅ Available Sites:');
            data.sites.forEach((s: any) => console.log(`- Name: ${s.name}, Code: ${s.code}`));
        } else {
            console.error('❌ Failed to fetch sites:', data);
        }
    } catch (e) {
        console.error('❌ Error:', e);
    }
}

listSites();
