// Кто такой клиент по данным ЕГРЮЛ — через Dadata.
//
// До этого компанию мы узнавали единственным способом: брали домен из почты и
// читали сайт. Работает, но у половины клиентов почта на mail.ru, а у части
// сайт не открывается — и тогда о самой компании сказать нечего.
//
// Dadata отвечает на другие вопросы: чем занимается по ОКВЭД, какого размера,
// в каком регионе, жива ли вообще. Это меняет разговор: «оснащаете один цех или
// у вас несколько площадок» — вопрос, который можно задать, только зная ответ
// заранее.
//
// Берём бесплатный тариф подсказок (10 тысяч запросов в день): нам нужен поиск
// по ИНН, а не стандартизация, и секретный ключ для этого не требуется.

const ENDPOINT = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';

export type CompanyInfo = {
    inn: string;
    name: string;
    fullName: string | null;
    status: string | null;
    /** Основной вид деятельности словами, а не кодом. */
    activity: string | null;
    activityCode: string | null;
    region: string | null;
    city: string | null;
    address: string | null;
    employees: number | null;
    /**
     * Годовая выручка по данным ФНС. На бесплатном тарифе подсказок поле
     * приходит пустым — логику на нём строить нельзя, но если тариф позволяет,
     * это самая честная мера масштаба клиента.
     */
    revenue: number | null;
    /** За какой год выручка: цифра трёхлетней давности — тоже цифра. */
    revenueYear: number | null;
    /** Филиалы: повод спросить, оснащают одну площадку или несколько. */
    branches: number | null;
    registeredAt: string | null;
    managerName: string | null;
    /** Признак, что компания ликвидирована или в процессе — повод не звонить. */
    alive: boolean;
};

export function isDadataConfigured(): boolean {
    return Boolean(process.env.DADATA_API_KEY?.trim());
}

const STATUS_RU: Record<string, string> = {
    ACTIVE: 'действующая',
    LIQUIDATING: 'в процессе ликвидации',
    LIQUIDATED: 'ликвидирована',
    BANKRUPT: 'банкротство',
    REORGANIZING: 'реорганизация',
};

/**
 * Компания по ИНН.
 *
 * Возвращает null молча, если ключа нет или Dadata не ответила: знание о клиенте
 * — приправа к досье, а не его основа, и падать из-за него нельзя.
 */
export async function companyByInn(inn: string): Promise<CompanyInfo | null> {
    const key = process.env.DADATA_API_KEY?.trim();
    if (!key || !/^\d{10}(\d{2})?$/.test(inn)) return null;

    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Token ${key}`,
            },
            body: JSON.stringify({ query: inn, count: 1 }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;

        const json: any = await res.json();
        const s = (json.suggestions ?? [])[0];
        if (!s) return null;

        const d = s.data ?? {};
        const status = String(d.state?.status ?? '');

        return {
            inn: String(d.inn ?? inn),
            name: String(d.name?.short_with_opf || s.value || ''),
            fullName: d.name?.full_with_opf ?? null,
            status: STATUS_RU[status] ?? status.toLowerCase() ?? null,
            activity: d.okved_type && d.okved ? okvedName(d) : null,
            activityCode: d.okved ?? null,
            region: d.address?.data?.region_with_type ?? null,
            city: d.address?.data?.city_with_type ?? d.address?.data?.settlement_with_type ?? null,
            address: d.address?.value ?? null,
            employees: typeof d.employee_count === 'number' ? d.employee_count : null,
            revenue: typeof d.finance?.income === 'number' ? d.finance.income : null,
            revenueYear: typeof d.finance?.year === 'number' ? d.finance.year : null,
            branches: typeof d.branch_count === 'number' && d.branch_count > 0 ? d.branch_count : null,
            registeredAt: d.state?.registration_date
                ? new Date(Number(d.state.registration_date)).toISOString().slice(0, 10)
                : null,
            managerName: d.management?.name ?? null,
            alive: status === 'ACTIVE',
        };
    } catch {
        return null;
    }
}

/**
 * Расшифровка ОКВЭД по первым двум цифрам.
 *
 * Названия видов деятельности Dadata отдаёт только на платном тарифе, а «ОКВЭД
 * 46.69.4» менеджеру не говорит ничего. Раздел определяет суть: торгует клиент
 * или производит — это и есть половина ответа на вопрос, о чём с ним говорить.
 */
const OKVED_SECTIONS: Record<string, string> = {
    '01': 'сельское хозяйство', '02': 'лесное хозяйство', '03': 'рыболовство',
    '05': 'добыча угля', '06': 'добыча нефти и газа', '07': 'добыча руд', '08': 'добыча прочих ископаемых',
    '10': 'производство продуктов питания', '11': 'производство напитков',
    '13': 'текстильное производство', '14': 'производство одежды', '15': 'производство кожи',
    '16': 'обработка древесины', '17': 'производство бумаги', '18': 'полиграфия',
    '19': 'производство нефтепродуктов', '20': 'химическое производство',
    '21': 'производство лекарств', '22': 'производство резины и пластмасс',
    '23': 'производство стройматериалов и стекла', '24': 'металлургия',
    '25': 'производство металлических изделий', '26': 'производство электроники',
    '27': 'производство электрооборудования', '28': 'производство машин и оборудования',
    '29': 'производство автотранспорта', '30': 'производство прочих транспортных средств',
    '31': 'производство мебели', '32': 'прочее производство',
    '33': 'ремонт и монтаж оборудования', '35': 'электроэнергетика',
    '36': 'водоснабжение', '37': 'водоотведение', '38': 'обращение с отходами',
    '41': 'строительство зданий', '42': 'строительство инженерных сооружений',
    '43': 'специализированные строительные работы',
    '45': 'торговля автотранспортом и его ремонт', '46': 'оптовая торговля', '47': 'розничная торговля',
    '49': 'сухопутный транспорт', '50': 'водный транспорт', '51': 'воздушный транспорт',
    '52': 'складское хозяйство', '53': 'почта и доставка',
    '55': 'гостиницы', '56': 'общественное питание',
    '58': 'издательская деятельность', '59': 'кино и телевидение', '60': 'телерадиовещание',
    '61': 'связь', '62': 'разработка ПО', '63': 'обработка данных',
    '64': 'финансовые услуги', '65': 'страхование', '66': 'вспомогательные финансовые услуги',
    '68': 'операции с недвижимостью', '69': 'юридические и бухгалтерские услуги',
    '70': 'управленческий консалтинг', '71': 'проектирование и инженерные изыскания',
    '72': 'научные исследования', '73': 'реклама и маркетинг', '74': 'прочие профессиональные услуги',
    '75': 'ветеринария', '77': 'аренда и лизинг', '78': 'подбор персонала',
    '79': 'туризм', '80': 'охрана', '81': 'обслуживание зданий и территорий',
    '82': 'административные услуги', '84': 'госуправление',
    '85': 'образование', '86': 'здравоохранение', '87': 'уход с проживанием', '88': 'социальные услуги',
    '90': 'творческая деятельность', '91': 'библиотеки и музеи', '93': 'спорт и отдых',
    '94': 'общественные организации', '95': 'ремонт бытовых изделий', '96': 'бытовые услуги',
};

function okvedName(d: any): string {
    const code = String(d.okved ?? '');
    const section = OKVED_SECTIONS[code.slice(0, 2)];
    return section ? `${section} (ОКВЭД ${code})` : `ОКВЭД ${code}`;
}

/** Строка для досье: то, что стоит знать перед звонком. */
export function renderCompany(c: CompanyInfo): string {
    const parts = [c.name];
    if (c.activity) parts.push(`вид деятельности: ${c.activity}`);
    // Число сотрудников и выручка доступны только на платном тарифе Dadata:
    // на бесплатном они всегда пусты, и строку под них тратить не на что.
    if (c.employees) parts.push(`сотрудников: ${c.employees}`);
    if (c.branches) parts.push(`филиалов: ${c.branches}`);
    if (c.city || c.region) parts.push(`где: ${c.city || c.region}`);
    if (c.registeredAt) parts.push(`работает с ${c.registeredAt.slice(0, 4)} года`);
    // Про статус пишем только когда он тревожный: «действующая» — это норма и
    // строку тратить не на что.
    if (!c.alive && c.status) parts.push(`⚠️ ${c.status}`);
    return parts.join(', ');
}
