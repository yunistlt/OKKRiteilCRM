
const { Client } = require('pg');
const axios = require('axios');
require('dotenv').config({ path: '.env.local' });

const dbConfig = { connectionString: process.env.DATABASE_URL };
const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
    console.error("❌ RetailCRM config missing in .env.local");
    process.exit(1);
}

async function run() {
    console.log(`🚀 Starting Bulk Corporate Clients Sync from ${RETAILCRM_URL}...`);

    const client = new Client(dbConfig);
    await client.connect();

    try {
        let page = 1;
        let hasMore = true;
        let totalSynced = 0;

        while (hasMore) {
            console.log(`📡 Fetching page ${page}...`);
            const url = `${RETAILCRM_URL}/api/v5/customers-corporate?apiKey=${RETAILCRM_API_KEY}&limit=100&page=${page}`;
            
            const res = await axios.get(url, { timeout: 30000 });
            if (!res.data || !res.data.success) {
                throw new Error(`API Error: ${JSON.stringify(res.data)}`);
            }

            const customers = res.data.customersCorporate || [];
            if (customers.length === 0) {
                hasMore = false;
                break;
            }

            for (const c of customers) {
                const name = c.nickName || c.legalName || '';
                const inn = c.contragent?.inn || null;
                const kpp = c.contragent?.kpp || null;
                const email = c.email || null;
                const type = c.contragent?.contragentType || null;
                const phones = (c.phones || []).map(p => p.number.replace(/[^\d]/g, '')).filter(Boolean);
                
                const mainContact = c.mainCustomerContact || (c.contactPersons && c.contactPersons[0]);
                const contactName = mainContact ? `${mainContact.firstName ?? ''} ${mainContact.lastName ?? ''}`.trim() : null;

                // Simple point-upsert per customer for reliability first
                // If it's slow, we'll batch it properly later.
                await client.query(`
                    INSERT INTO clients (id, company_name, inn, kpp, phones, email, first_name, contragent_type, source, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
                    ON CONFLICT (id) DO UPDATE SET 
                        company_name = EXCLUDED.company_name,
                        inn = COALESCE(clients.inn, EXCLUDED.inn),
                        kpp = COALESCE(clients.kpp, EXCLUDED.kpp),
                        phones = CASE WHEN clients.phones IS NULL OR array_length(clients.phones, 1) = 0 THEN EXCLUDED.phones ELSE clients.phones END,
                        email = COALESCE(clients.email, EXCLUDED.email),
                        updated_at = NOW()
                `, [c.id, name, inn, kpp, phones, email, contactName, type, 'api_bulk_sync']);
            }

            totalSynced += customers.length;
            console.log(`✅ Page ${page} complete (Total: ${totalSynced}).`);

            if (res.data.pagination && page >= res.data.pagination.totalPageCount) {
                hasMore = false;
            } else {
                page++;
                await new Promise(r => setTimeout(r, 100));
            }
        }

        console.log(`🎉 Finished! Total corporate clients synced: ${totalSynced}`);

    } catch (err) {
        console.error("❌ Fatal Error:", err.message);
    } finally {
        await client.end();
        console.log("🏁 Sync completed.");
    }
}

run();
