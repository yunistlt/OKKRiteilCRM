import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { telegramBotToken } from '@/lib/telegram';
import { formatWeekReview, lastWeek, loadWeek, recommend } from '@/lib/sales-rop/load-review';
import { loadSettings, notifyOwnerFailure } from '@/lib/sales-rop/service';
import { createProposal } from '@/lib/settings-registry/proposals';
import { localToday } from '@/app/api/cron/rop-morning/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/rop-load-review — недельный разбор нагрузки.
//
// Раз в неделю бот сам отвечает на вопрос, кому можно дать больше работы, а
// кому нельзя. Считает по одной методике: работой считается не отметка в
// карточке, а внешний след — разговор, письмо, ответ клиента, движение заказа.
//
// Нагрузку сам не меняет. Рекомендация уходит предложением, которое владелец
// подтверждает нажатием, — тем же путём, которым свои предложения оставляет
// Тамара. Нагрузка это про людей, и решение здесь не автоматическое.

async function sendToOwner(text: string): Promise<boolean> {
    const settings = await loadSettings();
    const chat = settings.ownerChatId || settings.chatId;
    const token = telegramBotToken();
    if (!token || !chat) return false;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    return res.ok;
}

export async function GET(req: NextRequest) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRun = req.nextUrl.searchParams.get('dry') === '1';
    const today = req.nextUrl.searchParams.get('date') || localToday();
    const from = req.nextUrl.searchParams.get('from');
    const to = req.nextUrl.searchParams.get('to');
    const period = from && to ? { from, to } : lastWeek(today);

    try {
        const weeks = await loadWeek(period.from, period.to);
        const text = formatWeekReview(period.from, period.to, weeks);

        // Предложения по нагрузке: одно на человека, и только там, где есть что
        // менять. Молчаливое «оставить как есть» карточкой не показываем —
        // очередь из подтверждений «ничего не делать» её же и обесценит.
        const proposals: Array<{ manager: string; from: number; to: number }> = [];
        if (!dryRun) {
            for (const m of weeks) {
                const rec = recommend(m);
                if (rec.suggestedFactor === null) continue;
                try {
                    await createProposal({
                        knobId: `sales_rop.manager.${m.managerId}.load_factor`,
                        newValue: String(rec.suggestedFactor),
                        reason: `${m.name}: ${rec.title} — ${rec.reason}`,
                        evidence:
                            `Период ${period.from} — ${period.to}. Выдано ${m.tasksIssued}, ` +
                            `отработано ${m.tasksTouched} (${Math.round(m.touchedRate * 100)}%), ` +
                            `разговор по ${m.tasksConfirmed} задачам, клиент ответил по ${m.tasksReplied}, ` +
                            `заказ сдвинулся по ${m.tasksMoved}, закрыто комментарием ${m.tasksCommentOnly}. ` +
                            `Звонков ${m.calls} на ${m.callMinutes} мин.`,
                    });
                    proposals.push({ manager: m.name, from: m.personalFactor ?? 1, to: rec.suggestedFactor });
                } catch (e: any) {
                    // Предложение по этому человеку уже висит или значение
                    // совпало с текущим — это не повод ронять весь разбор.
                    console.warn('[rop-load-review]', m.name, e.message);
                }
            }
        }

        const tail =
            proposals.length > 0
                ? `\n\nПредложения по нагрузке ждут в Штабе: ` +
                  proposals.map((p) => `${p.manager} ×${p.from} → ×${p.to}`).join(', ')
                : '';

        const sent = dryRun ? false : await sendToOwner(text + tail);

        // Разбор сохраняем: к нему возвращаются, когда решают, поднимать ли
        // нагрузку, и помнить его наизусть никто не обязан.
        if (!dryRun) {
            await supabase
                .from('sales_rop_settings')
                .upsert(
                    { key: 'last_load_review', value: `${period.from}..${period.to}` },
                    { onConflict: 'key' },
                )
                .then(() => null);
        }

        return NextResponse.json({ ok: true, period, managers: weeks.length, proposals, sent, preview: text });
    } catch (e: any) {
        if (!dryRun) await notifyOwnerFailure('Недельный разбор нагрузки', e.message);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
