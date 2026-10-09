/**
 * Вписать ИНН в карточку клиента из командной строки.
 *
 * Нужен в одном случае: после слияния карточек, когда ИНН остался в дубле.
 * Обычный путь — карточка клиента в интерфейсе; здесь тот же
 * `saveClientRequisites`, чтобы правило «пишем только присланное» и запрет
 * дублей по ИНН работали одинаково.
 *
 * Запуск: npx tsx scripts/set-client-inn.ts --client=66493 --inn=2309081489
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

const arg = (name: string): string | null =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? null;

async function main() {
    const clientId = arg('client');
    const inn = arg('inn');
    if (!clientId || !inn) {
        console.error('Нужно --client=<id> и --inn=<ИНН>');
        process.exit(1);
    }

    const { saveClientRequisites, loadClientRequisites } = await import('../lib/own-crm/client-requisites');

    try {
        await saveClientRequisites(clientId, { inn }, 'правка ИНН (скрипт)');
    } catch (e: any) {
        console.error(e.message);
        process.exit(1);
    }

    const after = await loadClientRequisites(clientId);
    console.log(`карточка №${clientId}: ИНН ${after.inn ?? '—'}, КПП ${after.kpp ?? '—'}, банк ${after.bank ?? '—'}`);
}

main();
