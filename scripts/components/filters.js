// /scripts/components/filters.js

// Универсальный модуль фильтров для панели качества.
// Сейчас: дата-от, дата-до, менеджер.
// Позже можно добавлять новые фильтры без переписи логики.

export function renderQualityFilters({ managers = [], onChange }) {
  const container = document.createElement('div');
  container.className = 'quality-filters';

  // ---------- DATE FROM ----------
  const dateFrom = document.createElement('input');
  dateFrom.type = 'date';
  dateFrom.className = 'filter-input';
  dateFrom.addEventListener('change', () => emitChange());

  // ---------- DATE TO ----------
  const dateTo = document.createElement('input');
  dateTo.type = 'date';
  dateTo.className = 'filter-input';
  dateTo.addEventListener('change', () => emitChange());

  // ---------- MANAGER SELECT ----------
  const managerSelect = document.createElement('select');
  managerSelect.className = 'filter-input';

  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'Все менеджеры';
  managerSelect.appendChild(optAll);

  managers.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    managerSelect.appendChild(opt);
  });

  managerSelect.addEventListener('change', () => emitChange());

  // ---------- COLLECT AND EMIT ----------
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

  // ---------- RENDER BLOCK ----------
  const block = document.createElement('div');
  block.className = 'filters-block';

  block.appendChild(dateFrom);
  block.appendChild(dateTo);
  block.appendChild(managerSelect);

  container.appendChild(block);

  return container;
}
