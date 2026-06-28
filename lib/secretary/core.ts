// Логика AI-секретаря: поиск заказа по номеру и распределение нового заказа по нагрузке.
import { supabase } from '@/utils/supabase';

export interface FoundOrder {
    id: number;
    number: string | null;
    manager_id: number | null;
    status: string | null;
    phone: string | null;
}

export interface PickedManager {
    id: number;
    name: string;
    extension: string;
}

/** Найти заказ по его номеру RetailCRM (orders.number — текст; номер приходит донабором DTMF). */
export async function findOrderByNumber(num: string): Promise<FoundOrder | null> {
    const clean = (num || '').trim();
    if (!clean) return null;
    const { data } = await supabase
        .from('orders')
        .select('id, number, manager_id, status, phone')
        .eq('number', clean)
        .maybeSingle();
    return (data as FoundOrder) || null;
}

/** Менеджер по id (для имени и добавочного при переводе на «текущий заказ»). */
export async function getManagerById(id: number) {
    const { data } = await supabase
        .from('managers')
        .select('id, first_name, last_name, telphin_extension')
        .eq('id', id)
        .maybeSingle();
    return data as { id: number; first_name: string | null; last_name: string | null; telphin_extension: string | null } | null;
}

/**
 * Выбрать наименее загруженного менеджера для новой заявки.
 * Кандидаты: активные менеджеры с заданным добавочным Телфина.
 * Нагрузка = число заказов в рабочих статусах (status_settings.is_working).
 * Тай-брейк — выше рейтинг. Менеджеры на пределе (>= max_load) пропускаются.
 */
export async function pickLeastLoadedManager(): Promise<PickedManager | null> {
    const { data: workingSettings } = await supabase
        .from('status_settings')
        .select('code')
        .eq('is_working', true);
    const workingCodes = (workingSettings || []).map((s: { code: string }) => s.code);

    const { data: managers } = await supabase
        .from('managers')
        .select('id, first_name, last_name, telphin_extension, max_load, rating, active');

    const candidates = (managers || []).filter(
        (m: { active?: boolean; telphin_extension?: string | null }) =>
            m.active && m.telphin_extension && String(m.telphin_extension).trim(),
    );
    if (!candidates.length) return null;

    let best: any = null;
    let bestLoad = Infinity;

    for (const m of candidates) {
        let load = 0;
        if (workingCodes.length) {
            const { count } = await supabase
                .from('orders')
                .select('id', { count: 'exact', head: true })
                .eq('manager_id', m.id)
                .in('status', workingCodes);
            load = count || 0;
        }
        const max = m.max_load || 20;
        if (load >= max) continue;

        const better = load < bestLoad || (load === bestLoad && (m.rating || 0) > (best?.rating || 0));
        if (better) {
            best = m;
            bestLoad = load;
        }
    }

    if (!best) return null;
    return {
        id: best.id,
        name: `${best.first_name || ''} ${best.last_name || ''}`.trim(),
        extension: String(best.telphin_extension).trim(),
    };
}
