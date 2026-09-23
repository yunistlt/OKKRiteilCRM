import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { createChat, listChats } from '@/lib/shtab/tamara-chat';

export const dynamic = 'force-dynamic';

// GET  /api/shtab/tamara/chats — список разговоров.
// POST /api/shtab/tamara/chats — завести новый.

const CreateSchema = z.object({ title: z.string().trim().max(200).optional() });

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
        const withArchived = req.nextUrl.searchParams.get('archived') === '1';
        return NextResponse.json({ chats: await listChats(withArchived) });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
        const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) return NextResponse.json({ error: 'Некорректные данные' }, { status: 400 });
        return NextResponse.json(await createChat(parsed.data.title), { status: 201 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
