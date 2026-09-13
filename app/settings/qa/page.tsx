import Link from 'next/link';
import { UI_AUDIT_SCREENS, UI_AUDIT_VIEWPORTS } from '@/lib/ui-audit/screens';
import { UI_CHECK_TITLES } from '@/lib/ui-audit/checks';
import QaModeSwitch from './QaModeSwitch';

export const dynamic = 'force-dynamic';

const RULE_NOTES: Record<keyof typeof UI_CHECK_TITLES, string> = {
    'page-h-overflow': 'страница шире окна — появляется горизонтальная прокрутка всего экрана',
    clipped: 'кнопка/поле/таблица уходит за край окна, и доскроллить до неё нельзя',
    covered: 'окно или кнопка перекрыты другим слоем (сайдбар над карточкой, телефон над чатом)',
    'nested-scroll': 'прокрутка внутри прокрутки — колесо «залипает»; одна прокрутка на экран',
    'scroll-dead': 'блок обрезает контент (overflow: hidden) и не даёт прокрутить',
    radius: 'скруглённые углы — по голду 0px (исключение: чат Семёна)',
    shadow: 'тени — по голду плоско',
    transition: 'анимации дольше 100 мс',
    'number-input': 'поле type=number вместо NumberInput с разделителями разрядов',
    'touch-target': 'на телефоне зона касания меньше 44px',
    'code-in-ui': 'в интерфейсе виден технический код вместо русского названия',
};

export default function QaPage() {
    const sections = Array.from(new Set(UI_AUDIT_SCREENS.map((s) => s.section)));
    const total = UI_AUDIT_SCREENS.filter((s) => !s.skip).length;

    return (
        <div className="min-h-full bg-white px-6 py-6 md:px-8">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-300 pb-4">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-950">Режим тестировщика</h1>
                    <p className="mt-1 text-sm text-slate-600">
                        {total} экранов · {UI_AUDIT_VIEWPORTS.length} размера окна · {Object.keys(UI_CHECK_TITLES).length} правил из голдов
                    </p>
                </div>
                <QaModeSwitch />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div>
                    <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">Экраны</h2>
                    <div className="border-t border-slate-300">
                        {sections.map((section) => (
                            <div key={section}>
                                <div className="bg-slate-100 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-slate-600">{section}</div>
                                {UI_AUDIT_SCREENS.filter((s) => s.section === section).map((s) => (
                                    <div key={s.key} className="flex items-center gap-3 border-b border-slate-200 px-3 py-1.5 text-sm">
                                        <div className="min-w-0 flex-1">
                                            <div className="font-bold text-slate-900">{s.title}</div>
                                            <div className="truncate text-xs text-slate-500">
                                                {s.path}
                                                {s.steps ? ' · открывает вложенное окно' : ''}
                                                {s.public ? ' · без входа' : ''}
                                            </div>
                                        </div>
                                        {s.skip ? (
                                            <span className="text-xs text-slate-400">не проверяем: {s.skip}</span>
                                        ) : (
                                            <Link
                                                href={`${s.path}${s.path.includes('?') ? '&' : '?'}qa=1`}
                                                className="border border-slate-900 px-3 py-1 text-xs font-bold text-slate-900 hover:bg-slate-900 hover:text-white"
                                            >
                                                Открыть с проверкой
                                            </Link>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                <aside className="space-y-6">
                    <div>
                        <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">Как пользоваться</h2>
                        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
                            <li>Включите режим кнопкой выше — снизу слева появится панель.</li>
                            <li>Откройте любой экран: панель сама проверит вёрстку и покажет ошибки.</li>
                            <li>Клик по замечанию — элемент обводится и прокручивается в поле зрения.</li>
                            <li>Меняйте ширину окна: проверка повторяется на каждом размере.</li>
                            <li>Кнопки «Пред./След.» ведут по всем экранам подряд.</li>
                        </ol>
                    </div>

                    <div>
                        <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">Что проверяется</h2>
                        <ul className="space-y-1 text-sm text-slate-700">
                            {(Object.keys(UI_CHECK_TITLES) as Array<keyof typeof UI_CHECK_TITLES>).map((code) => (
                                <li key={code}>
                                    <b className="text-slate-900">{UI_CHECK_TITLES[code]}</b> — {RULE_NOTES[code]}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">Размеры окна</h2>
                        <ul className="text-sm text-slate-700">
                            {UI_AUDIT_VIEWPORTS.map((v) => (
                                <li key={v.key}>{v.title}</li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">Полный прогон</h2>
                        <p className="text-sm text-slate-700">
                            Все экраны × все окна со скриншотами и HTML-отчётом — командой <code className="bg-slate-100 px-1">npm run ui:audit</code> на машине
                            разработчика. Отчёт: <code className="bg-slate-100 px-1">ui-audit-report/report.html</code>.
                        </p>
                    </div>
                </aside>
            </div>
        </div>
    );
}
