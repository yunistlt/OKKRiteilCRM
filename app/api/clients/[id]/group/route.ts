/**
 * Группа компаний карточки клиента: показать, создать, присоединить, убрать.
 *
 * Решение владельца 06.10.2026: несколько юрлиц одного покупателя считаются
 * одним клиентом. Группы ведут менеджеры руками.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { groupOfClient, createGroup, addToGroup, addCompanies, removeFromGroup } from '@/lib/own-crm/company-groups';

export const dynamic = 'force-dynamic';

function actorOf(session: any): string | null {
    return session?.user?.username || session?.user?.email || null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const clientId = Number(params.id);
    if (!Number.isFinite(clientId)) return NextResponse.json({ error: 'Неверный номер карточки' }, { status: 400 });

    return NextResponse.json({ group: await groupOfClient(clientId) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const clientId = Number(params.id);
    if (!Number.isFinite(clientId)) return NextResponse.json({ error: 'Неверный номер карточки' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const actor = actorOf(session);

    try {
        // Менеджер выбрал компании в окне — присоединяем их к группе этой
        // карточки, а если группы ещё нет, заводим её тем же действием.
        if (Array.isArray(body.add) && body.add.length) {
            const group = await addCompanies(clientId, body.add, String(body.name || ''), actor);
            return NextResponse.json({ group });
        }
        if (body.groupId) {
            await addToGroup(Number(body.groupId), clientId, actor);
            return NextResponse.json({ group: await groupOfClient(clientId) });
        }
        if (body.name) {
            return NextResponse.json({ group: await createGroup(String(body.name), clientId, actor) });
        }
        return NextResponse.json({ error: 'Укажите название новой группы или выберите готовую' }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const clientId = Number(params.id);
    if (!Number.isFinite(clientId)) return NextResponse.json({ error: 'Неверный номер карточки' }, { status: 400 });

    await removeFromGroup(clientId);
    return NextResponse.json({ group: null });
}
