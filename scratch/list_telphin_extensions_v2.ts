import { fetchTelphin, getTelphinToken } from './lib/telphin';

async function listExtensions() {
    try {
        const TELPHIN_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
        const token = await getTelphinToken();
        const res = await fetchTelphin(`https://apiproxy.telphin.ru/api/ver1.0/client/${TELPHIN_KEY}/extension/`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) {
            console.error('API Error:', res.status, await res.text());
            return;
        }
        
        const extensions = await res.json();
        console.log('Available Extensions:');
        extensions.forEach((ext: any) => {
            console.log(`- ID: ${ext.id}, Name: ${ext.name}, Type: ${ext.type || 'unknown'}`);
        });
    } catch (e) {
        console.error('Error:', e);
    }
}

listExtensions();
