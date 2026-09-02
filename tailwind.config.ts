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
