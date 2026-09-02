import { IBM_Plex_Mono, IBM_Plex_Sans, PT_Sans_Narrow } from 'next/font/google';

// Шрифты Штаба самохостятся через next/font: <link> на fonts.googleapis.com
// означал бы внешний запрос при каждом открытии раздела и мигание текста при
// загрузке. Кириллица подключена явно — без сабсета раздел на русском поедет
// на запасной гарнитуре.
//
// Раздел единственный в приложении со своей типографикой: остальной интерфейс
// живёт на системном стеке из app/globals.css, и трогать его незачем.

export const displayFont = PT_Sans_Narrow({
    subsets: ['cyrillic', 'latin'],
    weight: ['400', '700'],
    variable: '--font-shtab-display',
    display: 'swap',
});

export const bodyFont = IBM_Plex_Sans({
    subsets: ['cyrillic', 'latin'],
    weight: ['400', '500', '600'],
    variable: '--font-shtab-body',
    display: 'swap',
});

export const monoFont = IBM_Plex_Mono({
    subsets: ['cyrillic', 'latin'],
    weight: ['400', '500', '600'],
    variable: '--font-shtab-mono',
    display: 'swap',
});

export const SHTAB_FONT_CLASS = `${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`;
