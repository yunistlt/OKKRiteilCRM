// Имена архивов — отдельным файлом без зависимостей.
//
// Раньше это жило рядом с распаковщиком, и один импорт из клиентского
// компонента утягивал в браузерный бандл adm-zip вместе с `fs`: сборка падала
// «Module not found: Can't resolve 'fs'». Здесь только работа со строкой.
export function isArchiveName(fileName?: string | null) {
  return /\.(zip|rar|7z|tar|gz|tgz|bz2)$/i.test(String(fileName || ''));
}
