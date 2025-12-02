// /scripts/components/filters.js

// Фильтры в шапке панели качества:
// Дата с / Дата по / Менеджер
// Верстка максимально повторяет .panel-toolbar внизу.

export function renderQualityFilters({ managers = [], onChange }) {
  const container = document.createElement('div');
  // Используем те же стили, что и нижний тулбар
  container.className = 'panel-toolbar panel-toolbar-header';

  // --------- элементы ---------
  const dateFrom = document.createElement('input');
  dateFrom.type = 'date';
  dateFrom.className = 'toolbar-input';

  const dateTo = document.createElement('input');
  dateTo.type = 'date';
  dateTo.className = 'toolbar-input';

  const managerSelect = document.createElement('select');
  managerSelect.className = 'toolbar-select';

  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'Все менеджеры';
  managerSelect.appendChild(optAll);

  managers.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name || m.id;
    managerSelect.appendChild(opt);
  });

  // --------- хелпер для групп ---------
  function makeGroup(labelText, controlEl) {
    const group = document.createElement('div');
    group.className = 'toolbar-group';

    const label = document.createElement('label');
    label.className = 'toolbar-label';
    label.textContent = labelText;

    group.appendChild(label);
    group.appendChild(controlEl);
    return group;
  }

  // --------- сборка ---------
  const groupDateFrom = makeGroup('Дата с', dateFrom);
  const groupDateTo = makeGroup('Дата по', dateTo);
  const groupManager = makeGroup('Менеджер', managerSelect);

  container.appendChild(groupDateFrom);
  container.appendChild(groupDateTo);
  container.appendChild(groupManager);

  // --------- отдача фильтров наверх ---------
  function emitChange() {
    const filters = {
      date_from: dateFrom.value || null,
      date_to: dateTo.value || null,
      manager_id: managerSelect.value || null,
    };

    if (typeof onChange === 'function') {
      onChange(filters);
    }
  }

  dateFrom.addEventListener('change', emitChange);
  dateTo.addEventListener('change', emitChange);
  managerSelect.addEventListener('change', emitChange);

  return container;
}
