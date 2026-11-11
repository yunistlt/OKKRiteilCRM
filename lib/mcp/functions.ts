import { SHTAB_TOOLS, executeShtabTool } from '@/lib/shtab/tamara-tools';

// Готовые функции ОКК для коннектора: отчёты и расчёты, которые уже написаны и
// проверены в работе у Тамары. Коннектор их не дублирует, а вызывает те же.
//
// В каталог попадает только то, что перечислено здесь, и перечислено только то,
// что ЧИТАЕТ нашу базу: ничего не сохраняет, никому не пишет, не ходит во
// внешние сервисы и не тратит денег на ИИ. Функция, которой здесь нет, через
// коннектор не вызывается, даже если она есть у Тамары, — добавление сюда и есть
// пометка «только чтение».
//
// За этим списком следит tests/mcp-connector.test.ts: в нём нет ни одного имени
// из тех, что пишут или ходят наружу.

export const READ_ONLY_FUNCTIONS: Record<string, string> = {
    // Штаб владельца
    shtab_state: 'shtab',
    shtab_history: 'shtab',
    shtab_razbor_detail: 'shtab',
    shtab_programs: 'shtab',
    shtab_structure: 'shtab',
    shtab_post_doc: 'shtab',
    my_reports: 'shtab',
    // Продажи и деньги
    money_in: 'sales',
    sales_facts: 'sales',
    sales_pipeline: 'sales',
    sales_team_review: 'sales',
    // Юридический отдел
    court_cases: 'legal',
    court_case: 'legal',
    // Настройки и код системы
    settings_catalog: 'system',
    settings_proposals: 'system',
    code_search: 'system',
    code_read: 'system',
    code_files: 'system',
};

/**
 * Что через коннектор вызывать нельзя и почему. Список нужен тесту: имя отсюда
 * не должно оказаться в READ_ONLY_FUNCTIONS ни при какой правке.
 */
export const NEVER_VIA_CONNECTOR: readonly string[] = [
    // пишут в базу
    'shtab_structure_apply', 'shtab_import_staff_doc', 'shtab_razbor_write', 'settings_propose', 'ads_propose', 'make_document',
    // отправляют сообщения
    'telegram_owner',
    // платный вызов ИИ
    'tseh_logic',
    // пишет журнал запросов — для свободных запросов у коннектора свой run_query
    'shtab_query',
];

type Definition = { name: string; description: string; parameters: unknown };

function definitions(): Definition[] {
    return (SHTAB_TOOLS as ReadonlyArray<{ function: Definition }>)
        .map((t) => t.function)
        .filter((f) => f.name in READ_ONLY_FUNCTIONS);
}

export function listFunctions(section?: string, closedSections: string[] = []) {
    const closed = new Set(closedSections);
    const functions = definitions()
        .filter((f) => !closed.has(READ_ONLY_FUNCTIONS[f.name]))
        .filter((f) => !section || READ_ONLY_FUNCTIONS[f.name] === section)
        .map((f) => ({ name: f.name, section: READ_ONLY_FUNCTIONS[f.name], description: f.description, parameters: f.parameters }));
    return { functions, count: functions.length, note: 'Вызов — run_function(name, params). Все функции только читают.' };
}

export async function runFunction(name: string, params: unknown, closedSections: string[] = []) {
    const section = READ_ONLY_FUNCTIONS[name];
    if (!section || closedSections.includes(section)) {
        throw new Error(`Функции «${name}» в каталоге нет. Список — в list_functions.`);
    }
    const result = await executeShtabTool(name, params && typeof params === 'object' ? params : {});
    if (result && (result as any).available === false) {
        throw new Error(String((result as any).reason ?? 'Функция сейчас недоступна.'));
    }
    return { function: name, result };
}
