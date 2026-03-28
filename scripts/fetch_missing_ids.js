
const XLSX = require('xlsx');
const { Client } = require('pg');
const axios = require('axios');
require('dotenv').config({ path: '.env.local' });

const dbConfig = { connectionString: process.env.DATABASE_URL };
const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
    console.error("❌ RetailCRM config missing in .env.local");
    process.exit(1);
}

async function run() {
    const filename = 'customerCorporate-28-03-26.12-39_bdc680.xlsx';
    console.log(`🚀 Starting finalized fetch_missing_ids from ${filename}...`);

    const workbook = XLSX.readFile(filename);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(sheet);
    console.log(`✅ Loaded ${rawData.length} rows from Excel.`);

    const client = new Client(dbConfig);
    await client.connect();

    try {
        console.log("🔍 Fetching existing clients from DB...");
        const res = await client.query('SELECT company_name, inn FROM clients');
        const existingInns = new Set(res.rows.map(r => r.inn).filter(Boolean));
        const existingNames = new Set(res.rows.map(r => (r.company_name || '').toLowerCase().trim()).filter(Boolean));

        const missingFromDb = [];
        const seenInExcel = new Set();

        for (const row of rawData) {
            const name = (row['Название компании'] || row['Наименование'] || '').toString().replace(/[\s\u200B\u200C\u200D\u200E\u200F\uFEFF]/g, ' ').trim();
            const inn = row['ИНН'] ? String(row['ИНН']).trim() : null;

            if (!name && !inn) continue;
            if (name.length < 2 && !inn) continue;

            const nameKey = name.toLowerCase();
            const excelKey = (inn && inn !== '') ? `inn:${inn}` : `name:${nameKey}`;
            if (seenInExcel.has(excelKey)) continue;
            seenInExcel.add(excelKey);

            if (!((inn && existingInns.has(inn)) || (nameKey && existingNames.has(nameKey)))) {
                missingFromDb.push({
                    company_name: name,
                    inn: inn,
                    kpp: row['КПП'] ? String(row['КПП']).trim() : null,
                    phone: row['Телефон'] ? String(row['Телефон']).replace(/[^\d]/g, '') : null,
                    email: row['E-mail'] ? String(row['E-mail']).trim().toLowerCase() : null,
                    contact_name: row['ФИО'] || null,
                    contragent_type: row['Тип контрагента'] || null
                });
            }
        }
        console.log(`✨ Found ${missingFromDb.length} companies to fetch.`);

        let found = 0, skipped = 0, errors = 0;

        for (let i = 0; i < missingFromDb.length; i++) {
            const item = missingFromDb[i];
            let success = false;
            let retryCount = 0;

            while (!success && retryCount < 2) {
                try {
                    const params = new URLSearchParams();
                    params.set('apiKey', RETAILCRM_API_KEY);
                    
                    if (item.inn && item.inn !== '') {
                        params.set('filter[inn]', item.inn);
                    } else {
                        // CRM search name: remove extra quotes and special chars
                        const cleanNameForSearch = item.company_name.replace(/[«»""]/g, '').trim();
                        if (cleanNameForSearch.length < 2) {
                            success = true;
                            skipped++;
                            break;
                        }
                        params.set('filter[name]', cleanNameForSearch);
                    }

                    const url = `${RETAILCRM_URL.replace(/\/+$/, '')}/api/v5/customers-corporate?${params.toString()}`;
                    const apiRes = await axios.get(url, { timeout: 30000 });
                    
                    if (apiRes.data && apiRes.data.success && apiRes.data.customersCorporate?.length > 0) {
                        const crmCustomer = apiRes.data.customersCorporate[0];
                        await client.query(`
                            INSERT INTO clients (id, company_name, inn, kpp, phones, email, first_name, contragent_type, source, created_at, updated_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
                            ON CONFLICT (id) DO UPDATE SET 
                                inn = COALESCE(clients.inn, EXCLUDED.inn),
                                phones = CASE WHEN clients.phones IS NULL OR array_length(clients.phones, 1) = 0 THEN EXCLUDED.phones ELSE clients.phones END,
                                email = COALESCE(clients.email, EXCLUDED.email),
                                updated_at = NOW()
                        `, [
                            crmCustomer.id, item.company_name, item.inn, item.kpp,
                            item.phone ? [item.phone] : [], item.email, item.contact_name, item.contragent_type,
                            'excel_api_fetch'
                        ]);
                        found++;
                    } else {
                        skipped++;
                    }
                    success = true;
                } catch (err) {
                    retryCount++;
                    if (retryCount === 2) {
                        console.error(`❌ Failure for "${item.company_name}" (INN: ${item.inn}): ${err.message}`);
                        errors++;
                    } else {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }

            if ((i + 1) % 50 === 0) {
                console.log(`Progress: ${i + 1}/${missingFromDb.length} | Found: ${found} | Skipped: ${skipped} | Errors: ${errors}`);
            }

            await new Promise(r => setTimeout(r, 200));
        }

        console.log(`✅ Done. Found: ${found}, Skipped: ${skipped}, Errors: ${errors}`);

    } catch (err) {
        console.error("❌ Fatal Error:", err);
    } finally {
        await client.end();
        console.log("🏁 Completed.");
    }
}

run();
