'use client';

import { useEffect, useMemo, useState } from 'react';
import { uploadFileToSignedStorageUrl } from '@/lib/supabase-browser';

type ReviewItem = {
  id: number;
  order_id: number;
  title: string | null;
  file_name: string | null;
  content_type: string | null;
  file_size_bytes: number | null;
  upload_status: string | null;
  scan_status: string | null;
  analysis_status: string | null;
  analysis_error: string | null;
  risk_score: 'green' | 'yellow' | 'red' | null;
  extracted_data?: {
    evaluation?: {
      summary?: string;
      issues?: Array<{ title?: string; severity?: string }>;
    };
    warnings?: string[];
  } | null;
  reviewed_at: string | null;
  updated_at: string | null;
};

const DEFAULT_ORDER_ID = '1';

function formatFileSize(value: number | null) {
  if (!value) return '—';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function statusTone(status: string | null) {
  if (status === 'uploaded') return 'bg-emerald-100 text-emerald-700';
  if (status === 'failed') return 'bg-rose-100 text-rose-700';
  if (status === 'pending') return 'bg-amber-100 text-amber-800';
  if (status === 'processing') return 'bg-blue-100 text-blue-700';
  if (status === 'queued') return 'bg-slate-200 text-slate-700';
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'manual_review_required') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-600';
}

function riskTone(riskScore: string | null) {
  if (riskScore === 'red') return 'bg-rose-100 text-rose-700';
  if (riskScore === 'yellow') return 'bg-amber-100 text-amber-800';
  if (riskScore === 'green') return 'bg-emerald-100 text-emerald-700';
  return 'bg-slate-100 text-slate-600';
}

export default function LegalContractUploadPanel() {
  const [orderId, setOrderId] = useState(DEFAULT_ORDER_ID);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analyzingReviewId, setAnalyzingReviewId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const normalizedOrderId = useMemo(() => Number(orderId), [orderId]);

  const loadReviews = async (targetOrderId: number) => {
    if (!Number.isFinite(targetOrderId) || targetOrderId <= 0) {
      setReviews([]);
      return;
    }

    setLoadingReviews(true);
    try {
      const response = await fetch(`/api/legal/contracts/reviews?orderId=${targetOrderId}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось загрузить ревью');
      }
      setReviews(Array.isArray(data.reviews) ? data.reviews : []);
    } catch (requestError: any) {
      setError(requestError?.message || 'Не удалось загрузить ревью');
    } finally {
      setLoadingReviews(false);
    }
  };

  useEffect(() => {
    if (Number.isFinite(normalizedOrderId) && normalizedOrderId > 0) {
      void loadReviews(normalizedOrderId);
    }
  }, [normalizedOrderId]);

  const handleUpload = async () => {
    if (!file) {
      setError('Выберите файл договора');
      return;
    }

    if (!Number.isFinite(normalizedOrderId) || normalizedOrderId <= 0) {
      setError('Укажите корректный orderId');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const prepareResponse = await fetch('/api/legal/contracts/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: normalizedOrderId,
          title: title.trim() || file.name,
          file_name: file.name,
          file_type: file.type || 'application/octet-stream',
          file_size: file.size,
        }),
      });
      const prepareData = await prepareResponse.json();
      if (!prepareResponse.ok) {
        throw new Error(prepareData?.error || 'Не удалось подготовить загрузку');
      }

      await uploadFileToSignedStorageUrl({
        bucket: prepareData.bucket,
        filePath: prepareData.file_path,
        token: prepareData.token,
        file,
        upsert: false,
      });

      const completeResponse = await fetch('/api/legal/contracts/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          review_id: prepareData.review.id,
          upload_status: 'uploaded',
        }),
      });
      const completeData = await completeResponse.json();
      if (!completeResponse.ok) {
        throw new Error(completeData?.error || 'Не удалось завершить загрузку');
      }

      setSuccess(completeData.summary || 'Файл загружен');
      setFile(null);
      setTitle('');
      await loadReviews(normalizedOrderId);
    } catch (requestError: any) {
      setError(requestError?.message || 'Ошибка загрузки договора');
    } finally {
      setUploading(false);
    }
  };

  const runAnalysis = async (reviewId: number) => {
    setAnalyzingReviewId(reviewId);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/legal/contracts/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_id: reviewId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось проанализировать договор');
      }

      if (data?.evaluation?.summary) {
        setSuccess(data.evaluation.summary);
      } else if (data?.review?.analysis_status === 'manual_review_required') {
        setSuccess('Автоизвлечение неполное: файл переведён в ручную валидацию.');
      } else {
        setSuccess('Анализ завершён.');
      }

      await loadReviews(normalizedOrderId);
    } catch (requestError: any) {
      setError(requestError?.message || 'Ошибка анализа договора');
    } finally {
      setAnalyzingReviewId(null);
    }
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Contracts MVP</div>
          <h2 className="mt-2 text-xl font-bold text-slate-900">Загрузка договоров</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Foundation для contract review: ограничения типов и размера, signed upload в storage, review-запись в БД и статусы upload/scan/analyze.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          Антивирусный движок ещё не подключён.
          <br />
          Новые файлы помечаются как pending scan и требуют ручного контроля.
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm text-slate-700">
              <span className="mb-2 block font-medium">Order ID</span>
              <input
                value={orderId}
                onChange={(event) => setOrderId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="Например, 12345"
              />
            </label>

            <label className="block text-sm text-slate-700">
              <span className="mb-2 block font-medium">Название ревью</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="Договор поставки / redlines клиента"
              />
            </label>
          </div>

          <label className="mt-4 block text-sm text-slate-700">
            <span className="mb-2 block font-medium">Файл</span>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              className="block w-full rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-600"
            />
          </label>

          {file ? (
            <div className="mt-3 rounded-xl bg-white px-3 py-3 text-sm text-slate-600">
              {file.name} · {formatFileSize(file.size)} · {file.type || 'unknown'}
            </div>
          ) : null}

          {error ? <div className="mt-4 text-sm text-rose-600">{error}</div> : null}
          {success ? <div className="mt-4 text-sm text-emerald-700">{success}</div> : null}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={uploading || !file}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploading ? 'Загрузка...' : 'Загрузить договор'}
            </button>
            <span className="text-xs text-slate-500">Поддерживаются PDF, DOC, DOCX, TXT до 25 MB.</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">История ревью по заказу</div>
              <div className="text-xs text-slate-500">Здесь видно, что уже загружено и на каком этапе обработка.</div>
            </div>
            <button
              type="button"
              onClick={() => void loadReviews(normalizedOrderId)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Обновить
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {loadingReviews ? <div className="text-sm text-slate-500">Загрузка ревью...</div> : null}
            {!loadingReviews && reviews.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                По этому заказу пока нет загруженных договоров.
              </div>
            ) : null}

            {reviews.map((review) => (
              <div key={review.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{review.title || review.file_name || `Review #${review.id}`}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {review.file_name || '—'} · {formatFileSize(review.file_size_bytes)}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusTone(review.upload_status)}`}>
                    {review.upload_status || 'unknown'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium text-slate-600">
                  <span className={`rounded-full px-2 py-1 ${statusTone(review.scan_status)}`}>scan: {review.scan_status || '—'}</span>
                  <span className={`rounded-full px-2 py-1 ${statusTone(review.analysis_status)}`}>analysis: {review.analysis_status || '—'}</span>
                  <span className={`rounded-full px-2 py-1 ${riskTone(review.risk_score)}`}>risk: {review.risk_score || '—'}</span>
                </div>
                {review.extracted_data?.evaluation?.summary ? (
                  <div className="mt-3 text-xs leading-5 text-slate-600">{review.extracted_data.evaluation.summary}</div>
                ) : null}
                {Array.isArray(review.extracted_data?.evaluation?.issues) && review.extracted_data!.evaluation!.issues!.length > 0 ? (
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-rose-700 mb-1">Проблемные пункты и предложения для протокола разногласий:</div>
                    <ul className="space-y-2">
                      {review.extracted_data!.evaluation!.issues!.map((issue, index) => (
                        <li key={`${review.id}-issue-${index}`} className="border-l-4 pl-3 py-1 bg-slate-50" style={{ borderColor: issue.severity === 'red' ? '#f43f5e' : issue.severity === 'yellow' ? '#f59e42' : '#10b981' }}>
                          <div className="flex items-center gap-2">
                            <span className={`rounded px-2 py-1 text-[11px] font-bold ${issue.severity === 'red' ? 'bg-rose-100 text-rose-700' : issue.severity === 'yellow' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>{(issue.severity || 'risk').toUpperCase()}</span>
                            <span className="font-semibold text-slate-900">{issue.title || 'Issue'}</span>
                          </div>
                          {issue.evidence ? <div className="text-xs text-slate-700 mt-1">{issue.evidence}</div> : null}
                          {issue.recommendation ? <div className="text-xs text-blue-700 mt-1">{issue.recommendation}</div> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {review.analysis_error ? <div className="mt-3 text-xs text-rose-600">{review.analysis_error}</div> : null}
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void runAnalysis(review.id)}
                    disabled={analyzingReviewId === review.id || review.upload_status !== 'uploaded'}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {analyzingReviewId === review.id ? 'Анализ...' : 'Запустить анализ'}
                  </button>
                  <span className="text-[11px] text-slate-500">PDF, DOCX и TXT анализируются автоматически. DOC уходит в ручную валидацию.</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}