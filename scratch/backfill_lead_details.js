const postgres = require('postgres');
const OpenAI = require('openai');
require('dotenv').config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = postgres(connectionString);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

async function backfill() {
  console.log('--- Запуск обратной заливки (Backfill via SQL) для Ловца Лидов ---');

  try {
    // 1. Копируем crm_order_number в crm_order_id
    const sessionsWithNumber = await sql`
      SELECT id, crm_order_number 
      FROM widget_sessions 
      WHERE crm_order_number IS NOT NULL AND crm_order_id IS NULL
    `;

    if (sessionsWithNumber && sessionsWithNumber.length > 0) {
      console.log(`Найдено ${sessionsWithNumber.length} сессий для заполнения crm_order_id...`);
      for (const s of sessionsWithNumber) {
        const orderIdInt = parseInt(s.crm_order_number);
        if (!isNaN(orderIdInt)) {
          await sql`
            UPDATE widget_sessions 
            SET crm_order_id = ${orderIdInt} 
            WHERE id = ${s.id}
          `;
          console.log(`  Сессия ${s.id}: crm_order_id = ${orderIdInt}`);
        }
      }
    } else {
      console.log('Нет сессий, требующих копирования номеров заказов.');
    }

    // 2. Извлекаем контакты для сессий, где has_contacts = true, но контакты пусты
    const sessionsToExtract = await sql`
      SELECT id, nickname 
      FROM widget_sessions 
      WHERE has_contacts = true AND contact_phone IS NULL AND contact_email IS NULL
      LIMIT 15
    `;

    if (sessionsToExtract && sessionsToExtract.length > 0) {
      console.log(`Найдено ${sessionsToExtract.length} сессий для извлечения контактов через OpenAI...`);
      for (const s of sessionsToExtract) {
        const messages = await sql`
          SELECT role, content 
          FROM widget_messages 
          WHERE session_id = ${s.id}
          ORDER BY created_at ASC
        `;

        if (!messages || messages.length === 0) continue;

        const chatLog = messages.map(m => `${m.role === 'user' ? 'Клиент' : 'ИИ'}: ${m.content}`).join('\n');

        try {
          const res = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { 
                role: 'system', 
                content: `Проанализируй диалог и извлеки контакты. Верни JSON:
                {
                  "name": "Имя",
                  "phone": "Телефон (только цифры)",
                  "email": "Email",
                  "company": "Компания"
                }`
              },
              { role: 'user', content: chatLog }
            ],
            response_format: { type: 'json_object' }
          });

          const extracted = JSON.parse(res.choices[0].message.content || '{}');
          console.log(`  Сессия ${s.id} (${s.nickname || 'Аноним'}):`, extracted);

          await sql`
            UPDATE widget_sessions 
            SET 
              contact_name = ${extracted.name || s.nickname || null},
              contact_phone = ${extracted.phone || null},
              contact_email = ${extracted.email || null},
              contact_company = ${extracted.company || null}
            WHERE id = ${s.id}
          `;

        } catch (err) {
          console.error(`Ошибка обработки сессии ${s.id}:`, err);
        }
      }
    } else {
      console.log('Нет сессий, требующих извлечения контактов.');
    }

  } catch (dbErr) {
    console.error('Ошибка базы данных:', dbErr);
  } finally {
    await sql.end();
  }

  console.log('✅ Обратная заливка завершена.');
}

backfill();
