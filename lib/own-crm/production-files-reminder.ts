/**
 * Заказ передан в производство, а файлов для цеха нет — напомнить менеджеру.
 *
 * Доработка №85 (Евгения Матвеева 09.11.2026), решение владельца 23.11.2026:
 * всплывающее окно «заказ отправлен в производство, но никаких файлов не
 * отправлено — прикрепите файлы, важные для производства». За 30 дней до
 * 23.11.2026 в цех ушёл 31 заказ, из них 5 — без единого файла.
 *
 * «Файл отправлен» — это файл заказа с отметкой «для производства»: ЦехУспех
 * забирает именно их (`/api/external/tseh/orders/[number]/files`), и забирает
 * в любой момент. Поэтому приложить файл после передачи не поздно — ради этого
 * и напоминаем.
 *
 * Напоминаем, пока заказ стоит в статусе передачи в производство: в него
 * заказ попадает и руками, и сам после оплаты, а менеджера при автопереводе
 * рядом нет — он увидит окно, когда откроет карточку. Дальше по этапам заказ
 * уже в работе у цеха, и окно там только мешало бы.
 */
import { supabase } from '@/utils/supabase';
import { PRODUCTION_STATUS } from '@/lib/payments/production';

export async function productionFilesMissing(orderNumber: string): Promise<boolean> {
    const number = String(orderNumber ?? '').trim();
    if (!number) return false;

    const [{ data: order }, { data: queued }, { count }] = await Promise.all([
        supabase.from('orders').select('status').eq('number', number).maybeSingle(),
        supabase.from('tseh_production_outbox').select('id').eq('order_number', number).maybeSingle(),
        supabase
            .from('order_files')
            .select('id', { count: 'exact', head: true })
            .eq('order_number', number)
            .eq('for_production', true)
            .is('deleted_at', null)
            // Архивный файл цех не получит — его не считаем.
            .is('archived_at', null),
    ]);

    if (String((order as any)?.status ?? '') !== PRODUCTION_STATUS) return false;
    if (!queued) return false;
    return !count;
}
