/** @type {import('next').NextConfig} */
const nextConfig = {
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
