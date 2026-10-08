import { supabase } from '@/utils/supabase';

/**
 * Подпись в письме клиенту: кто пишет и как с ним связаться.
 *
 * Просьба менеджеров 08.10.2026: «можно сюда добавить наши контактные данные и
 * менеджера?» — письма уходили за подписью «отдел продаж ЗМК», и клиенту было
 * некуда перезвонить и непонятно, с кем он говорил.
 *
 * Собирается в одном месте, потому что письма уходят из трёх: ответ в переписку
 * по заказу, письмо по шаблону и массовая рассылка по выбранным заказам. Раньше
 * подпись была только в первом.
 *
 * Имя и добавочный — из справочника менеджеров (закон «имена из RetailCRM»),
 * телефон и сайт компании — здесь, одной строкой на всю систему.
 */
const COMPANY_PHONE = '+7 (499) 350-44-90';
const COMPANY_SITE = 'https://zmktlt.ru';
const COMPANY_NAME = 'Завод металлических конструкций';
/** Общий ящик компании: письма уходят с него, туда же приходят ответы. */
const COMPANY_EMAIL = 'rop@zmktlt.ru';

export type Signature = { text: string; html: string };

export async function managerSignature(managerId: number | null | undefined): Promise<Signature | null> {
    if (managerId == null) return null;

    const { data } = await supabase
        .from('managers')
        .select('first_name, last_name, telphin_extension')
        .eq('id', managerId)
        .maybeSingle();

    const name = [data?.last_name, data?.first_name].filter(Boolean).join(' ').trim();
    if (!name) return null;

    const extension = data?.telphin_extension ? String(data.telphin_extension).trim() : '';
    // Добавочный пишем словом, а не цифрой в скобках: клиент должен понять, что
    // набрать после ответа автоответчика.
    const phone = extension ? `${COMPANY_PHONE}, добавочный ${extension}` : COMPANY_PHONE;

    const lines = [
        'С уважением,',
        name,
        'Менеджер отдела продаж',
        COMPANY_NAME,
        phone,
        COMPANY_EMAIL,
        COMPANY_SITE,
    ];

    return {
        text: lines.join('\n'),
        html: lines.map((l, i) => (i === 1 ? `<strong>${l}</strong>` : l)).join('<br>'),
    };
}

/**
 * Приклеить подпись к готовому письму.
 *
 * Если модель или шаблон уже закончили текст своим «С уважением…», этот хвост
 * срезаем: двух подписей в письме быть не должно.
 */
export function withSignature(body: string | undefined, signature: Signature | null, asHtml: boolean): string {
    const text = String(body ?? '');
    if (!signature) return text;

    const cut = text.search(/С уважением[,\s]/i);
    const head = (cut >= 0 ? text.slice(0, cut) : text).trimEnd();

    return asHtml
        ? `${head}<br><br>${signature.html}`
        : `${head}\n\n${signature.text}`;
}
