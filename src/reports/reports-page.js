import { createAlert, getSession, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { getApprovedAdminProfile } from '../services/admin-access.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';

const numberFormatter = new Intl.NumberFormat('bg-BG');

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function errorMessage(error, fallback) {
  return error?.message?.trim() || fallback;
}

function sofiaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftCalendarDate(dateValue, days) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function rangeForPreset(preset) {
  const today = sofiaToday();
  const [year, month] = today.split('-').map(Number);

  if (preset === 'week') {
    const day = new Date(`${today}T12:00:00Z`).getUTCDay();
    return { startDate: shiftCalendarDate(today, day === 0 ? -6 : 1 - day), endDate: today };
  }

  if (preset === 'year') {
    return { startDate: `${year}-01-01`, endDate: today };
  }

  return { startDate: `${year}-${String(month).padStart(2, '0')}-01`, endDate: today };
}

function validDateRange(startDate, endDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    && startDate <= endDate;
}

function productDetails(product) {
  const details = [];
  if (product.product_article_code_snapshot) details.push(`Код: ${product.product_article_code_snapshot}`);
  if (product.product_size_snapshot) details.push(product.product_size_snapshot);
  const shade = [product.product_shade_number_snapshot, product.product_shade_name_snapshot]
    .filter(Boolean)
    .join(' · ');
  if (shade) details.push(`Нюанс: ${shade}`);
  if (product.product_developer_concentration_snapshot) {
    details.push(`Концентрация: ${product.product_developer_concentration_snapshot}`);
  }
  return details;
}

export async function createReportsPage() {
  const main = element('main', 'reports-page py-4 py-md-5');
  main.innerHTML = `
    <div class="container"><section class="reports-shell">
      <header class="reports-heading">
        <p class="eyebrow mb-1">АДМИНИСТРАЦИЯ</p>
        <h1 class="h2 mb-1">Отчети</h1>
        <p class="text-body-secondary mb-0">Само доставени поръчки, по дата на доставката.</p>
      </header>
      <div class="reports-content mt-4" aria-live="polite"></div>
    </section></div>`;

  const content = main.querySelector('.reports-content');
  const state = {
    activePreset: 'month',
    endDate: '',
    loadVersion: 0,
    products: [],
    status: 'idle',
    startDate: '',
    totalUnits: null,
  };

  ({ startDate: state.startDate, endDate: state.endDate } = rangeForPreset('month'));

  function clearProtected(message, type = 'warning') {
    state.loadVersion += 1;
    state.products = [];
    state.totalUnits = null;
    state.status = 'protected';
    content.replaceChildren(createAlert(type, message));
  }

  async function confirmAdmin(session) {
    if (!session?.user) return null;
    return getApprovedAdminProfile(session.user.id);
  }

  function renderProductList(panel) {
    const title = element('h2', 'h5 mb-3', 'Продадени продукти');
    panel.append(title);

    if (!state.products.length) {
      panel.append(createAlert('info', 'Няма продадени продукти за избрания период.'));
      return;
    }

    const list = element('div', 'reports-product-list');
    const products = [...state.products].sort((first, second) => (
      Number(second.units_sold) - Number(first.units_sold)
      || Number(first.product_id) - Number(second.product_id)
    ));

    products.forEach((product) => {
      const card = element('article', 'reports-product-card');
      const heading = element('div', 'reports-product-heading');
      const quantity = element('strong', 'reports-product-quantity', `${numberFormatter.format(Number(product.units_sold))} бр.`);
      heading.append(element('h3', 'h6 mb-0', product.product_name_snapshot), quantity);
      card.append(heading);
      const details = productDetails(product);
      if (details.length) card.append(element('p', 'text-body-secondary small mb-0', details.join(' · ')));
      list.append(card);
    });
    panel.append(list);
  }

  function renderWorkspace(message, messageType = 'info') {
    content.replaceChildren();
    const controls = element('section', 'reports-panel');
    controls.append(element('h2', 'h5 mb-3', 'Период'));

    const presets = element('div', 'reports-presets mb-3');
    [
      ['week', 'Тази седмица'],
      ['month', 'Този месец'],
      ['year', 'Тази година'],
    ].forEach(([preset, label]) => {
      const button = element('button', `btn ${state.activePreset === preset ? 'btn-primary' : 'btn-outline-primary'}`, label);
      button.type = 'button';
      button.disabled = state.status === 'loading';
      button.setAttribute('aria-pressed', String(state.activePreset === preset));
      button.addEventListener('click', () => {
        ({ startDate: state.startDate, endDate: state.endDate } = rangeForPreset(preset));
        state.activePreset = preset;
        void loadReport();
      });
      presets.append(button);
    });
    controls.append(presets);

    const form = element('form', 'row g-3 align-items-end');
    form.noValidate = true;
    const invalid = state.status === 'validation';
    [
      ['startDate', 'От дата', state.startDate],
      ['endDate', 'До дата', state.endDate],
    ].forEach(([name, label, value]) => {
      const field = element('div', 'col-12 col-sm-5');
      const inputLabel = element('label', 'form-label fw-semibold', label);
      inputLabel.htmlFor = `reports-${name}`;
      const input = element('input', `form-control${invalid ? ' is-invalid' : ''}`);
      input.id = `reports-${name}`;
      input.name = name;
      input.type = 'date';
      input.value = value;
      input.required = true;
      input.disabled = state.status === 'loading';
      field.append(inputLabel, input);
      form.append(field);
    });
    const action = element('div', 'col-12 col-sm-2');
    const submit = element('button', 'btn btn-primary w-100', state.status === 'loading' ? 'Зареждане…' : 'Покажи');
    submit.type = 'submit';
    submit.disabled = state.status === 'loading';
    action.append(submit);
    form.append(action);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      state.startDate = form.elements.startDate.value;
      state.endDate = form.elements.endDate.value;
      state.activePreset = null;
      void loadReport();
    });
    controls.append(form);
    controls.append(element('p', 'form-text mb-0 mt-3', 'Датите са календарни дни в часовата зона Европа/София.'));
    content.append(controls);

    if (message) content.append(createAlert(messageType, message));

    if (state.status === 'loading') {
      const loading = element('section', 'reports-panel reports-loading');
      loading.append(element('div', 'spinner-border spinner-border-sm', ''), element('span', '', 'Зареждане на отчета…'));
      content.append(loading);
      return;
    }

    if (state.status === 'ready') {
      const summary = element('section', 'reports-summary');
      const label = element('span', 'reports-summary-label', 'Общо продадени единици');
      summary.append(label, element('strong', 'reports-summary-value', numberFormatter.format(Number(state.totalUnits || 0))));
      content.append(summary);
      const products = element('section', 'reports-panel');
      renderProductList(products);
      content.append(products);
    }
  }

  async function loadReport() {
    if (!validDateRange(state.startDate, state.endDate)) {
      state.status = 'validation';
      renderWorkspace('Въведете начална и крайна дата, като началната не е след крайната.', 'danger');
      return;
    }

    const version = ++state.loadVersion;
    state.status = 'loading';
    renderWorkspace();

    try {
      const [summaryResponse, productsResponse] = await Promise.all([
        supabase.rpc('get_admin_sales_units_summary', { p_start_date: state.startDate, p_end_date: state.endDate }),
        supabase.rpc('get_admin_sales_units_by_product', { p_start_date: state.startDate, p_end_date: state.endDate }),
      ]);
      if (version !== state.loadVersion) return;
      if (summaryResponse.error) throw summaryResponse.error;
      if (productsResponse.error) throw productsResponse.error;

      const summary = Array.isArray(summaryResponse.data) ? summaryResponse.data[0] : summaryResponse.data;
      state.totalUnits = Number(summary?.total_units_sold || 0);
      state.products = productsResponse.data || [];
      state.status = 'ready';
      renderWorkspace();
    } catch (error) {
      if (version !== state.loadVersion) return;
      try {
        const { session } = await getSession();
        if (!await confirmAdmin(session)) {
          clearProtected('Администраторският достъп вече не е активен.');
          return;
        }
      } catch {
        // Show the request error if access cannot be rechecked because the network is unavailable.
      }
      state.products = [];
      state.totalUnits = null;
      state.status = 'error';
      renderWorkspace(`Отчетът не може да бъде зареден: ${errorMessage(error, 'Опитайте отново.')}`, 'danger');
      const retry = element('button', 'btn btn-outline-primary mt-2', 'Опитай отново');
      retry.type = 'button';
      retry.addEventListener('click', () => void loadReport());
      content.append(retry);
    }
  }

  async function refreshAccess(session) {
    if (!isSupabaseConfigured) {
      clearProtected('Нужна е Supabase конфигурация.');
      return;
    }
    if (!session?.user) {
      clearProtected('Влезте с одобрен администраторски профил, за да видите отчетите.');
      return;
    }
    try {
      if (!await confirmAdmin(session)) {
        clearProtected('Тази страница е само за одобрени администратори.');
        return;
      }
      await loadReport();
    } catch {
      clearProtected('Администраторският достъп не може да бъде потвърден.', 'danger');
    }
  }

  renderWorkspace();
  const { session } = await getSession();
  void refreshAccess(session);
  subscribeToSessionChanges((_event, changedSession) => { void refreshAccess(changedSession); });
  return main;
}
