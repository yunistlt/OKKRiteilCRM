import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getDefaultPathForRole } from '@/lib/rbac';
import { gateState, openGate } from '@/lib/read-gate/service';
import ReadGateClient from './ReadGateClient';

export const dynamic = 'force-dynamic';

/**
 * Страница документа, который нужно прочитать до начала работы.
 *
 * Пока документ не подтверждён, сюда ведут все остальные маршруты. Если читать
 * нечего — человека возвращаем на его рабочий экран, а не держим на пустой
 * странице.
 */
export default async function ReadGatePage() {
    const session = await getSession();
    if (!session) redirect('/login');

    const user = session.user;
    const state = await gateState(user.id, user.role, user.retail_crm_manager_id ?? null);
    if (!state.blocked) redirect(getDefaultPathForRole(user.role));

    const row = await openGate(user.id, state.document, state.settings);

    return (
        <ReadGateClient
            gateId={row.id}
            requiredSeconds={row.required_seconds}
            visibleSeconds={row.visible_seconds}
            scrolledToEnd={row.scrolled_to_end}
            deferUsedToday={!!row.deferred_at}
            deferMinutes={state.settings.deferMinutes}
            title={state.document.title}
            dateLabel={state.document.dateLabel ?? null}
            body={state.document.body}
        />
    );
}
