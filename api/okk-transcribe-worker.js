// api/okk-transcribe-worker.js
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY, // или твой AI
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  try {
    // 1. Берём пачку задач из очереди
    const { data: jobs, error: jobsError } = await supabase
      .from('okk_calls_transcribe_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);

    if (jobsError) throw jobsError;
    if (!jobs || jobs.length === 0) {
      return res.status(200).json({ message: 'no jobs' });
    }

    for (const job of jobs) {
      try {
        // помечаем как processing
        await supabase
          .from('okk_calls_transcribe_queue')
          .update({ status: 'processing' })
          .eq('id', job.id);

        // 2. качаем аудио по ссылке
        const audioResp = await fetch(job.recording_url);
        if (!audioResp.ok) throw new Error('cannot download audio');
        const audioBuffer = await audioResp.arrayBuffer();
        const audioFile = Buffer.from(audioBuffer);

        // 3. отправляем в AI (пример с OpenAI Whisper)
        const formData = new FormData();
        formData.append(
          'file',
          new Blob([audioFile]),
          'call.mp3'
        );
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
          throw new Error('AI error ' + (await aiResp.text()));
        }

        const aiJson = await aiResp.json();
        const transcriptText = aiJson.text || '';

        // 4. сохраняем транскрибацию в okk_calls
        await supabase
          .from('okk_calls')
          .update({
            transcript: transcriptText,
            transcript_status: 'done',
          })
          .eq('id', job.call_id);

        // 5. помечаем задачу как done
        await supabase
          .from('okk_calls_transcribe_queue')
          .update({ status: 'done', error_message: null })
          .eq('id', job.id);
      } catch (e) {
        // фиксируем ошибку по конкретной задаче
        await supabase
          .from('okk_calls_transcribe_queue')
          .update({
            status: 'error',
            error_message: String(e.message || e),
          })
          .eq('id', job.id);

        await supabase
          .from('okk_calls')
          .update({ transcript_status: 'error' })
          .eq('id', job.call_id);
      }
    }

    res.status(200).json({ message: 'ok', processed: jobs.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
}
