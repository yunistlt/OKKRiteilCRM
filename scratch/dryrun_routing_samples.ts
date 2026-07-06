// Сухой прогон роутера Катерины (router_v2 из БД) на представительных примерах по каждому отделу.
// Проверяет именно маршрутизацию: заявка / бухгалтерия / логистика / юрист / снабжение / не заявка.
// npx tsx -r dotenv/config scratch/dryrun_routing_samples.ts dotenv_config_path=.env.local
import { Client } from 'pg';
import { classifyRoute, isReplyThread, isNoReplySender, type EmailRoute } from '@/lib/email/classify';

const LABEL: Record<string, string> = {
    new_request: 'Новая заявка', accounting: 'Бухгалтерия', logistics: 'Логистика',
    legal: 'Юрист', procurement: 'Снабжение', reply_thread: 'Переписка', noreply: 'Робот', not_request: 'Не заявка',
};

// [ожидаемый маршрут, отправитель, тема, тело]
const SAMPLES: Array<[EmailRoute | 'noreply', string, string, string]> = [
    ['new_request', 'zakupki@zavod.ru', 'Запрос КП на стеллажи', 'Здравствуйте! Просчитайте, пожалуйста, КП на 40 архивных стеллажей 2000х1000х500, нужен счёт и сроки изготовления.'],
    ['accounting', 'buh@klient.ru', 'Акт сверки за 2 квартал', 'Добрый день. Просим подписать акт сверки взаиморасчётов за 2 квартал и прислать оригинал счёт-фактуры по оплате от 15.06.'],
    ['accounting', 'oplata@klient.ru', 'Реквизиты для оплаты', 'Пришлите, пожалуйста, ваши банковские реквизиты и счёт на оплату для проведения платежа через бухгалтерию.'],
    ['logistics', 'sklad@klient.ru', 'Когда будет доставка?', 'Подскажите статус доставки по нашему заказу, какая транспортная компания и когда машина приедет на адрес разгрузки?'],
    ['logistics', 'priemka@klient.ru', 'Повреждение при перевозке', 'При приёмке обнаружили вмятину на боковине шкафа, упаковка была повреждена при доставке. Что делать?'],
    ['legal', 'jurist@klient.ru', 'Согласование договора поставки', 'Направляем протокол разногласий к договору поставки, просим согласовать редакцию п.5 об ответственности и неустойке.'],
    ['legal', 'pretenzia@klient.ru', 'Претензия', 'Направляем досудебную претензию о взыскании неустойки за просрочку поставки, при отказе обратимся в суд.'],
    ['procurement', 'sales@postavshik.ru', 'Прайс на металлопрокат', 'Здравствуйте! Мы поставщик листового металла. Направляем наш прайс и КП — предлагаем выгодные цены, готовы поставлять под заказ.'],
    ['procurement', 'opt@krepezh.ru', 'Предложение о поставке крепежа', 'Предлагаем сотрудничество по поставке крепежа и фурнитуры НАМ на ваше производство, сравните наши цены.'],
    ['not_request', 'news@rassylka.ru', 'Скидки недели -30%', 'Только сегодня! Грандиозная распродажа вебинаров по продажам. Успейте купить курс со скидкой 30%.'],
    ['noreply', 'no-reply@tender.gov.ru', 'Уведомление площадки', 'Автоматическое уведомление: статус вашей заявки на площадке изменён.'],
];

async function loadPrompt(): Promise<string | undefined> {
    try {
        const c = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
        await c.connect();
        const r = await c.query("SELECT system_prompt FROM ai_prompts WHERE key='email_secretary_classifier' AND is_active=true");
        await c.end();
        return r.rows[0]?.system_prompt;
    } catch { return undefined; }
}

async function main() {
    const prompt = await loadPrompt();
    console.log('Промпт из БД:', prompt ? `да (${prompt.length} симв.)` : 'нет — дефолт из кода', '\n');

    let ok = 0;
    for (const [expected, from, subject, body] of SAMPLES) {
        let route: string, conf = 0, why = '';
        if (isNoReplySender(from)) { route = 'noreply'; why = 'noreply'; }
        else {
            const v = await classifyRoute({ fromEmail: from, fromName: '', subject, bodyText: body }, prompt);
            conf = v.confidence; why = v.reasoning;
            route = v.route === 'new_request' && isReplyThread(subject) ? 'reply_thread' : v.route;
        }
        const match = route === expected;
        if (match) ok++;
        console.log(`${match ? '✓' : '✗'} ожид. ${LABEL[expected].padEnd(12)} → получили ${LABEL[route] || route}${conf ? ` (${conf.toFixed(2)})` : ''}`);
        console.log(`    «${subject}» — ${why}`);
    }
    console.log(`\nИтог: ${ok}/${SAMPLES.length} совпали с ожиданием.`);
}
main().catch((e) => { console.error('FAIL:', e?.message || e); process.exit(1); });
