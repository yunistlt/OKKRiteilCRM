import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

/**
 * Цвета групп статусов «как в RetailCRM».
 *
 * ВАЖНО: их API цвета не отдаёт — в reference/status-groups есть только код, имя, порядок
 * и состав. Палитра зашита у них в интерфейсе, поэтому значения ниже сняты с экрана
 * RetailCRM. Группы, которых на снятых экранах не было, помечены как подобранные —
 * если понадобится точность, поправим по скриншоту.
 */
const COLORS = {
    // Сняты с экрана RetailCRM
    new: '#F0A030',                     // Новый — оранжевый
    approval: '#FBE0C0',                // Согласование — бледно-персиковый
    'reklamacii-offis': '#2FC49B',      // На оплате — зелёный
    complete: '#27AE60',                // Выполнен — зелёный
    assembling: '#EDE9FB',              // Производство — бледно-сиреневый
    cancel: '#F5C6C6',                  // Отменен — розовый
    'gos-tender': '#A03A33',            // Тендер — тёмно-красный

    // Подобраны в тон их палитре: этих групп на снятых экранах не было
    delivery: '#D7E3FC',
    rascet: '#FDF0D5',
    marketing: '#E8DAF5',
    cold: '#E0F2FE',
    tech: '#E5E7EB',
    dilerstvo: '#FFD9D9',
    'proektnye-prodazhi': '#CFE9DC',    // Развитие клиента
    // Воронка «Цех-успех» — соседний продукт, в наших заказах не участвует: нейтральный серый
    'kontakt-vyyavlenie-potrebnostej-tseh-uspeh': '#EEF2F6',
    'predvnedrencheskaya-sessiya-tseh-uspeh': '#EEF2F6',
    'zaklyuchenie-dogovora-tseh-uspeh': '#EEF2F6',
    'oplata-po-dogovoru-vnedreniya-tseh-uspeh': '#EEF2F6',
    'oplata-abonentskoj-platy-tseh-uspeh': '#EEF2F6',
    'vnedrenie-tsu-u-klienta-tseh-uspeh': '#EEF2F6',
    'dorabotki-tseh-uspeh': '#EEF2F6',
    'sdelka-uspeshna-klient-rabotaet-v-programme-tseh-uspeh': '#EEF2F6',
    'sdelka-provalena-ukazat-prichiny-provala-tseh-uspeh': '#EEF2F6',
    'perenos-vto-1': '#EEF2F6',
};

const c = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
await c.connect();

let painted = 0;
for (const [code, color] of Object.entries(COLORS)) {
    const { rowCount } = await c.query('UPDATE crm_status_groups SET color = $1, updated_at = NOW() WHERE code = $2', [color, code]);
    painted += rowCount;
}

// Цвет статуса снимаем: пусть наследуют цвет группы, как в RetailCRM.
// Свой цвет статуса остаётся возможным — задаётся руками в его карточке.
const { rowCount: cleared } = await c.query('UPDATE crm_statuses SET color = NULL WHERE color IS NOT NULL');

console.log(`Группам проставлен цвет: ${painted}`);
console.log(`Статусов переведено на цвет группы: ${cleared}`);

const { rows } = await c.query(`SELECT g.name, g.color, count(s.id) AS n
    FROM crm_status_groups g LEFT JOIN crm_statuses s ON s.group_id = g.id
    GROUP BY g.name, g.color ORDER BY n DESC LIMIT 10`);
rows.forEach(r => console.log(`  ${(r.color ?? 'без цвета').padEnd(9)} ${r.name} — статусов ${r.n}`));

await c.end();
