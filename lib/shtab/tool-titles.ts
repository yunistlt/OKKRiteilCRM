/**
 * Человеческие названия инструментов Тамары.
 *
 * В интерфейсе не место кодам: `tseh_query` ничего не говорит владельцу, а
 * «база завода» говорит. Это общий закон интерфейса, и список ответов на
 * вопрос «откуда она это взяла» — не исключение: по нему решают, верить числу
 * или перепроверить.
 *
 * Названия отвечают на вопрос «куда она посмотрела», а не «какую функцию
 * вызвала»: несколько инструментов по одному источнику называются одинаково, и
 * это правильно — владельцу важен источник, а не то, каким из трёх запросов он
 * прочитан.
 */
const TITLES: Record<string, string> = {
    // Завод «ЦехУспех»
    tseh_query: 'база завода',
    tseh_tables: 'база завода',
    tseh_logic: 'база завода',
    tseh_people: 'люди на заводе',
    tseh_staff_docs: 'документы по людям',
    tseh_customers: 'заказчики завода',
    tseh_debt: 'долги заказчиков',
    tseh_revenue_history: 'выручка завода',
    tseh_profit_history: 'прибыль завода',
    tseh_balance_history: 'баланс завода',
    tseh_ops_coverage: 'загрузка операций',

    // Продажи и деньги
    sales_facts: 'продажи',
    sales_pipeline: 'воронка продаж',
    sales_team_review: 'работа отдела продаж',
    money_in: 'приход денег',

    // Штаб
    shtab_query: 'данные Штаба',
    shtab_state: 'состояние Штаба',
    shtab_structure: 'структура компании',
    shtab_structure_apply: 'правка структуры',
    shtab_blocks: 'разделы Штаба',
    shtab_history: 'история Штаба',
    shtab_program: 'программа',
    shtab_programs: 'программы',
    shtab_razbor_detail: 'разбор',
    shtab_razbor_write: 'запись разбора',
    shtab_post_doc: 'документ в Штаб',
    shtab_import_staff_doc: 'загрузка документа',

    // Справочники и знания
    catalog_search: 'справочник ОКК',
    catalog_overview: 'справочник ОКК',
    db_schema: 'устройство базы',
    lvz_read: 'каталог ЛВЖ',
    lvz_tables: 'каталог ЛВЖ',
    lvz_calc_summary: 'расчёты ЛВЖ',

    // Код проекта
    code_search: 'код сервиса',
    code_read: 'код сервиса',
    code_files: 'код сервиса',

    // Настройки
    settings_catalog: 'настройки сервиса',
    settings_propose: 'предложение по настройке',
    settings_proposals: 'предложения по настройкам',

    // Её собственные дела
    my_reports: 'свои прошлые отчёты',
    tamara_digest: 'своя сводка',
    telegram_owner: 'сообщение в телеграм',
    make_document: 'сборка документа',
};

/**
 * Во что она смотрела — списком, без повторов и в порядке обращения.
 *
 * Повторы убираются потому, что «база завода, база завода, база завода» —
 * это про устройство запроса, а не про источник. Незнакомый инструмент
 * показываем как есть: пустая строка хуже кода.
 */
export function lookedInto(tools: Array<{ name: string }> | null | undefined): string[] {
    const seen: string[] = [];
    for (const t of tools ?? []) {
        const title = TITLES[t.name] ?? t.name;
        if (!seen.includes(title)) seen.push(title);
    }
    return seen;
}
