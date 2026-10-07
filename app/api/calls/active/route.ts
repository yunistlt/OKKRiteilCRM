/**
 * Звонки, которые идут прямо сейчас, — для всплывающего окна.
 *
 * Жалоба Евгении Матвеевой 07.10.2026: «оповещения по звонкам приходят с
 * задержкой примерно в минуту после окончания звонка. Можно сделать так, чтобы
 * оповещение выскакивало на экране мгновенно, в момент, когда клиент звонит?
 * Иначе мы в момент звонка не понимаем, кто звонит».
 *
 * Почему окно не всплывало. Оно слушало изменения таблицы `active_calls`
 * напрямую из браузера, а браузер подключается к базе АНОНИМНО: вход в ОКК
 * свой, в Supabase Auth мы не логинимся. Читать `active_calls` разрешено
 * только роли authenticated — анонимный слушатель не получал ни одного
 * события. Работал только опрос раз в минуту по УЖЕ ЗАВЕРШЁННЫМ звонкам
 * (`/api/calls/alerts`), отсюда и «через минуту после окончания».
 *
 * Поэтому отдаём звонки своим маршрутом: здесь есть наша сессия, и кому
 * показывать звонок, решает сервер, а не браузер. Анонимный доступ к номерам
 * клиентов открывать не стали — ключ браузера публичный.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enrichSessionWithManagerIdentity } from '@/lib/manager-identity';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await enrichSessionWithManagerIdentity(await getSession());
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    // Руководитель, ОКК и администратор видят звонки всего отдела — им нужна
    // картина целиком (решение владельца 05.10.2026).
    const seeAll = hasAnyRole(session, ['admin', 'okk', 'rop']);

    let extension: string | null = null;
    const managerId = session.user.retail_crm_manager_id;
    if (managerId) {
        const { data } = await supabase
            .from('managers')
            .select('telphin_extension')
            .eq('id', managerId)
            .maybeSingle();
        const value = (data as any)?.telphin_extension;
        extension = value ? String(value).trim() : null;
    }

    const { data: rows } = await supabase
        .from('active_calls')
        .select('telphin_call_id, direction, from_number, to_number, extension_number, extensions, is_queue, client_name, client_id, order_id, order_number, status, started_at')
        .order('started_at', { ascending: false })
        .limit(10);

    const calls = ((rows ?? []) as any[]).filter((call) => {
        if (seeAll) return true;
        // Очередь звонит у нескольких сразу — окно видят все, кто в ней.
        if (call.is_queue) return true;
        if (!extension) return false;
        // Перевод по внутреннему: окно видит и тот, кому звонили сначала, и
        // тот, на кого перевели.
        const all: string[] = Array.isArray(call.extensions) ? call.extensions : [];
        return all.includes(extension) || call.extension_number === extension;
    });

    return NextResponse.json({ calls, extension, seeAll });
}
