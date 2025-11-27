// /public/scripts/okk-quality-panel.js

let allViolations = [];

function formatDate(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderSummary(violations) {
  const total = violations.length;
  const noComment = violations.filter(v => v.violation_code === 'NO_COMMENT_ON_STATUS_CHANGE').length;
  const fakeQual = violations.filter(v => v.violation_code === 'FAKE_QUALIFICATION').length;
  const illegalCancel = violations.filter(v => v.violation_code === 'ILLEGAL_CANCEL_FROM_NEW').length;

  document.getElementById('summaryTotal').textContent = total;
  document.getElementById('summaryNoComment').textContent = noComment;
  document.getElementById('summaryFakeQual').textContent = fakeQual;
  document.getElementById('summaryIllegalCancel').textContent = illegalCancel;
}

function renderManagersFilter(violations) {
  const select = document.getElementById('filterManager');
  const managers = Array.from(
    new Set(violations.map(v => v.manager_id).filter(Boolean))
  ).sort((a, b) => a - b);

  // очищаем всё кроме первого "Все"
  while (select.options.length > 1) {
    select.remove(1);
  }

  managers.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    select.appendChild(opt);
  });
}

function applyFilters() {
  const codeValue = document.getElementById('filterViolationCode').value;
  const managerValue = document.getElementById('filterManager').value;
  const searchValue = document.getElementById('filterSearch').value.trim().toLowerCase();

  let filtered = [...allViolations];

  if (codeValue) {
    filtered = filtered.filter(v => v.violation_code === codeValue);
  }

  if (managerValue) {
    filtered = filtered.filter(v => String(v.manager_id) === managerValue);
  }

  if (searchValue) {
    filtered = filtered.filter(v => {
      const orderId = String(v.order_id || '');
      const details = (v.details || '').toLowerCase();
      return (
        orderId.includes(searchValue) ||
        details.includes(searchValue)
      );
    });
  }

  renderTable(filtered);
  renderSummary(filtered);
}

function renderTable(violations) {
  const tbody = document.getElementById('qualityTableBody');
  tbody.innerHTML = '';

  if (!violations.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'table-placeholder';
    td.textContent = 'Нарушений по выбранным фильтрам нет';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  violations.forEach(v => {
    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = formatDate(v.created_at);
    tr.appendChild(tdDate);

    const tdOrder = document.createElement('td');
    tdOrder.textContent = v.order_id ?? '—';
    tr.appendChild(tdOrder);

    const tdManager = document.createElement('td');
    tdManager.textContent = v.manager_id ?? '—';
    tr.appendChild(tdManager);

    const tdCode = document.createElement('td');
    tdCode.textContent = v.violation_code;
    tdCode.className = `violation-chip violation-${v.violation_code}`;
    tr.appendChild(tdCode);

    const tdDetails = document.createElement('td');
    tdDetails.textContent = v.details || '';
    tr.appendChild(tdDetails);

    tbody.appendChild(tr);
  });
}

async function loadViolations() {
  const tbody = document.getElementById('qualityTableBody');
  tbody.innerHTML = `
    <tr>
      <td colspan="5" class="table-placeholder">
        Загружаем нарушения...
      </td>
    </tr>
  `;

  try {
    const res = await fetch('/api/okk-violations');
    const json = await res.json();

    if (!json.ok) {
      throw new Error(json.error || 'Ошибка API');
    }

    allViolations = json.violations || [];

    renderManagersFilter(allViolations);
    renderTable(allViolations);
    renderSummary(allViolations);
  } catch (err) {
    console.error('LOAD VIOLATIONS ERROR:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="table-placeholder table-error">
          Ошибка при загрузке нарушений: ${err.message}
        </td>
      </tr>
    `;
  }
}

async function runQualityCheck() {
  const btn = document.getElementById('runQualityCheckBtn');
  btn.disabled = true;
  btn.textContent = 'Проверяем...';

  try {
    const res = await fetch('/api/okk-check-orders');
    const json = await res.json();

    if (!json.ok) {
      throw new Error(json.error || 'Ошибка проверки');
    }

    // После проверки перезагружаем нарушения
    await loadViolations();

    btn.textContent = `Проверка выполнена (${json.violations || 0} нарушений)`;
  } catch (err) {
    console.error('QUALITY CHECK ERROR:', err);
    btn.textContent = 'Ошибка проверки';
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Запустить проверку заказов';
    }, 2000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Загрузка нарушений при открытии
  loadViolations();

  // Слушаем фильтры
  document
    .getElementById('filterViolationCode')
    .addEventListener('change', applyFilters);

  document
    .getElementById('filterManager')
    .addEventListener('change', applyFilters);

  document
    .getElementById('filterSearch')
    .addEventListener('input', applyFilters);

  // Кнопка проверки
  document
    .getElementById('runQualityCheckBtn')
    .addEventListener('click', runQualityCheck);
});
