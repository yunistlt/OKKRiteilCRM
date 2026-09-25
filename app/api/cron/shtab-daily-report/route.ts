import { NextRequest, NextResponse } from 'next/server';
import {
    formatKnowledge,
    getTamaraPrompt,
    renderTemplate,
    runTamara,
    searchTamaraKnowledge,
} from '@/lib/shtab/tamara';
import { loadTamaraSettings, recentReports, reportSentFor, sendToOwner } from '@/lib/shtab/tamara-telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/shtab-daily-report — ежедневный отчёт Тамары владельцу.
//
// Форму отчёта выбирает она сама. Здесь не задаётся, что в нём должно быть:
// список разделов, написанный однажды, через месяц превращается в ритуал, из
// которого выкинули смысл. Задаётся другое — что отчёт обязан опираться на
// данные, называть изменения, а не состояние, и держаться формы, к которой
// владелец привык. Остальное её работа.
//
// Отчёт она отправляет сама, инструментом telegram_owner: так же, как ответила
// бы на вопрос в разговоре. Мы только просим и проверяем, что отправила.

/** Задание на отчёт. Не форма, а требования к нему. */
const REPORT_TASK = `Собери ежедневный отчёт владельцу и отправь его инструментом telegram_owner с kind = daily_report.

Прежде чем писать: посмотри мои прошлые отчёты (my_reports) и держись той же формы — к отчёту привыкают и читают его по привычным местам. Первый отчёт — форму выбираешь сама.

Что обязательно.
— Отчёт строится на данных. Каждое число получено инструментом; ничего не достраивай.
— Говори об изменениях, а не о состоянии. «Заказов в работе 240» — это не новость; «за сутки прибавилось 12, из них 9 без просчёта» — новость.
— Если за сутки ничего не изменилось, так и напиши коротко. Отчёт из пустых строк хуже, чем отчёт в две строки.
— Назови одно дело на сегодня. Одно, а не список: список из семи пунктов не делается.
— Не длиннее пятнадцати строк. Его читают утром с телефона.
— Не повторяй то, что владелец и так получает от бота-РОПа: там утренние планы менеджеров и вечерний разбор задач. Твоё — положение дел в целом.

Что посмотреть — решай сама по тому, что сегодня важно. Обычно это деньги, продажи, движение заказов, работа отдела, открытые минусы Штаба и выпуск на заводе.`;

export async function GET(req: NextRequest) {
    const auth = req.headers.get('authorization');
    if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRun = req.nextUrl.searchParams.get('dry') === '1';
    const force = req.nextUrl.searchParams.get('force') === '1';
    const today = new Date().toISOString().slice(0, 10);

    try {
        const settings = await loadTamaraSettings();
        if (!settings.dailyReportEnabled && !force) {
            return NextResponse.json({ ok: true, skipped: 'ежедневный отчёт выключен в настройках' });
        }
        if (!settings.chatId) {
            return NextResponse.json({ ok: false, error: 'не задан чат владельца' }, { status: 500 });
        }

        // Крон Vercel может сработать дважды; два одинаковых отчёта за утро —
        // верный способ отучить их читать.
        if (!force && (await reportSentFor(today))) {
            return NextResponse.json({ ok: true, skipped: 'за сегодня отчёт уже отправлен' });
        }

        const prompt = await getTamaraPrompt('shtab_tamara_chat');
        const knowledge = await searchTamaraKnowledge('ежедневный отчёт владельцу положение дел');
        const past = await recentReports(3);

        const answer = await runTamara({
            prompt,
            purpose: 'shtab_daily_report',
            reasoningEffort: 'high',
            userContent: renderTemplate(prompt.userPromptTemplate, {
                question: REPORT_TASK + (dryRun ? '\n\nСЕЙЧАС ПРОВЕРКА: отчёт собери, но НЕ отправляй — просто напиши его текстом.' : ''),
                knowledge_context: formatKnowledge(knowledge),
                memory_context: '',
                files_context: '',
                summary_context: '',
                history_context: past.length
                    ? past.map((p) => `Отчёт за ${p.date ?? 'неизвестный день'}:\n${p.text}`).join('\n\n')
                    : 'Отчётов ещё не было.',
            }),
        });

        const sentByTool = answer.usedTools.some((t) => t.name === 'telegram_owner');

        // Она могла собрать отчёт и не отправить — например, упёрлась в потолок
        // шагов. Молчащий отчёт неотличим от отчёта, которому нечего сказать,
        // поэтому дотягиваем сами и говорим об этом в ответе.
        let fallbackSent = false;
        if (!dryRun && !sentByTool && answer.reply.trim()) {
            const res = await sendToOwner(answer.reply, { kind: 'daily_report', reportDate: today });
            fallbackSent = res.ok;
        }

        return NextResponse.json({
            ok: true,
            date: today,
            sent_by_tamara: sentByTool,
            sent_as_fallback: fallbackSent,
            used_tools: answer.usedTools.map((t) => t.name),
            preview: answer.reply,
        });
    } catch (e: any) {
        // О сорвавшемся отчёте владелец должен узнать от бота, а не по тишине.
        if (!dryRun) {
            await sendToOwner(`Не смогла собрать сегодняшний отчёт: ${String(e.message).slice(0, 300)}`, {
                kind: 'failure',
            }).catch(() => null);
        }
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
