import { externalDbConfigured, queryExternal } from '@/lib/shtab/external/client';

// Люди и их документы в ЦехУспехе. Только чтение, как и всё в external/.
//
// Свой список фамилий не заводится: штат ведётся там, и вторая копия разошлась
// бы с ним на первой смене кадров.

/** Arh = 0 — закон «только активные»: уволенных не показываем вовсе. */
const SQL_PEOPLE = `
SELECT u.ID AS id, u.FIO AS fio, p.NamePosition AS position,
       d.NameDepartment AS department, w.NameWorkShop AS workshop, u.DateGotWork AS hired_on
FROM Users u
LEFT JOIN positions p ON p.ID = u.IDPosition
LEFT JOIN departments d ON d.ID = u.IDDepartment
LEFT JOIN workshops w ON w.ID = u.IDWorkShop
WHERE u.Arh = 0
ORDER BY u.FIO`;

/** Список документов по сотрудникам. Тело файла не тянем — только опись. */
const SQL_STAFF_DOCS = `
SELECT d.ID AS id, d.IDUser AS user_id, u.FIO AS fio, d.NameFile AS file_name,
       LENGTH(d.File) AS size_bytes, d.DateChangeFile AS changed_at
FROM documentsfilesstaff d
LEFT JOIN Users u ON u.ID = d.IDUser
ORDER BY d.DateChangeFile DESC`;

const SQL_STAFF_DOC_ONE = `
SELECT d.ID AS id, d.IDUser AS user_id, u.FIO AS fio, d.NameFile AS file_name, d.File AS body
FROM documentsfilesstaff d
LEFT JOIN Users u ON u.ID = d.IDUser
WHERE d.ID = ?`;

export type TsehPerson = {
    id: string;
    fio: string;
    position: string;
    department: string;
    workshop: string;
    hired_on: string | null;
};

export async function tsehPeople(): Promise<{ people: TsehPerson[]; available: boolean; reason?: string }> {
    if (!externalDbConfigured('tseh')) {
        return { people: [], available: false, reason: 'База ЦехУспеха не настроена' };
    }
    try {
        const rows = (await queryExternal('tseh', SQL_PEOPLE, [])) as any[];
        return {
            available: true,
            people: rows.map((r) => ({
                id: String(r.id),
                fio: r.fio ?? '',
                position: r.position ?? '',
                department: r.department ?? '',
                workshop: r.workshop ?? '',
                hired_on: r.hired_on ? String(r.hired_on).slice(0, 10) : null,
            })),
        };
    } catch (e: any) {
        // Мягкая деградация: без ЦехУспеха посты просто остаются вакансиями.
        return { people: [], available: false, reason: e.message };
    }
}

export type TsehStaffDoc = { id: string; user_id: string; fio: string; file_name: string; size_bytes: number; changed_at: string | null };

export async function tsehStaffDocs(): Promise<{ docs: TsehStaffDoc[]; available: boolean; reason?: string }> {
    if (!externalDbConfigured('tseh')) {
        return { docs: [], available: false, reason: 'База ЦехУспеха не настроена' };
    }
    try {
        const rows = (await queryExternal('tseh', SQL_STAFF_DOCS, [])) as any[];
        return {
            available: true,
            docs: rows.map((r) => ({
                id: String(r.id),
                user_id: String(r.user_id ?? ''),
                fio: r.fio ?? '',
                file_name: r.file_name ?? 'без имени',
                size_bytes: Number(r.size_bytes ?? 0),
                changed_at: r.changed_at ? String(r.changed_at).slice(0, 10) : null,
            })),
        };
    } catch (e: any) {
        return { docs: [], available: false, reason: e.message };
    }
}

/** Тело документа. Файл лежит в BLOB — в ЦехУспехе это программа на Delphi. */
export async function tsehStaffDocBody(
    id: string | number,
): Promise<{ file_name: string; fio: string; user_id: string; buffer: Buffer } | null> {
    const rows = (await queryExternal('tseh', SQL_STAFF_DOC_ONE, [Number(id)])) as any[];
    const row = rows[0];
    if (!row?.body) return null;
    return {
        file_name: row.file_name || `doc-${id}`,
        fio: row.fio ?? '',
        user_id: String(row.user_id ?? ''),
        buffer: Buffer.isBuffer(row.body) ? row.body : Buffer.from(row.body),
    };
}
