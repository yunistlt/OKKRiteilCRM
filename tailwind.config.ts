import type { Config } from "tailwindcss";

// Семантические цвета интерфейса (bg-card, text-muted-foreground, border-border …)
// поверх CSS-переменных из app/globals.css. Палитра — golds/GOLD_DESIGN_UX.md §5.3.
// Переменные хранят каналы RGB, поэтому работают модификаторы прозрачности: bg-muted/50.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        // ЗАКОН голда (GOLD_DESIGN_UX §1, §5): плоско, углы 0px, без теней, переходы ≤100 мс —
        // гасим шкалы Tailwind целиком, чтобы rounded-*/shadow-*/duration-* в любом файле
        // не могли нарушить стандарт. Исключение — чат Семёна (§5.6): там произвольные
        // значения rounded-[8px] / rounded-[50%] / shadow-[…], которые шкала не трогает.
        // Спиннеры — rounded-[50%] по той же причине.
        borderRadius: {
            none: '0',
            sm: '0',
            DEFAULT: '0',
            md: '0',
            lg: '0',
            xl: '0',
            '2xl': '0',
            '3xl': '0',
            full: '0',
        },
        boxShadow: {
            sm: 'none',
            DEFAULT: 'none',
            md: 'none',
            lg: 'none',
            xl: 'none',
            '2xl': 'none',
            inner: 'none',
            none: 'none',
        },
        transitionDuration: {
            DEFAULT: '75ms',
            0: '0ms',
            75: '75ms',
            100: '100ms',
            150: '75ms',
            200: '75ms',
            300: '100ms',
            500: '100ms',
            700: '100ms',
            1000: '100ms',
        },
        extend: {
            colors: {
                background: token('background'),
                foreground: token('foreground'),
                border: token('border'),
                input: token('input'),
                ring: token('ring'),
                card: {
                    DEFAULT: token('card'),
                    foreground: token('card-foreground'),
                },
                popover: {
                    DEFAULT: token('popover'),
                    foreground: token('popover-foreground'),
                },
                primary: {
                    DEFAULT: token('primary'),
                    foreground: token('primary-foreground'),
                },
                secondary: {
                    DEFAULT: token('secondary'),
                    foreground: token('secondary-foreground'),
                },
                muted: {
                    DEFAULT: token('muted'),
                    foreground: token('muted-foreground'),
                },
                accent: {
                    DEFAULT: token('accent'),
                    foreground: token('accent-foreground'),
                },
                destructive: {
                    DEFAULT: token('destructive'),
                    foreground: token('destructive-foreground'),
                },
                success: {
                    DEFAULT: token('success'),
                    foreground: token('success-foreground'),
                },
            },
        },
    },
    plugins: [],
};
export default config;
