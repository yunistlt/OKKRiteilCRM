/**
 * Собирает /etc/cron.d/okk из vercel.json — чтобы расписание жило в одном
 * месте и после переезда не разъехалось с тем, что было на Vercel.
 *
 *   node ops/timeweb/make-crons.mjs > okk.cron
 *
 * Время: и Vercel, и этот VPS живут в UTC, поэтому расписания переносятся
 * как есть. Если часовой пояс сервера когда-нибудь поменяют — расписания
 * сдвинутся, поэтому TZ задан в файле явно.
 */
import { readFileSync } from 'node:fs';

const { crons = [] } = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

const lines = [
    '# Кроны ОКК на своём сервере. Файл собран ops/timeweb/make-crons.mjs из',
    '# vercel.json — руками не правим, правим vercel.json и пересобираем.',
    '#',
    '# ВКЛЮЧАТЬ только после того, как "crons" убраны из vercel.json и это',
    '# выкачено на Vercel, иначе каждая задача пойдёт дважды.',
    'SHELL=/bin/sh',
    'PATH=/usr/local/bin:/usr/bin:/bin',
    'TZ=UTC',
    '',
];

for (const { path, schedule } of crons) {
    // Секрет не пишем в файл расписания: берём одну строку из /etc/okk.env
    // (права 600). Файл целиком не подключаем через "." — это формат systemd,
    // и sh на иных значениях спотыкается.
    // Знак % в cron означает перевод строки, поэтому экранируем.
    const call =
        `CRON_SECRET=$(sed -n 's/^CRON_SECRET=//p' /etc/okk.env); ` +
        `curl -fsS -m 290 -o /dev/null -H "Authorization: Bearer $CRON_SECRET" ` +
        `'http://127.0.0.1:3000${path.replace(/%/g, '\\%')}'`;
    lines.push(`${schedule} root ${call}  # ${path}`);
}

lines.push('');
process.stdout.write(lines.join('\n'));
console.error(`задач: ${crons.length}`);
