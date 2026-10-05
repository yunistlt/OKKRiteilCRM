/**
 * Подписка на события телефонии Телфина для всех добавочных.
 *
 * Зачем. Оповещение во время звонка (а не по его записи) возможно только если
 * Телфин сам сообщает нам о событии. В их личном кабинете это настраивается на
 * КАЖДОМ добавочном отдельно: «Сотрудники и очереди» → добавочный → «События».
 * Добавочных двадцать, событий четыре — восемьдесят форм руками. То же самое
 * делает их REST API, поэтому делаем здесь.
 *
 * Что ставим: dial-in, dial-out, answer, hangup — методом POST на наш адрес.
 * Чужие подписки (старый коннектор RetailCRM, Roistat) не трогаем: они живут
 * своей жизнью, а снимать их — отдельное решение.
 *
 * Запуск:
 *   npx tsx scripts/telphin-register-events.ts                 # показать, что будет
 *   npx tsx scripts/telphin-register-events.ts --apply         # прописать
 *   npx tsx scripts/telphin-register-events.ts --remove --apply # снять наши
 */
import { fetchTelphin, getTelphinToken } from '@/lib/telphin';

const APPLY = process.argv.includes('--apply');
const REMOVE = process.argv.includes('--remove');

const ARG_URL = process.argv.find((a) => a.startsWith('--url='))?.split('=').slice(1).join('=');
const TARGET_URL = ARG_URL || process.env.TELPHIN_WEBHOOK_URL || 'https://okk.zmksoft.com/api/calls/webhooks/telphin';

/** Нужные нам события. dial-in — ради него всё и затевалось. */
const EVENTS = ['dial-in', 'dial-out', 'answer', 'hangup'] as const;

type Extension = { id: number; name: string };
type EventRow = { id: number; url: string; method: string; event_type: string };

async function headers() {
    return { Authorization: `Bearer ${await getTelphinToken()}` };
}

async function extensions(H: Record<string, string>): Promise<Extension[]> {
    const user = await (await fetchTelphin('https://apiproxy.telphin.ru/api/ver1.0/user', { headers: H })).json();
    const res = await fetchTelphin(
        `https://apiproxy.telphin.ru/api/ver1.0/client/${user.client_id}/extension/?per_page=200`,
        { headers: H },
    );
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.extensions || data.results || []);
    return list.map((row: any) => ({ id: Number(row.id), name: String(row.name ?? row.id) }));
}

async function eventsOf(H: Record<string, string>, extensionId: number): Promise<EventRow[]> {
    const res = await fetchTelphin(`https://apiproxy.telphin.ru/api/ver1.0/extension/${extensionId}/event/`, { headers: H });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

async function addEvent(H: Record<string, string>, extensionId: number, eventType: string): Promise<string> {
    const res = await fetchTelphin(`https://apiproxy.telphin.ru/api/ver1.0/extension/${extensionId}/event/`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: TARGET_URL, method: 'POST', event_type: eventType }),
    });
    if (res.ok) return 'добавлено';

    const text = await res.text();
    // Голосовое меню — не человек: разговаривать и поднимать трубку некому,
    // Телфин такие события на нём не заводит. Это не ошибка настройки.
    if (text.includes('ivr-type')) return 'не нужно (голосовое меню)';
    return `ошибка ${res.status}: ${text.slice(0, 120)}`;
}

async function removeEvent(H: Record<string, string>, extensionId: number, eventId: number): Promise<string> {
    const res = await fetchTelphin(`https://apiproxy.telphin.ru/api/ver1.0/extension/${extensionId}/event/${eventId}`, {
        method: 'DELETE',
        headers: H,
    });
    return res.ok ? 'снято' : `ошибка ${res.status}`;
}

(async () => {
    const H = await headers();
    const list = await extensions(H);
    console.log(`Добавочных: ${list.length}. Адрес: ${TARGET_URL}`);
    console.log(REMOVE ? 'Режим: снять наши подписки' : 'Режим: подписать');
    if (!APPLY) console.log('Это примерка — ничего не меняем. Для записи добавьте --apply\n');

    let added = 0;
    let removed = 0;
    let already = 0;

    for (const ext of list) {
        const current = await eventsOf(H, ext.id);
        const mine = current.filter((row) => String(row.url) === TARGET_URL);

        if (REMOVE) {
            for (const row of mine) {
                if (APPLY) await removeEvent(H, ext.id, row.id);
                removed++;
            }
            console.log(`${ext.name}: наших подписок ${mine.length}`);
            continue;
        }

        const have = new Set(mine.map((row) => row.event_type));
        const missing = EVENTS.filter((type) => !have.has(type));
        already += EVENTS.length - missing.length;

        if (!missing.length) {
            console.log(`${ext.name}: уже подписан на всё`);
            continue;
        }

        const results: string[] = [];
        for (const type of missing) {
            results.push(APPLY ? `${type} — ${await addEvent(H, ext.id, type)}` : `${type} — будет добавлено`);
            added++;
        }
        console.log(`${ext.name}: ${results.join(', ')}`);
    }

    console.log(
        REMOVE
            ? `\nИтого снято подписок: ${removed}`
            : `\nИтого: добавлено ${added}, уже было ${already}.`,
    );
    if (!APPLY) console.log('Ничего не записано — это была примерка.');
})();
