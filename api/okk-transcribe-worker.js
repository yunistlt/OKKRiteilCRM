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

function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  // если пришло что-то вроде +7(999)123-45-67 или 8-999-123-45-67
  s = s.replace(/[^0-9+]/g, '');
  // убираем ведущий +
  if (s.startsWith('+')) s = s.slice(1);
  // заменяем ведущую 8 на 7 для РФ
  if (s.length === 11 && s.startsWith('8')) {
    s = '7' + s.slice(1);
  }
  // если просто 10 цифр (без кода страны), добавим 7
  if (s.length === 10) {
    s = '7' + s;
  }
  return s;
}

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

    if (jobsError) {
      console.error('Failed to load jobs from queue:', jobsError);
      return res.status(500).json({ error: 'QUEUE_SELECT_ERROR' });
    }

    if (!jobs || jobs.length === 0) {
      return res.status(200).json({
        message: 'no jobs',
        results: [],
      });
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
        if (!audioResp.ok) {
          const errTxt = await audioResp.text().catch(() => '');
          throw new Error(
            `Failed to download audio file: ${audioResp.status} ${errTxt}`,
          );
        }

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
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: formData,
          },
        );

        if (!aiResp.ok) {
          const errTxt = await aiResp.text().catch(() => '');
          throw new Error(
            `OpenAI transcription error: ${aiResp.status} ${errTxt}`,
          );
        }

        const aiJson = await aiResp.json();
        const transcriptText = aiJson.text || '';

        //
        // 5. Готовим метаданные по звонку (номер, направление, время)
        //
        let direction = job.direction || null;
        let phone = job.phone || null;
        let callStartedAt = job.call_started_at || null;
        let durationSec = job.duration_sec || null;
        let rawPayload = job.raw_payload;

        let raw = rawPayload;
        if (raw && typeof raw === 'string') {
          try {
            raw = JSON.parse(raw);
          } catch (e) {
            raw = null;
          }
        }

        if (raw && typeof raw === 'object') {
          const flow = raw.flow || raw.direction || direction;
          if (!direction && flow) {
            direction = flow;
          }

          let fromNumber = null;
          let toNumber = null;

          if (flow === 'out') {
            fromNumber = raw.ani_number || raw.from_number;
            toNumber = raw.dest_number || raw.to_number;
          } else if (flow === 'in') {
            fromNumber = raw.ani_number || raw.from_number;
            toNumber =
              raw.from_number || raw.to_number || raw.dest_number;
          }

          const fromNorm = normalizePhone(fromNumber);
          const toNorm = normalizePhone(toNumber);

          if (!phone) {
            phone = flow === 'in' ? fromNorm : toNorm;
          }

          if (!callStartedAt) {
            const startedRaw = raw.start_time_gmt || raw.init_time_gmt;
            if (startedRaw) {
              callStartedAt = new Date(`${startedRaw}Z`).toISOString();
            }
          }

          if (!durationSec && raw.duration) {
            durationSec = raw.duration;
          }
        }

        //
        // 6. СОЗДАЁМ ПОЛНОЦЕННЫЙ ЗВОНОК В okk_calls
        //
        const { data: insertedCall, error: insertError } = await supabase
          .from('okk_calls')
          .insert({
            call_started_at: callStartedAt,
            duration_sec: durationSec,
            direction,
            phone,
            manager_id: job.manager_id,
            order_id: job.order_id,
            record_url: job.recording_url,
            transcript_text: transcriptText,
            transcript_status: 'done',
            transcript_provider: 'gpt-4o-mini-transcribe',
            transcript_raw: aiJson,
            raw_payload: rawPayload,
            call_date: callStartedAt,
            duration_seconds: durationSec,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) throw insertError;

        //
        // 7. Обновляем статус задачи в очереди
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
    return res
      .status(500)
      .json({ error: String(err.message || err) });
  }
}
