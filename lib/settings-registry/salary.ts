import { supabase } from '@/utils/supabase';
import {
    SALARY_CONFIG_SCHEMAS,
    getResolvedConfig,
    updateConfig,
    validateConfigValue,
    type SalaryConfigKey,
} from '@/lib/salary/config';
import type { ApplyOptions, KnobValue, ModuleAdapter, ProposalOptions } from './types';
import { knobKey } from './types';

/**
 * Ручки мотивации.
 *
 * Отличие от бота-РОПа принципиальное: значение мотивации действует С ДАТЫ.
 * Закрытый период нельзя пересчитать задним числом — люди уже получили деньги
 * по тем ставкам, — поэтому у каждого предложения обязана быть дата, и по
 * умолчанию это первое число следующего месяца, а не сегодня.
 *
 * Значения здесь — JSON: ставка это число, а тиры качества — массив порогов.
 * Отдаём их модели как есть: подогнать всё под «строку» значит заставить её
 * угадывать форму, а форма у каждого ключа своя и проверяется схемой Zod.
 */

/**
 * Человеческие названия ключей мотивации.
 *
 * Ключ вроде `k_team_tiers` ничего не говорит ни человеку, ни модели. Ключ, для
 * которого названия ещё нет, всё равно показывается — сырым: скрытая настройка
 * продолжает влиять на зарплату, а найти её невозможно.
 */
const SALARY_TITLES: Record<string, { title: string; hint: string; group: string }> = {
    oklad: {
        title: 'Оклад',
        hint: 'Постоянная часть в месяц, до всех премий. Меняется редко и сразу всем, у кого нет своей схемы.',
        group: 'Основа',
    },
    rate_zayavka: {
        title: 'Ставка за заявку',
        hint: 'Сколько платим за закрытую заявку: отдельно за нового клиента и за постоянного. Постоянный дороже — так покупают повторно, а не бегают за новыми.',
        group: 'Основа',
    },
    k_quality_tiers: {
        title: 'Коэффициент качества',
        hint: 'Пороги балла ОКК и множитель к премии на каждом. Прямая связь оценки качества с деньгами менеджера.',
        group: 'Качество',
    },
    conv_bonus_tiers: {
        title: 'Премия за конверсию',
        hint: 'Пороги конверсии и сумма премии на каждом. Самый сильный рычаг: конверсия — то, чем менеджер действительно управляет.',
        group: 'Конверсия',
    },
    conv_min_zayavki: {
        title: 'Минимум заявок для премии за конверсию',
        hint: 'Меньше этого числа заявок — конверсию не считаем: на трёх заявках она случайна.',
        group: 'Конверсия',
    },
    k_team_tiers: {
        title: 'Коэффициент команды',
        hint: 'Множитель от выполнения плана всем отделом. Общая часть мотивации: тянет к тому, чтобы помогать соседу.',
        group: 'Команда',
    },
    permanent_client_threshold: {
        title: 'С какой покупки клиент постоянный',
        hint: 'Начиная с этой по счёту покупки клиент считается постоянным и заявка по нему оплачивается по высокой ставке.',
        group: 'Основа',
    },
    discount_bonus: {
        title: 'Премия за скидку',
        hint: 'Премия за то, что менеджер держит скидку в рамках: метрика, сторона сравнения, порог и сумма.',
        group: 'Качество',
    },
};

const EFFECTIVE_DATED_HINT =
    'Действует с указанной даты. Закрытые периоды не пересчитываются: люди уже получили деньги по прежним ставкам.';

/** Первое число следующего месяца — безопасная дата по умолчанию. */
export function nextMonthStart(today = new Date()): string {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    return d.toISOString().slice(0, 10);
}

function describe(key: string) {
    return (
        SALARY_TITLES[key] ?? {
            title: key,
            hint: 'Параметр мотивации, названия для него ещё нет. Влияет на расчёт зарплаты, поэтому показан как есть.',
            group: 'Прочее',
        }
    );
}

export const salaryAdapter: ModuleAdapter = {
    id: 'salary',

    async list(): Promise<KnobValue[]> {
        // Берём действующий на сегодня срез, а не все версии: вопрос «сколько
        // сейчас» задают в сто раз чаще, чем «что было в марте», а историю
        // модель при нужде поднимет отдельным запросом.
        const config = await getResolvedConfig(new Date());
        return (Object.keys(SALARY_CONFIG_SCHEMAS) as SalaryConfigKey[]).map((key) => {
            const meta = describe(key);
            const raw = (config as Record<string, unknown>)[key];
            return {
                id: `salary.${key}`,
                module: 'salary' as const,
                title: meta.title,
                hint: `${meta.hint} ${EFFECTIVE_DATED_HINT}`,
                kind: 'json' as const,
                group: meta.group,
                effectiveDated: true,
                value: JSON.stringify(raw),
                raw,
            };
        });
    },

    async validate(knobId: string, value: string, opts: ProposalOptions): Promise<string> {
        const key = knobKey(knobId) as SalaryConfigKey;
        if (!(key in SALARY_CONFIG_SCHEMAS)) throw new Error(`Неизвестный параметр мотивации: ${key}`);
        if (!opts.effectiveFrom) throw new Error('Для мотивации нужна дата, с которой значение действует');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.effectiveFrom)) {
            throw new Error('Дата в виде ГГГГ-ММ-ДД');
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(value);
        } catch {
            throw new Error('Значение мотивации задаётся в JSON: число, объект или массив порогов');
        }
        // Проверяем той же схемой, что и расчёт: второй набор правил разошёлся
        // бы с первым, и разошёлся бы в деньгах.
        const validated = validateConfigValue(key, parsed);
        return JSON.stringify(validated);
    },

    async apply(knobId: string, value: string, opts: ApplyOptions): Promise<void> {
        const key = knobKey(knobId);
        if (!opts.effectiveFrom) throw new Error('Для мотивации нужна дата, с которой значение действует');
        await updateConfig({
            key,
            value: JSON.parse(value),
            effectiveFrom: opts.effectiveFrom,
            actor: opts.actor,
            note: opts.note,
        });
    },
};

/**
 * План продаж — отдельная подсистема, хотя и лежит рядом с мотивацией: у него
 * своя сетка (год, месяц, менеджер), и «плана» как одного значения не бывает.
 * Ручка здесь одна на месяц: общий план отдела. Личные планы правятся пофамильно
 * на своём экране — предлагать их моделью значит предлагать двенадцать чисел
 * разом, а такое подтверждают глядя в таблицу, а не в чат.
 */
export const salaryPlanAdapter: ModuleAdapter = {
    id: 'salary_plan',

    async list(): Promise<KnobValue[]> {
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth() + 1;
        const { data, error } = await supabase
            .from('salary_plan')
            .select('year, month, target, metric')
            .is('manager_id', null)
            .eq('year', year)
            .eq('month', month)
            .maybeSingle();
        if (error) throw new Error(error.message);

        return [
            {
                id: `salary_plan.${year}-${String(month).padStart(2, '0')}`,
                module: 'salary_plan',
                title: `План отдела на ${String(month).padStart(2, '0')}.${year}`,
                hint: 'Цель отдела по выручке без НДС за этот месяц. От неё считается коэффициент команды в зарплате и от неё же бот-РОП считает, успевает ли отдел.',
                kind: 'money',
                group: 'План месяца',
                value: data ? String(data.target) : '',
            },
        ];
    },

    async validate(knobId: string, value: string): Promise<string> {
        const period = knobKey(knobId);
        if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Период плана в виде ГГГГ-ММ');
        const v = Number(value);
        if (!Number.isFinite(v) || v <= 0) throw new Error('План — положительное число рублей');
        return String(v);
    },

    async apply(knobId: string, value: string, opts: ApplyOptions): Promise<void> {
        const [year, month] = knobKey(knobId).split('-').map(Number);
        const metric = 'revenue_no_vat';

        // Не upsert: уникальность плана отдела задана ЧАСТИЧНЫМ индексом
        // (manager_id IS NULL), а на такой индекс onConflict не наводится —
        // вставка молча создала бы второй план на тот же месяц.
        const { data: existing, error: readErr } = await supabase
            .from('salary_plan')
            .select('id')
            .is('manager_id', null)
            .eq('year', year)
            .eq('month', month)
            .eq('metric', metric)
            .maybeSingle();
        if (readErr) throw new Error(readErr.message);

        if (existing) {
            const { error } = await supabase
                .from('salary_plan')
                .update({ target: Number(value), updated_at: new Date().toISOString() })
                .eq('id', existing.id);
            if (error) throw new Error(error.message);
            return;
        }

        const { error } = await supabase.from('salary_plan').insert({
            year,
            month,
            manager_id: null,
            metric,
            target: Number(value),
            created_by: opts.actor,
        });
        if (error) throw new Error(error.message);
    },
};
