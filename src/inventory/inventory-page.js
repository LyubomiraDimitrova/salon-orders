import { createAlert, getSession, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { createConfirmationModal } from '../components/confirmation-modal.js';
import { getApprovedAdminProfile } from '../services/admin-access.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';

const productFields = 'id, brand_id, category_id, name, article_code, size_label, is_hidden';
const retryStorageKey = 'salon-orders.inventory.uncertain-operation';
const movementLabels = {
  initialization: 'Начална наличност',
  receipt: 'Получено количество',
  adjustment: 'Корекция',
  delivery: 'Доставка',
};
const dateTimeFormatter = new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeStyle: 'short' });

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function errorMessage(error, fallback) {
  return error?.message?.trim() || fallback;
}

function integerValue(value, { minimum, allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || (!allowZero && number === 0)) return null;
  return number;
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function savedRetry() {
  try {
    const value = sessionStorage.getItem(retryStorageKey);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function saveRetry(operation) {
  try { sessionStorage.setItem(retryStorageKey, JSON.stringify(operation)); } catch { /* Retry remains available in memory. */ }
}

function clearSavedRetry() {
  try { sessionStorage.removeItem(retryStorageKey); } catch { /* Nothing else to clear. */ }
}

export async function createInventoryPage() {
  const main = element('main', 'inventory-page py-4 py-md-5');
  main.innerHTML = `
    <div class="container"><section class="inventory-shell">
      <header class="inventory-heading">
        <p class="eyebrow mb-1">АДМИНИСТРАЦИЯ</p>
        <h1 class="h2 mb-1">Наличности</h1>
        <p class="text-body-secondary mb-0">Проверявайте наличните, резервираните и свободните количества.</p>
      </header>
      <div class="inventory-content mt-4" aria-live="polite"></div>
    </section></div>`;

  const content = main.querySelector('.inventory-content');
  const confirmationModal = createConfirmationModal('inventory-confirmation');
  const state = {
    brands: [], categories: [], filters: { search: '', brand: '', category: '' }, movements: [],
    products: [], retryOperation: savedRetry(), selectedProductId: null, stockLevels: [], version: 0, busy: false,
  };

  function clearProtected(message, type = 'warning') {
    confirmationModal.clear();
    state.version += 1;
    state.products = [];
    state.stockLevels = [];
    state.movements = [];
    state.selectedProductId = null;
    content.replaceChildren(createAlert(type, message));
  }

  function selectedProduct() {
    return state.products.find((product) => String(product.id) === String(state.selectedProductId)) || null;
  }

  function stockFor(productId) {
    return state.stockLevels.find((stock) => String(stock.product_id) === String(productId)) || null;
  }

  function filteredProducts() {
    const query = state.filters.search.trim().toLocaleLowerCase('bg');
    return state.products.filter((product) => {
      const matchesText = !query || [product.name, product.article_code].filter(Boolean)
        .join(' ').toLocaleLowerCase('bg').includes(query);
      return matchesText
        && (!state.filters.brand || String(product.brand_id) === state.filters.brand)
        && (!state.filters.category || String(product.category_id) === state.filters.category);
    });
  }

  function setMessage(box, type, text) {
    box.replaceChildren(createAlert(type, text));
  }

  async function fetchMovements(productId, version) {
    if (!productId) {
      state.movements = [];
      return;
    }
    const { data, error } = await supabase
      .from('stock_movements')
      .select('id, movement_type, quantity_delta, reason, created_at, operation_request_id')
      .eq('product_id', productId)
      .order('created_at', { ascending: false });
    if (version !== state.version) return;
    if (error) throw error;
    state.movements = data || [];
  }

  function option(select, value, label) {
    const node = element('option', '', label);
    node.value = value;
    select.append(node);
  }

  function createQuantityInput(name, minimum, initialValue, label, help) {
    const field = element('div', 'col-12 col-sm-5');
    const inputLabel = element('label', 'form-label fw-semibold', label);
    inputLabel.htmlFor = name;
    const input = element('input', 'form-control');
    input.id = name;
    input.name = name;
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = String(minimum);
    input.step = '1';
    input.value = String(initialValue);
    input.required = true;
    field.append(inputLabel, input);
    if (help) field.append(element('div', 'form-text', help));
    return field;
  }

  function createReasonInput(name = 'reason') {
    const field = element('div', 'col-12');
    const label = element('label', 'form-label fw-semibold', 'Причина');
    label.htmlFor = name;
    const input = element('textarea', 'form-control');
    input.id = name;
    input.name = name;
    input.rows = 2;
    input.maxLength = 500;
    input.required = true;
    field.append(label, input);
    return field;
  }

  function operationFor(rpcName, payload, productId, label) {
    return { id: createRequestId(), rpcName, payload, productId, label };
  }

  async function executeOperation(operation, feedback, control) {
    if (state.busy) return;
    state.busy = true;
    if (control) {
      control.disabled = true;
      control.dataset.label ||= control.textContent;
      control.textContent = 'Записване…';
    }
    setMessage(feedback, 'info', 'Изпращане към сървъра… Не повтаряйте действието в друг прозорец.');
    try {
      const { error } = await supabase.rpc(operation.rpcName, { p_request_id: operation.id, ...operation.payload });
      if (error) throw error;
      if (state.retryOperation?.id === operation.id) {
        state.retryOperation = null;
        clearSavedRetry();
      }
      setMessage(feedback, 'success', `${operation.label} е записано. Обновяване на данните…`);
      await refreshData({ keepMessage: true });
    } catch (error) {
      state.retryOperation = operation;
      saveRetry(operation);
      try {
        const { session } = await getSession();
        if (!session?.user || !await getApprovedAdminProfile(session.user.id)) {
          clearProtected('Администраторският достъп вече не е активен.');
          return;
        }
      } catch {
        // Keep the retry data when access cannot be rechecked because the network failed.
      }
      setMessage(feedback, 'danger', `Не може да се потвърди резултатът: ${errorMessage(error, 'Опитайте отново.')}`);
      renderWorkspace('Запазени са същият UUID и данни за безопасно повторение на заявката.', 'warning');
    } finally {
      state.busy = false;
      if (control?.isConnected) {
        control.disabled = false;
        control.textContent = control.dataset.label;
      }
    }
  }

  function addActionForm(panel, { title, description, buttonLabel, quantity, onSubmit }) {
    const section = element('section', 'inventory-action');
    section.append(element('h3', 'h5 mb-1', title), element('p', 'text-body-secondary small mb-3', description));
    const form = element('form', 'row g-3');
    form.noValidate = true;
    form.append(quantity, createReasonInput(`${buttonLabel}-reason`));
    const action = element('div', 'col-12');
    const button = element('button', 'btn btn-primary w-100', buttonLabel);
    button.type = 'submit';
    action.append(button);
    form.append(action);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      onSubmit(form, button);
    });
    section.append(form);
    panel.append(section);
  }

  function renderMovementHistory(panel) {
    const section = element('section', 'inventory-action');
    section.append(element('h3', 'h5 mb-2', 'История на движенията'));
    const list = element('div', 'movement-list');
    if (!state.movements.length) {
      list.append(createAlert('info', 'Все още няма отчетени движения за този продукт.'));
    } else {
      state.movements.forEach((movement) => {
        const card = element('article', 'movement-card');
        const top = element('div', 'd-flex justify-content-between gap-3');
        top.append(element('strong', '', movementLabels[movement.movement_type] || movement.movement_type));
        const amount = Number(movement.quantity_delta);
        top.append(element('strong', amount >= 0 ? 'quantity-positive' : 'quantity-negative', `${amount > 0 ? '+' : ''}${amount}`));
        card.append(top, element('span', '', movement.reason), element('small', 'text-body-secondary', dateTimeFormatter.format(new Date(movement.created_at))));
        list.append(card);
      });
    }
    section.append(list);
    panel.append(section);
  }

  function renderDetail() {
    const detail = content.querySelector('[data-inventory-detail]');
    const product = selectedProduct();
    if (!product) {
      detail.replaceChildren(createAlert('info', 'Изберете продукт, за да видите наличност и действия.'));
      return;
    }
    const stock = stockFor(product.id);
    detail.replaceChildren();
    const feedback = element('div');
    detail.append(feedback);
    if (state.retryOperation && String(state.retryOperation.productId) === String(product.id)) {
      const retry = createAlert('warning', `Има непотвърдена операция: ${state.retryOperation.label}. Данните и UUID са запазени.`);
      const retryButton = element('button', 'btn btn-outline-primary w-100 mt-2', 'Повтори същата заявка');
      retryButton.type = 'button';
      retryButton.addEventListener('click', () => executeOperation(state.retryOperation, feedback, retryButton));
      retry.append(retryButton);
      feedback.append(retry);
    }
    detail.append(element('p', 'eyebrow mb-1', 'ПРОДУКТ'), element('h2', 'h4 mb-1', product.name));
    const meta = [product.article_code && `Код: ${product.article_code}`, product.size_label].filter(Boolean).join(' · ');
    if (meta) detail.append(element('p', 'text-body-secondary mb-3', meta));

    if (!stock) {
      detail.append(createAlert('warning inventory-unknown', 'Наличността не е въведена. Това не е потвърдена нулева наличност.'));
      addActionForm(detail, {
        title: 'Въведи начална наличност',
        description: 'Въведете провереното начално количество. Стойност 0 е позволена и означава потвърдена нула.',
        buttonLabel: 'Въведи начална наличност',
        quantity: createQuantityInput('initial-quantity', 0, 0, 'Начално количество', 'Допуска се 0.'),
        onSubmit: (form, button) => {
          const value = integerValue(form.elements['initial-quantity'].value, { minimum: 0, allowZero: true });
          const reason = form.elements[`${button.textContent}-reason`]?.value.trim();
          if (value === null || !reason) { setMessage(feedback, 'danger', 'Въведете цяло количество (включително 0) и причина.'); return; }
          void executeOperation(operationFor('initialize_stock_level', { p_product_id: product.id, p_confirmed_quantity: value, p_reason: reason }, product.id, 'Началната наличност'), feedback, button);
        },
      });
    } else {
      const available = Number(stock.physical_quantity) - Number(stock.reserved_quantity);
      const balances = element('div', 'inventory-balance-grid mt-3');
      [['Физическа', stock.physical_quantity], ['Резервирана', stock.reserved_quantity], ['Свободна', available]].forEach(([label, value]) => {
        const card = element('div', 'inventory-balance');
        card.append(element('small', 'text-body-secondary', label), element('strong', '', String(value)));
        balances.append(card);
      });
      detail.append(balances);
    }

    addActionForm(detail, {
      title: 'Добави получено количество',
      description: 'Получаването увеличава физическата наличност, но не резервира автоматично чакащи поръчки.',
      buttonLabel: 'Добави получено количество',
      quantity: createQuantityInput('receipt-quantity', 1, 1, 'Получено количество'),
      onSubmit: (form, button) => {
        const value = integerValue(form.elements['receipt-quantity'].value, { minimum: 1 });
        const reason = form.elements[`${button.textContent}-reason`]?.value.trim();
        if (value === null || !reason) { setMessage(feedback, 'danger', 'Въведете положително цяло количество и причина.'); return; }
        void executeOperation(operationFor('record_stock_receipt', { p_product_id: product.id, p_quantity: value, p_reason: reason }, product.id, 'Полученото количество'), feedback, button);
      },
    });

    addActionForm(detail, {
      title: 'Коригирай наличността',
      description: 'Използвайте положително или отрицателно цяло число. Причината е задължителна.',
      buttonLabel: 'Коригирай наличността',
      quantity: createQuantityInput('adjustment-quantity', -999999, 1, 'Промяна (+/-)'),
      onSubmit: async (form, button) => {
        const value = integerValue(form.elements['adjustment-quantity'].value, { minimum: -999999 });
        const reason = form.elements[`${button.textContent}-reason`]?.value.trim();
        if (value === null || value === 0 || !reason) { setMessage(feedback, 'danger', 'Въведете ненулево цяло количество и причина.'); return; }
        if (value < 0 && !(await confirmationModal.confirm({
          title: 'Потвърди намаляване на наличност',
          description: `${product.name}: наличността ще бъде намалена с ${Math.abs(value)} бр.`,
          confirmLabel: 'Намали наличността',
          danger: true,
          returnFocus: button,
        }))) return;
        void executeOperation(operationFor('adjust_stock', { p_product_id: product.id, p_quantity_delta: value, p_reason: reason }, product.id, 'Корекцията'), feedback, button);
      },
    });
    renderMovementHistory(detail);
  }

  function renderWorkspace(message, type = 'success') {
    const root = element('div', 'row g-4');
    const listColumn = element('section', 'col-12 col-xl-5');
    const listPanel = element('div', 'inventory-panel');
    const detailColumn = element('section', 'col-12 col-xl-7');
    const detailPanel = element('div', 'inventory-panel');
    detailPanel.dataset.inventoryDetail = '';
    const feedback = element('div');
    if (message) setMessage(feedback, type, message);
    listPanel.append(feedback, element('h2', 'h4 mt-2 mb-3', 'Продукти'));
    const filters = element('div', 'row g-3');
    const searchField = element('div', 'col-12');
    const searchLabel = element('label', 'form-label fw-semibold', 'Търсене');
    searchLabel.htmlFor = 'inventory-search';
    const search = element('input', 'form-control');
    search.id = 'inventory-search'; search.type = 'search'; search.placeholder = 'Име или артикулен код'; search.autocomplete = 'off'; search.value = state.filters.search;
    searchField.append(searchLabel, search);
    const brandField = element('div', 'col-12 col-sm-6');
    const brandLabel = element('label', 'form-label fw-semibold', 'Марка');
    brandLabel.htmlFor = 'inventory-brand';
    const brand = element('select', 'form-select'); brand.id = 'inventory-brand'; option(brand, '', 'Всички марки');
    state.brands.forEach((item) => option(brand, String(item.id), item.name)); brand.value = state.filters.brand;
    brandField.append(brandLabel, brand);
    const categoryField = element('div', 'col-12 col-sm-6');
    const categoryLabel = element('label', 'form-label fw-semibold', 'Категория');
    categoryLabel.htmlFor = 'inventory-category';
    const category = element('select', 'form-select'); category.id = 'inventory-category'; option(category, '', 'Всички категории');
    state.categories.forEach((item) => option(category, String(item.id), item.name)); category.value = state.filters.category;
    categoryField.append(categoryLabel, category);
    filters.append(searchField, brandField, categoryField);
    const list = element('div', 'inventory-product-list mt-3');
    const drawList = () => {
      list.replaceChildren();
      const products = filteredProducts();
      if (!products.length) list.append(createAlert('info', 'Няма продукти по избраните филтри.'));
      products.forEach((product) => {
        const button = element('button', `inventory-product${String(product.id) === String(state.selectedProductId) ? ' selected' : ''}`);
        button.type = 'button';
        const stock = stockFor(product.id);
        const label = stock ? `Свободни: ${Number(stock.physical_quantity) - Number(stock.reserved_quantity)}` : 'Наличността не е въведена';
        button.append(element('strong', '', product.name), element('span', '', product.article_code || 'Без артикулен код'), element('small', stock ? 'text-body-secondary' : 'text-danger', label));
        button.addEventListener('click', () => { state.selectedProductId = product.id; void reloadSelection(); });
        list.append(button);
      });
    };
    search.addEventListener('input', () => { state.filters.search = search.value; drawList(); });
    brand.addEventListener('change', () => { state.filters.brand = brand.value; drawList(); });
    category.addEventListener('change', () => { state.filters.category = category.value; drawList(); });
    listPanel.append(filters, list); listColumn.append(listPanel); detailColumn.append(detailPanel); root.append(listColumn, detailColumn);
    content.replaceChildren(root);
    drawList();
    renderDetail();
  }

  async function reloadSelection() {
    const version = ++state.version;
    try {
      await fetchMovements(state.selectedProductId, version);
      if (version === state.version) renderWorkspace();
    } catch (error) {
      if (version === state.version) renderWorkspace(errorMessage(error, 'Историята не може да се зареди.'), 'danger');
    }
  }

  async function refreshData({ keepMessage = false } = {}) {
    const version = ++state.version;
    const results = await Promise.all([
      supabase.from('products').select(productFields).order('name'),
      supabase.from('brands').select('id, name').order('name'),
      supabase.from('product_categories').select('id, name').order('name'),
      supabase.from('stock_levels').select('product_id, physical_quantity, reserved_quantity, updated_at'),
    ]);
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;
    if (version !== state.version) return;
    state.products = results[0].data || [];
    state.brands = results[1].data || [];
    state.categories = results[2].data || [];
    state.stockLevels = results[3].data || [];
    if (!state.selectedProductId && state.retryOperation?.productId && state.products.some((product) => String(product.id) === String(state.retryOperation.productId))) {
      state.selectedProductId = state.retryOperation.productId;
    }
    if (state.selectedProductId && !selectedProduct()) state.selectedProductId = null;
    await fetchMovements(state.selectedProductId, version);
    if (version === state.version) renderWorkspace(keepMessage ? 'Данните са обновени от сървъра.' : undefined, keepMessage ? 'success' : undefined);
  }

  async function load(session) {
    const version = ++state.version;
    content.replaceChildren(createAlert('info', 'Проверка на администраторския достъп…'));
    try {
      const profile = await getApprovedAdminProfile(session.user.id);
      if (version !== state.version) return;
      if (!profile) { clearProtected('Тази страница е достъпна само за одобрени администратори.'); return; }
      content.replaceChildren(createAlert('info', 'Зареждане на наличностите…'));
      await refreshData();
    } catch (error) {
      if (version === state.version) clearProtected(errorMessage(error, 'Наличностите не могат да бъдат заредени.'), 'danger');
    }
  }

  async function refresh() {
    if (!isSupabaseConfigured) { clearProtected('За наличностите е нужна активна връзка със Supabase.', 'info'); return; }
    const { session, error } = await getSession();
    if (error || !session?.user) { clearProtected('Влезте с одобрен администраторски профил, за да управлявате наличностите.'); return; }
    await load(session);
  }

  const initial = await getSession();
  await refresh(initial.session);
  const unsubscribe = subscribeToSessionChanges((_event, session) => {
    if (!session?.user) clearProtected('Сесията е прекратена. Влезте отново, за да управлявате наличностите.');
    else void load(session);
  });
  window.addEventListener('salon-auth-signed-out', () => { unsubscribe(); clearProtected('Сесията е прекратена.'); }, { once: true });
  window.addEventListener('focus', () => { void refresh(); });
  return main;
}
