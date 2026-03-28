
const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function checkCorpApi() {
    const id = 42432;
    const url = `${RETAILCRM_URL}/api/v5/customers-corporate/${id}?apiKey=${RETAILCRM_API_KEY}`;
    
    console.log('Fetching:', url);
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.success) {
        console.log('Corporate Customer Data:');
        console.log('Main:', JSON.stringify(data.customerCorporate, (k, v) => k === 'contactPersons' ? undefined : v, 2));
        console.log('Contact Persons Count:', data.customerCorporate.contactPersons?.length);
        if (data.customerCorporate.contactPersons?.length > 0) {
            console.log('First Contact Person:', JSON.stringify(data.customerCorporate.contactPersons[0], null, 2));
        }
    } else {
        console.log('Error:', data);
    }
}

checkCorpApi();
