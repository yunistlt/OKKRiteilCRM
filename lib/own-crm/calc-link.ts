/**
 * Расчёты из калькулятора «Бот-Инженер» в карточке заказа.
 *
 * Временное решение, пока нет полной интеграции (решение владельца 02.10.2026):
 * менеджер считает изделие в калькуляторе и вписывает там номер нашего заказа в
 * поле «Номер заказа». Мы находим такие расчёты по этому номеру и по кнопке
 * «Взять из калькулятора» переносим их позицией в состав заказа.
 *
 * Только чтение чужой базы: расчёты живут в Supabase соседнего проекта
 * LVZCalc_bot (те же ключи, что у каталога сайта), мы им ничего не пишем.
 *
 * Цена берётся `final_price` — ровно та, что калькулятор показывает в своём КП
 * (с наценкой). Себестоимость (`cost_price`) менеджеру не показываем.
 */
import { createClient } from '@supabase/supabase-js';

const URL_KEY = 'LVZ_SUPABASE_URL';
const KEY_KEY = 'LVZ_SUPABASE_ANON_KEY';

/** Номер, который калькулятор ставит, когда менеджер не вписал заказ. */
const NO_NUMBER = 'Б/Н';

export function calcLinkConfigured(): boolean {
    return Boolean(process.env[URL_KEY]?.trim() && process.env[KEY_KEY]?.trim());
}

function client() {
    return createClient(process.env[URL_KEY]!, process.env[KEY_KEY]!);
}

/**
 * Калькуляторы и их таблицы. Названия человеческие — их видит менеджер
 * (закон «интерфейс только человеческим языком»).
 */
const CALCULATORS: Array<{ type: string; table: string; name: string }> = [
    { type: 'lvz', table: 'calculations_lvz', name: 'Шкаф для ЛВЖ' },
    { type: 'muffle', table: 'calculations_muffle', name: 'Муфельная печь' },
    { type: 'battery', table: 'calculations_battery', name: 'Шкаф для АКБ' },
    { type: 'workbench', table: 'calculations_workbench', name: 'Верстак' },
    { type: 'transport_box', table: 'calculations_transport_box', name: 'Транспортный ящик' },
    { type: 'crane', table: 'calculations_crane', name: 'Консольный кран' },
];

export type OrderCalculation = {
    /** Тип калькулятора и его номер расчёта — вместе это ключ позиции. */
    type: string;
    id: string;
    /** Название изделия человеческим языком. */
    title: string;
    /** Цена с наценкой, как в КП калькулятора. */
    price: number;
    quantity: number;
    weightKg: number | null;
    imageUrl: string | null;
    /** Кто считал и когда — чтобы менеджер понимал, чей это расчёт. */
    author: string | null;
    createdAt: string | null;
    /** Короткая сводка параметров: габариты, количество полок и прочее. */
    params: string;
};

export type OrderCalculationsResult =
    | { available: true; items: OrderCalculation[] }
    | { available: false; reason: string; items: [] };

function num(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function dimensions(input: Record<string, any>): string {
    const width = num(input.width);
    const height = num(input.height);
    const depth = num(input.depth);
    const length = num(input.length);

    if (width && height && depth) return `${width}×${height}×${depth} мм`;
    if (length && depth && height) return `${length}×${depth}×${height} мм`;
    if (input.boom_length || input.capacity) {
        const parts = [];
        if (input.capacity) parts.push(`${input.capacity} т`);
        if (input.boom_length) parts.push(`вылет ${input.boom_length} м`);
        if (input.lift_height) parts.push(`высота ${input.lift_height} м`);
        return parts.join(', ');
    }
    return '';
}

/** Сводка параметров расчёта — то, чем изделия отличаются друг от друга. */
function describeParams(input: Record<string, any>): string {
    const parts: string[] = [];
    const dims = dimensions(input);
    if (dims) parts.push(dims);
    if (input.temp_str || input.temp) parts.push(`до ${input.temp_str || input.temp}°C`);
    if (num(input.rei_level)) parts.push(`РЕИ ${input.rei_level}`);
    if (num(input.shelves_count)) parts.push(`полок ${input.shelves_count}`);
    if (num(input.sump_volume_l)) parts.push(`поддон ${input.sump_volume_l} л`);
    if (input.battery_type) parts.push(String(input.battery_type));
    if (input.purpose) parts.push(String(input.purpose));
    if (input.ventilation === true || input.has_ventilation === true) parts.push('с вытяжкой');
    return parts.join(' · ');
}

function buildTitle(calculatorName: string, input: Record<string, any>, result: Record<string, any>): string {
    const own = String(result.product_name || '').trim();
    if (own) return own;
    const dims = dimensions(input);
    return dims ? `${calculatorName} ${dims}` : calculatorName;
}

/**
 * Второй путь к тем же расчётам: «проекты» калькулятора. Менеджер нажимает там
 * «Добавить расчёт в заказ», и номер заказа попадает в `projects.title`
 * (колонка `order_number` у них пустует). Иначе такие расчёты в карточке не
 * видны, хотя менеджер их сделал.
 */
async function fromProjects(db: ReturnType<typeof client>, number: string): Promise<OrderCalculation[]> {
    const { data: projects, error } = await db
        .from('projects')
        .select('id, title, order_number')
        .or(`title.eq.${number},order_number.eq.${number}`)
        .limit(20);

    if (error || !projects?.length) return [];

    const { data: links } = await db
        .from('project_items')
        .select('item_id, item_type, quantity')
        .in('project_id', (projects as any[]).map((p) => p.id));

    const byType = new Map<string, Array<{ id: string; quantity: number }>>();
    for (const link of ((links ?? []) as any[])) {
        const type = String(link.item_type || '');
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type)!.push({ id: String(link.item_id), quantity: Math.max(1, num(link.quantity) || 1) });
    }

    const loaded = await Promise.all(
        Array.from(byType.entries()).map(async ([type, refs]) => {
            const calculator = CALCULATORS.find((c) => c.type === type);
            if (!calculator) return [] as OrderCalculation[];
            try {
                const { data } = await db
                    .from(calculator.table)
                    .select('id, created_at, username, input_data, result_data')
                    .in('id', refs.map((r) => r.id));

                return ((data ?? []) as any[]).map((row) => {
                    const input = (row.input_data || {}) as Record<string, any>;
                    const result = (row.result_data || {}) as Record<string, any>;
                    const ref = refs.find((r) => r.id === String(row.id));
                    return {
                        type: calculator.type,
                        id: String(row.id),
                        title: buildTitle(calculator.name, input, result),
                        price: num(result.final_price),
                        quantity: ref?.quantity ?? Math.max(1, num(input.quantity) || 1),
                        weightKg: num(result.weight_gross_kg) || num(result.weight) || null,
                        imageUrl: result.image_url ? String(result.image_url) : null,
                        author: row.username ? String(row.username) : null,
                        createdAt: row.created_at ? String(row.created_at) : null,
                        params: describeParams(input),
                    } as OrderCalculation;
                });
            } catch (e: any) {
                console.warn(`[calc-link] проект ${calculator.table}: ${e.message}`);
                return [] as OrderCalculation[];
            }
        }),
    );

    return loaded.flat();
}

/**
 * Расчёты, привязанные к номеру заказа.
 *
 * Номер сравниваем как строку: у своих заказов он с буквой («1019А»), у
 * приехавших из RetailCRM — число. «Б/Н» не ищем никогда: это расчёт без заказа.
 */
export async function calculationsForOrder(orderNumber: string): Promise<OrderCalculationsResult> {
    const number = String(orderNumber ?? '').trim();
    if (!number || number === NO_NUMBER) {
        return { available: true, items: [] };
    }
    if (!calcLinkConfigured()) {
        return {
            available: false,
            reason: `Калькулятор не подключён: нет ${URL_KEY} / ${KEY_KEY}`,
            items: [],
        };
    }

    const db = client();

    const found = await Promise.all(
        CALCULATORS.map(async (calculator) => {
            try {
                const { data, error } = await db
                    .from(calculator.table)
                    .select('id, created_at, username, input_data, result_data')
                    .eq('input_data->>order_number', number)
                    .order('created_at', { ascending: false })
                    .limit(50);

                if (error) throw new Error(error.message);

                return ((data ?? []) as any[]).map((row): OrderCalculation => {
                    const input = (row.input_data || {}) as Record<string, any>;
                    const result = (row.result_data || {}) as Record<string, any>;
                    return {
                        type: calculator.type,
                        id: String(row.id),
                        title: buildTitle(calculator.name, input, result),
                        price: num(result.final_price),
                        quantity: Math.max(1, num(input.quantity) || 1),
                        weightKg: num(result.weight_gross_kg) || num(result.weight) || null,
                        imageUrl: result.image_url ? String(result.image_url) : null,
                        author: row.username ? String(row.username) : null,
                        createdAt: row.created_at ? String(row.created_at) : null,
                        params: describeParams(input),
                    };
                });
            } catch (e: any) {
                // Один калькулятор не ответил — остальные показываем.
                console.warn(`[calc-link] ${calculator.table}: ${e.message}`);
                return [] as OrderCalculation[];
            }
        }),
    );

    const projectItems = await fromProjects(db, number);

    // Один расчёт может прийти оба пути — показываем один раз.
    const unique = new Map<string, OrderCalculation>();
    for (const item of [...found.flat(), ...projectItems]) {
        unique.set(`${item.type}:${item.id}`, item);
    }

    const items = Array.from(unique.values())
        .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')));

    return { available: true, items };
}
