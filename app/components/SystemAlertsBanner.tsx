/**
 * Постоянная плашка вверху интерфейса для системных алертов (как шапка-предупреждение в RetailCRM).
 * Сейчас основной кейс — исчерпан баланс OpenAI: висит красной полосой, пока ИИ не заработает.
 * Плоско, без скруглений/теней (по эталонам golds). Серверный компонент — состояние из БД.
 */
import { getActiveSystemAlerts } from '@/lib/openai-health';

const SEVERITY_CLS: Record<string, string> = {
    error: 'bg-red-600 text-white',
    warning: 'bg-amber-500 text-black',
    info: 'bg-sky-600 text-white',
};

export default async function SystemAlertsBanner() {
    const alerts = await getActiveSystemAlerts();
    if (!alerts.length) return null;
    return (
        <div className="shrink-0">
            {alerts.map((a) => (
                <div
                    key={a.key}
                    role="alert"
                    className={`flex items-center justify-center gap-2 px-4 py-1.5 text-center text-[13px] font-bold leading-tight ${SEVERITY_CLS[a.severity] || SEVERITY_CLS.error}`}
                >
                    <span aria-hidden className="text-base leading-none">⚠</span>
                    <span>{a.message}</span>
                </div>
            ))}
        </div>
    );
}
