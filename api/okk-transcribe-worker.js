// api/okk-transcribe-worker.js
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import FormData from 'form-data';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  try {
    //
    // 1. Берём задачи из очереди
    //
    const { data: jobs, error: jobsError } = await supabase
      .from('okk_calls_transcribe_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5);

    if (jobsError) throw jobsError;

    if (!jobs || jobs.length === 0) {
      return res.status(200).json({ message: 'no pending jobs' });
    }

    for (const job of jobs) {
      try {
        //
        // Помечаем задачу как processing
        //
        await supabase
          .from('okk_calls_transcribe_queue')
          .update({ status: 'processing' })
          .eq('id', job.id);

        //
        // 2. Скачиваем аудио по ссылке Telphin
        //
        const audioResp = await fetch(job.recording_url);
        if (!audioResp.ok) throw new Error('Failed to download audio file');

        const audioBuffer = Buffer.from(await audioResp.arrayBuffer());

        //
        // 3. Отправляем аудио в модель gpt-4o-mini-transcribe
        //
        const formData = new FormData();
        formData.append('file', audioBuffer, { filename: 'call.mp3' });
        formData.append('model', 'gpt-4o-mini-transcribe');

        const aiResp = await fetch(
          'https://api.openai.com/v1/audio/transcriptions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: formData,
          }
        );

        if (!aiResp.ok) {
          const txt = await aiResp.text();
          throw new Error('AI error: ' + txt);
        }

        const aiJson = await aiResp.json();
        const transcriptText = aiJson.text || '';

        //
        // 4. Сохраняем результат в таблицу okk_calls
        //
        await supabase
          .from('okk_calls')
          .update({
            transcript_text: transcriptText,
            transcript_status: 'done',
            transcript_provider: 'gpt-4o-mini-transcribe',
            transcript_raw: aiJson,
          })
          .eq('id', job.call_id);

        //
        // 5. Обновляем статус задачи
        //
        await supabase
          .from('okk_calls_transcribe_queue')
          .update({
            status: 'done',
            error_message: null,
          })
          .eq('id', job.id);
      } catch (e) {
        //
        // Любая ошибка → помечаем задачу как error
        //
        await supabase
          .from('okk_calls_transcribe_queue')
          .update({
            status: 'error',
            error_message: String(e.message || e),
          })
          .eq('id', job.id);

        await supabase
          .from('okk_calls')
          .update({
            transcript_status: 'error',
          })
          .eq('id', job.call_id);
      }
    }

    res.status(200).json({
      message: 'processed',
      count: jobs.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
}
