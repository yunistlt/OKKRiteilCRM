import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { externalDbConfigured, queryExternal } from '@/lib/shtab/external/client';

export const dynamic = 'force-dynamic';

// GET /api/shtab/people — живые сотрудники из ЦехУспеха, чтобы сажать их на посты.
//
// Людей не заводим у себя: штат ведётся в ЦехУспехе, и второй список фамилий
// разошёлся бы с ним на первой же смене кадров. Здесь только чтение.
//
// Arh = 0 — закон «только активные сущности»: уволенных не показываем вовсе,
// иначе на схему сядет человек, которого в компании нет.

const SQL_PEOPLE = `
SELECT u.ID AS id, u.FIO AS fio, p.NamePosition AS position,
       d.NameDepartment AS department, w.NameWorkShop AS workshop, u.DateGotWork AS hired_on
FROM Users u
LEFT JOIN positions p ON p.ID = u.IDPosition
LEFT JOIN departments d ON d.ID = u.IDDepartment
LEFT JOIN workshops w ON w.ID = u.IDWorkShop
WHERE u.Arh = 0
ORDER BY u.FIO`;

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        if (!externalDbConfigured('tseh')) {
            // Мягкая деградация: посты и схема работают и без ЦехУспеха, просто
            // держателя придётся вписать руками.
            return NextResponse.json({ people: [], available: false, reason: 'База ЦехУспеха не настроена' });
        }

        const rows = (await queryExternal('tseh', SQL_PEOPLE, [])) as any[];
        return NextResponse.json({
            people: rows.map((r) => ({
                id: String(r.id),
                fio: r.fio ?? '',
                position: r.position ?? '',
                department: r.department ?? '',
                workshop: r.workshop ?? '',
                hired_on: r.hired_on ? String(r.hired_on).slice(0, 10) : null,
            })),
            available: true,
        });
    } catch (e: any) {
        return NextResponse.json({ people: [], available: false, reason: e.message });
    }
}
