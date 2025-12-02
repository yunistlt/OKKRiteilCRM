// /scripts/okk-quality-panel.js

import { renderQualityFilters } from './components/filters.js';

let allViolations = [];

// фильтры шапки (дата + менеджер)
let headerFilters = {
  date_from: null,
  date_to: null,
  manager_id: null,
};

// ---------- helpers ----------

function formatDate(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return String(dateString);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Аккуратно вытаскиваем поле времени — не знаем, как оно точно называется в БД
function getViolationTime(v) {
  return v.detected_at || v.created_at || v.inserted_at || v.created || null;
}

function getOrderId(v) {
  return (
    v.order_id ||
    v.order_number ||
    v.retailcrm_order_number ||
    v.retailcrm_order_id ||
    ''
  );
}

function getManagerId(v) {
  return v.manager_id || v.retailcrm_manager_id || v.managerExternalId || '';
}

function getViolationCode(v) {
  return v.violation_code || v.code || v.type || '';
}

// Человеческий вывод details (чтобы не было [object Object])
function formatDetails(details) {
  if (!details) return '';

  if (typeof details === 'string') {
    return details;
  }

  try {
    // Если это JSONB из Supabase — сначала попробуем вытащить что-то осмысленное
    if (details.message && typeof details.message === 'string') {
      return details.message;
    }

    // Если там просто набор полей — склеим в "ключ: значение"
    const entries = Object.entries(details);
    if (!entries.length) return '';

    const short = entries
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ');

    // Чуть ограничим длину, чтобы не разъезжалась таблица
    if (short.length > 200) {
      return short.slice(0, 197) + '...';
    }
    return short;
  } catch (e) {
    return String(details);
  }
}

// вытащить уникальные ID менеджеров из нарушений
function extractManagerIds(violations) {
  const managers = Array.from(
    new Set(
      violations
        .map((v) => getManagerId(v))
        .filter((id) => id !== null && id !== undefined && String(id).trim()),
    ),
  );

  managers.sort((a, b) => String(a).localeCompare(String(b), 'ru'));
  return managers;
}

// ---------- рендер ----------

function updateSummary(violations) {
  const total = violations.length;

  const noCommentCount = violations.filter(
    (v) => getViolationCode(v) === 'NO_COMMENT_ON_STATUS_CHANGE',
  ).length;

  const fakeQualCount = violations.filter(
    (v) => getViolationCode(v) === 'FAKE_QUALIFICATION',
  ).length;

  const illegalCancelCount = violations.filter(
    (v) => getViolationCode(v) === 'ILLEGAL_CANCEL_FROM_NEW',
  ).length;

  document.getElementById('summaryTotal').textContent = total || '—';
  document.getElementById('summaryNoComment').textContent =
    noCommentCount || '—';
  document.getElementById('summaryFakeQual').textContent =
    fakeQualCount || '—';
  document.getElementById('summaryIllegalCancel').textContent =
    illegalCancelCount || '—';
}

function renderTable(violations) {
  const tbody = document.getElementById('qualityTableBody');
  tbody.innerHTML = '';

  if (!violations.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'table-placeholder';
    td.textContent = 'Нарушений не найдено для выбранных фильтров';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  violations.forEach((v) => {
    const tr = document.createElement('tr');

    const tdTime = document.createElement('td');
    tdTime.textContent = formatDate(getViolationTime(v));
    tr.appendChild(tdTime);

    const tdOrder = document.createElement('td');
    tdOrder.textContent = getOrderId(v) || '—';
    tr.appendChild(tdOrder);

    const tdManager = document.createElement('td');
    tdManager.textContent = getManagerId(v) || '—';
    tr.appendChild(tdManager);

    const tdCode = document.createElement('td');
    const code = getViolationCode(v) || '—';
    tdCode.textContent = code;
    tdCode.className = `violation-chip violation-${code}`;
    tr.appendChild(tdCode);

    const tdDetails = document.createElement('td');
    tdDetails.textContent = formatDetails(v.details);
    tr.appendChild(tdDetails);

    tbody.appendChild(tr);
  });
}

function fillManagerFilter(violations) {
  const select = document.getElementById('filterManager');
  // Оставляем первый option "Все"
  const first = select.querySelector('option');
  select.innerHTML = '';
  if (first) select.appendChild(first);

  const managers = extractManagerIds(violations);

  managers.forEach((id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    select.appendChild(opt);
  });
}

// ---------- загрузка + фильтры ----------

function applyFilters() {
  // фильтры из шапки
  const dateFromStr = headerFilters.date_from;
  const dateToStr = headerFilters.date_to;
  const headerManager = headerFilters.manager_id;

  let filtered = [...allViolations];

  // фильтр по дате (шапка)
  if (dateFromStr) {
    const from = new Date(`${dateFromStr}T00:00:00`);
    filtered = filtered.filter((v) => {
      const t = getViolationTime(v);
      if (!t) return false;
      const dv = new Date(t);
      if (Number.isNaN(dv.getTime()) || Number.isNaN(from.getTime())) {
        return false;
      }
      return dv >= from;
    });
  }

  if (dateToStr) {
    const to = new Date(`${dateToStr}T23:59:59`);
    filtered = filtered.filter((v) => {
      const t = getViolationTime(v);
      if (!t) return false;
      const dv = new Date(t);
      if (Number.isNaN(dv.getTime()) || Number.isNaN(to.getTime())) {
        return false;
      }
      return dv <= to;
    });
  }

  // фильтр по менеджеру из шапки
  if (headerManager) {
    filtered = filtered.filter(
      (v) => String(getManagerId(v)) === String(headerManager),
    );
  }

  // фильтры тулбара
  const codeFilter = document.getElementById('filterViolationCode').value;
  const managerFilter = document.getElementById('filterManager').value;
  const searchValue = document
    .getElementById('filterSearch')
    .value.trim()
    .toLowerCase();

  if (codeFilter) {
    filtered = filtered.filter(
      (v) => getViolationCode(v) === codeFilter,
    );
  }

  if (managerFilter) {
    filtered = filtered.filter(
      (v) => String(getManagerId(v)) === managerFilter,
    );
  }

  if (searchValue) {
    filtered = filtered.filter((v) => {
      const orderId = String(getOrderId(v) || '').toLowerCase();
      const detailsText = formatDetails(v.details).toLowerCase();
      return (
        orderId.includes(searchValue) || detailsText.includes(searchValue)
      );
    });
  }

  updateSummary(filtered);
  renderTable(filtered);
}

async function loadViolations() {
  const tbody = document.getElementById('qualityTableBody');
  tbody.innerHTML = `
    <tr>
      <td colspan="5" class="table-placeholder">Загрузка нарушений...</td>
    </tr>
  `;

  try {
    const res = await fetch('/api/okk-violations');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    const violations = json.violations || [];

    allViolations = violations;

    // менеджеры для селекта в тулбаре
    fillManagerFilter(allViolations);

    // менеджеры для фильтров в шапке
    const managers = extractManagerIds(allViolations).map((id) => ({
      id,
      name: id,
    }));
    const headerContainer = document.getElementById('qualityHeaderFilters');
    if (headerContainer) {
      headerContainer.innerHTML = '';
      const filtersNode = renderQualityFilters({
        managers,
        onChange: (filters) => {
          headerFilters = filters || {
            date_from: null,
            date_to: null,
            manager_id: null,
          };
          applyFilters();
        },
      });
      headerContainer.appendChild(filtersNode);
    }

    applyFilters();
  } catch (err) {
    console.error('loadViolations error', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="table-placeholder table-error">
          Ошибка загрузки нарушений. Попробуйте обновить страницу.
        </td>
      </tr>
    `;
    document.getElementById('summaryTotal').textContent = '—';
    document.getElementById('summaryNoComment').textContent = '—';
    document.getElementById('summaryFakeQual').textContent = '—';
    document.getElementById('summaryIllegalCancel').textContent = '—';
  }
}

async function runQualityCheck() {
  const btn = document.getElementById('runQualityCheckBtn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Проверяем...';

  try {
    const res = await fetch('/api/okk-check-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    // Можно при желании прочитать {checked, inserted}, но пока просто обновим список
    await loadViolations();
  } catch (err) {
    console.error('runQualityCheck error', err);
    // Визуально просто дадим знать, что что-то не так
    alert('Не удалось запустить проверку заказов. Смотри консоль.');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ---------- инициализация ----------

document.addEventListener('DOMContentLoaded', () => {
  loadViolations();

  document
    .getElementById('filterViolationCode')
    .addEventListener('change', applyFilters);

  document
    .getElementById('filterManager')
    .addEventListener('change', applyFilters);

  document
    .getElementById('filterSearch')
    .addEventListener('input', applyFilters);

  document
    .getElementById('runQualityCheckBtn')
    .addEventListener('click', runQualityCheck);
});
