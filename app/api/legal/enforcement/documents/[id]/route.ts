// Ссылка на сам файл документа: посмотреть в карточке и скачать.
//
// Файлы лежат в закрытом хранилище, прямой ссылки у них нет — отдаём подписанную,
// живущую недолго. Без этого юрист видел только имя файла и «ждёт разбора», а что
// именно в постановлении — проверить не мог.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/** Сколько живёт ссылка: хватает посмотреть и скачать, но её нельзя разослать. */
const LINK_TTL_SECONDS = 300;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const documentId = Number(params.id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      return NextResponse.json({ error: 'Неверный идентификатор документа' }, { status: 400 });
    }

    const { data: doc, error } = await supabase
      .from('legal_enforcement_documents')
      .select('id, case_id, file_name, content_type, file_size_bytes, storage_bucket, storage_path, upload_status, scan_status')
      .eq('id', documentId)
      .maybeSingle();
    if (error) throw error;
    if (!doc) return NextResponse.json({ error: 'Документ не найден' }, { status: 404 });

    if (doc.upload_status !== 'uploaded') {
      return NextResponse.json({ error: 'Файл ещё не загрузился до конца' }, { status: 409 });
    }

    // Заражённый файл не отдаём даже по прямой просьбе: открыть его — значит открыть
    // заразу на машине юриста.
    if (doc.scan_status === 'infected') {
      return NextResponse.json({ error: 'Файл помечен антивирусом как заражённый и не выдаётся' }, { status: 423 });
    }

    const download = new URL(request.url).searchParams.get('download') === '1';

    const { data: signed, error: signError } = await supabase.storage
      .from(doc.storage_bucket)
      .createSignedUrl(doc.storage_path, LINK_TTL_SECONDS, download ? { download: doc.file_name } : undefined);

    if (signError || !signed?.signedUrl) {
      throw signError || new Error('Не удалось получить ссылку на файл');
    }

    return NextResponse.json({
      url: signed.signedUrl,
      file_name: doc.file_name,
      content_type: doc.content_type,
      file_size_bytes: doc.file_size_bytes,
      expires_in: LINK_TTL_SECONDS,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось открыть файл' }, { status: 500 });
  }
}
