// Глобальный индикатор перехода между страницами.
// Без него App Router молча ждёт серверный рендер (секунды) — пользователю кажется,
// что кнопка меню не нажалась, и он кликает повторно.
export default function Loading() {
    return (
        <div className="w-full px-4 py-6 md:px-6 md:py-8">
            <div className="flex items-center gap-3">
                <span className="inline-block h-4 w-4 animate-spin border-2 border-gray-300 border-t-blue-600 rounded-full" />
                <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Загрузка страницы…</span>
            </div>

            <div className="mt-8 space-y-3">
                <div className="h-10 w-1/3 bg-gray-200 animate-pulse" />
                <div className="h-4 w-1/5 bg-gray-100 animate-pulse" />
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="h-28 bg-gray-100 animate-pulse" />
                <div className="h-28 bg-gray-100 animate-pulse" />
                <div className="h-28 bg-gray-100 animate-pulse" />
            </div>

            <div className="mt-4 h-64 bg-gray-100 animate-pulse" />
        </div>
    );
}
