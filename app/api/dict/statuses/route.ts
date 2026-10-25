import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { loadStatusDirectory } from '@/lib/own-crm/status-code';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // Справочник статусов — с доски «Статусы и переходы», одна функция на проект.
        const rows = (await loadStatusDirectory()).map((row) => ({
            code: row.code,
            name: row.name,
            group_name: row.groupName,
            color: row.color,
            ordering: row.ordering,
        }));

        return NextResponse.json(rows);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
