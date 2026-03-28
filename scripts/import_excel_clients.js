
const XLSX = require('xlsx');
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

const dbConfig = { connectionString: process.env.DATABASE_URL };

async function run() {
    const filename = 'customerCorporate-28-03-26.12-39_bdc680.xlsx';
    console.log(`🚀 Starting Full Data Enrichment from ${filename}...`);

    const workbook = XLSX.readFile(filename);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(sheet);
    console.log(`✅ Loaded ${rawData.length} rows from Excel.`);

    const client = new Client(dbConfig);
    await client.connect();

    try {
        const BATCH_SIZE = 100;
        for (let i = 0; i < rawData.length; i += BATCH_SIZE) {
            const batch = rawData.slice(i, i + BATCH_SIZE);
            
            for (const row of batch) {
                const name = (row['Название компании'] || row['Наименование'] || '').toString().trim();
                const inn = row['ИНН'] ? String(row['ИНН']).trim() : null;
                const category = row['Категория товара'] || null;
                const industry = row['Сфера деятельности'] || null;
                const kpp = row['КПП'] ? String(row['КПП']).trim() : null;
                const phone = row['Телефон'] ? String(row['Телефон']).replace(/[^\d]/g, '') : null;
                const email = row['E-mail'] ? String(row['E-mail']).trim().toLowerCase() : null;

                if (!name && !inn) continue;

                // Match by INN (most reliable) or by Name
                if (inn) {
                    await client.query(`
                        UPDATE clients SET 
                            category = COALESCE(category, $1),
                            industry = COALESCE(industry, $2),
                            kpp = COALESCE(kpp, $3),
                            phones = CASE WHEN phones IS NULL OR array_length(phones, 1) = 0 THEN ARRAY[$4]::text[] ELSE phones END,
                            email = COALESCE(email, $5)
                        WHERE inn = $6
                    `, [category, industry, kpp, phone, email, inn]);
                } else {
                    await client.query(`
                        UPDATE clients SET 
                            category = COALESCE(category, $1),
                            industry = COALESCE(industry, $2),
                            kpp = COALESCE(kpp, $3),
                            phones = CASE WHEN phones IS NULL OR array_length(phones, 1) = 0 THEN ARRAY[$4]::text[] ELSE phones END,
                            email = COALESCE(email, $5)
                        WHERE LOWER(company_name) = LOWER($6)
                    `, [category, industry, kpp, phone, email, name]);
                }
            }

            if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= rawData.length) {
                console.log(`Progress: ${Math.min(i + BATCH_SIZE, rawData.length)} / ${rawData.length}`);
            }
        }

        console.log("🎉 Excel Enrichment complete!");

    } catch (err) {
        console.error("❌ Error during enrichment:", err);
    } finally {
        await client.end();
    }
}

run();
