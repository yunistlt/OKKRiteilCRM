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

    const results = [];

    for (const job of jobs) {
      try {
        //
        // 2. Помечаем задачу как processing
        //
        await supabase
          .from('okk_calls_transcribe_queue')
          .update({ status: 'processing' })
          .eq('id', job.id);

        //
        // 3. Скачиваем аудио
        //
        const audioResp = await fetch(job.recording_url);
        if (!audioResp.ok) throw new Error('Failed to download audio file');

        const audioBuffer = Buffer.from(await audioResp.arrayBuffer());

        //
        // 4. Отправляем аудио в OpenAI (gpt-4o-mini-transcribe)
        //
        const formData = new FormData();
        formData.append('file', audioBuffer, { filename: 'call.mp3' });
        formData.append('model', 'gpt-4o-mini-transcribe');

        const aiResp = await fetch(
          'https://api.openai.com/v1/audio/transcriptions',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
            body: formData,
          }
        );

        if (!aiResp.ok) {
          const errTxt = await aiResp.text();
          throw new Error('AI error: ' + errTxt);
        }

        const aiJson = await aiResp.json();
        const transcriptText = aiJson.text || '';

        //
        // 5. СОЗДАЁМ ПОЛНОЦЕННЫЙ ЗВОНОК В okk_calls
        //
        const { data: insertedCall, error: insertError } = await supabase
          .from('okk_calls')
          .insert({
            call_started_at: job.call_started_at,
            duration_sec: job.duration_sec,
            direction: job.direction,
            phone: job.phone,
            manager_id: job.manager_id,
            order_id: job.order_id,
            record_url: job.recording_url,
            transcript_text: transcriptText,
            transcript_status: 'done',
            transcript_provider: 'gpt-4o-mini-transcribe',
            transcript_raw: aiJson,
            raw_payload: job.raw_payload,
            call_date: job.call_started_at,
            duration_seconds: job.duration_sec,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) throw insertError;

        //
        // 6. Помечаем задачу как выполненную
        //
        await supabase
          .from('okk_calls_transcribe_queue')
          .update({
            status: 'done',
            error_message: null,
          })
          .eq('id', job.id);

        results.push({
          job_id: job.id,
          call_id: insertedCall?.id,
          status: 'done',
        });
      } catch (err) {
        //
        // Ошибка обработки одного звонка
        //
        await supabase
          .from('okk_calls_transcribe_queue')
          .update({
            status: 'error',
            error_message: String(err.message || err),
          })
          .eq('id', job.id);

        results.push({
          job_id: job.id,
          status: 'error',
          error: String(err.message || err),
        });
      }
    }

    return res.status(200).json({
      message: 'processed',
      results,
    });
  } catch (err) {
    console.error('Transcribe worker failed:', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
