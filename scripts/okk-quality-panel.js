// scripts/okk-quality-panel.js

const qualityTableBody = document.getElementById('qualityTableBody');
const runQualityCheckBtn = document.getElementById('runQualityCheckBtn');
const filterViolationCode = document.getElementById('filterViolationCode');
const filterManager = document.getElementById('filterManager');
const filterSearch = document.getElementById('filterSearch');

const summaryTotal = document.getElementById('summaryTotal');
const summaryNoComment = document.getElementById('summaryNoComment');
const summaryFakeQual = document.getElementById('summaryFakeQual');
const summaryIllegalCancel = document.getElementById('summaryIllegalCancel');

let allViolations = [];

// ---------- helpers ----------

function formatDateTime(str) {
  if (!str) return '—';
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleString('ru-RU', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderSummary(violations) {
  summaryTotal.textContent = violations.length || '—';

  const byType = violations.reduce(
    (acc, v) => {
      acc[v.violation_type] = (acc[v.violation_type] || 0) + 1;
      return acc;
    },
    {}
  );

  summaryNoComment.textContent =
    byType.NO_COMMENT_ON_STATUS_CHANGE || '—';
  summaryFakeQual.textContent = byType.FAKE_QUALIFICATION || '—';
  summaryIllegalCancel.textContent = byType.ILLEGAL_CANCEL_FROM_NEW || '—';
}

function renderManagersFilter(violations) {
  const managers = new Set();
  violations.forEach((v) => {
    if (v.manager_id) managers.add(v.manager_id);
  });

  // очистить кроме "Все"
  while (filterManager.options.length > 1) {
    filterManager.remove(1);
  }

  Array.from(managers).forEach((id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id; // пока просто UUID, потом сделаем ФИО/ID CRM
    filterManager.appendChild(opt);
  });
}

function renderTable(violations) {
  if (!violations.length) {
    qualityTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="table-placeholder">
          Нарушений не найдено.
        </td>
      </tr>
    `;
    return;
  }

  qualityTableBody.innerHTML = '';

  for (const v of violations) {
    const tr = document.createElement('tr');

    const details = v.details || {};
    const orderId = details.retailcrm_order_id || details.order_number || '—';
    const shortDetails =
      (details.comment && details.comment.slice(0, 120)) || '';

    tr.innerHTML = `
      <td class="nowrap">${formatDateTime(v.detected_at)}</td>
      <td class="nowrap">${orderId}</td>
      <td class="nowrap">${v.manager_id || '—'}</td>
      <td class="nowrap">${v.violation_type}</td>
      <td>${shortDetails}</td>
    `;

    qualityTableBody.appendChild(tr);
  }
}

function applyFilters() {
  let filtered = [...allViolations];

  const code = filterViolationCode.value;
  const managerId = filterManager.value;
  const search = filterSearch.value.trim().toLowerCase();

  if (code) {
    filtered = filtered.filter((v) => v.violation_type === code);
  }

  if (managerId) {
    filtered = filtered.filter((v) => v.manager_id === managerId);
  }

  if (search) {
    filtered = filtered.filter((v) => {
      const d = v.details || {};
      const haystack = JSON.stringify({
        order_id: d.retailcrm_order_id,
        number: d.order_number,
        comment: d.comment,
      }).toLowerCase();
      return haystack.includes(search);
    });
  }

  renderSummary(filtered);
  renderTable(filtered);
}

// ---------- API calls ----------

async function loadViolations() {
  try {
    qualityTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="table-placeholder">
          Загрузка нарушений...
        </td>
      </tr>
    `;

    const resp = await fetch('/api/okk-violations');
    const json = await resp.json();

    if (!json.success) {
      throw new Error(json.error || 'Ошибка загрузки нарушений');
    }

    allViolations = json.violations || [];

    renderManagersFilter(allViolations);
    applyFilters();
  } catch (err) {
    console.error(err);
    qualityTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="table-placeholder table-placeholder_error">
          ${String(err.message || err)}
        </td>
      </tr>
    `;
  }
}

async function runQualityCheck() {
  try {
    runQualityCheckBtn.disabled = true;
    runQualityCheckBtn.textContent = 'Проверяю…';

    const resp = await fetch('/api/okk-check-orders', {
      method: 'POST',
    });

    const json = await resp.json();

    if (!json.success) {
      throw new Error(json.error || 'Ошибка проверки заказов');
    }

    // после успешной проверки — перезагружаем нарушения
    await loadViolations();
  } catch (err) {
    alert('Ошибка: ' + (err.message || err));
  } finally {
    runQualityCheckBtn.disabled = false;
    runQualityCheckBtn.textContent = 'Запустить проверку заказов';
  }
}

// ---------- wires ----------

if (runQualityCheckBtn) {
  runQualityCheckBtn.addEventListener('click', runQualityCheck);
}
if (filterViolationCode) {
  filterViolationCode.addEventListener('change', applyFilters);
}
if (filterManager) {
  filterManager.addEventListener('change', applyFilters);
}
if (filterSearch) {
  filterSearch.addEventListener('input', applyFilters);
}

loadViolations();
