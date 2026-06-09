
// Simplified version of use-toast
import { useCallback } from "react"

export function useToast() {
    // ВАЖНО: ссылка на toast должна быть стабильной между рендерами.
    // Иначе любой useCallback/useEffect с toast в зависимостях пересоздаётся
    // на каждый рендер и зацикливает запросы (экран «моргает»). useCallback с
    // пустыми зависимостями даёт постоянную идентичность — функция не замыкает
    // ничего из области рендера.
    const toast = useCallback(({ title, description }: any) => {
        // Простейшая реализация: лог в консоль (полноценный Toaster-провайдер не подключён).
        console.log(`[TOAST] ${title}: ${description}`)
    }, [])

    return { toast }
}
