/**
 * Номер сборки — чтобы человек видел в интерфейсе, дошёл ли до прода деплой
 * (просьба владельца 02.10.2026). На Vercel берём коммит из их переменной, в
 * локальной сборке — из git. Пустая строка не страшна: интерфейс тогда просто
 * не показывает номер.
 */
function buildSha() {
    const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
    if (fromVercel) return fromVercel.slice(0, 7);
    try {
        return require('child_process').execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
        return '';
    }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
    env: {
        NEXT_PUBLIC_BUILD_SHA: buildSha(),
        NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    },
    // nunjucks (шаблоны документов и писем) тянет за собой chokidar/fsevents — нативный
    // модуль, который webpack не собирает. На сервере он и не нужен как бандл: подключаем
    // как обычную зависимость Node.
    //
    // @react-pdf/renderer — по другой причине, но с тем же лечением. Собранный
    // webpack'ом, он падает в рантайме с «Component is not a constructor»: свой
    // React-рендерер пакета не переживает бандлинг и переименование классов.
    // Локально через tsx документ собирается, на сервере — нет, и это ровно то,
    // что ломало скачивание PDF.
    experimental: {
        serverComponentsExternalPackages: ['nunjucks', '@react-pdf/renderer'],
    },
    async redirects() {
        return [
            {
                source: '/statuses',
                destination: '/settings/statuses',
                permanent: true,
            },
        ];
    },
};

module.exports = nextConfig;
