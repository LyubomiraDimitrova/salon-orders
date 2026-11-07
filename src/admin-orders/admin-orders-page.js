import { createAlert, getSession, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { getApprovedAdminProfile } from '../services/admin-access.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';

const orderFields = 'id, order_number, source, status, requested_delivery_date, requested_delivery_time_from, requested_delivery_time_to, confirmed_delivery_date, confirmed_delivery_time_from, confirmed_delivery_time_to, salon_name_snapshot, contact_name_snapshot, phone_snapshot, email_snapshot, address_snapshot, delivery_instructions, customer_note, denial_reason, delivered_at, created_at';
const labels = { NEW: 'Нова', APPROVED: 'Одобрена', IN_PROGRESS: 'В обработка', DENIED: 'Отказана', DONE: 'Доставена' };
const euro = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' });
const e = (tag, cls, text) => { const x = document.createElement(tag); x.className = cls || ''; if (text !== undefined) x.textContent = text; return x; };
const blank = (v) => v || '—';
const sofiaDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const sofiaDisplayFormatter = new Intl.DateTimeFormat('bg-BG', {
  timeZone: 'Europe/Sofia', dateStyle: 'medium', timeStyle: 'short',
});

function sofiaDateTimeValues(value) {
  const parts = sofiaDateTimeFormatter.formatToParts(value);
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { date: `${fields.year}-${fields.month}-${fields.day}`, time: `${fields.hour}:${fields.minute}:${fields.second}` };
}

function sofiaOffsetMinutes(value) {
  const fields = sofiaDateTimeValues(value);
  const [year, month, day] = fields.date.split('-').map(Number);
  const [hour, minute, second] = fields.time.split(':').map(Number);
  return (Date.UTC(year, month - 1, day, hour, minute, second) - value.getTime()) / 60000;
}

function sofiaDateTimeToIso(dateValue, timeValue) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue || '');
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeValue || '');
  if (!dateMatch || !timeMatch) return null;
  const [year, month, day] = dateMatch.slice(1).map(Number);
  const [hour, minute, second = 0] = timeMatch.slice(1).map((value) => Number(value || 0));
  const wallTime = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsets = new Set([-12, -6, 0, 6, 12].map((hours) => sofiaOffsetMinutes(new Date(wallTime + hours * 60 * 60 * 1000))));
  const candidates = [...offsets]
    .map((offset) => new Date(wallTime - offset * 60 * 1000))
    .filter((candidate) => {
      const values = sofiaDateTimeValues(candidate);
      return values.date === dateValue && values.time === timeValue;
    })
    .sort((first, second) => first.getTime() - second.getTime());
  return candidates[0]?.toISOString() || null;
}

function savedOperation(key) {
  try { return JSON.parse(sessionStorage.getItem('salon-orders:order-op:' + key)); } catch { return null; }
}

function displaySofiaDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : sofiaDisplayFormatter.format(date);
}
function customerNotes(order) {
  return [
    ['Инструкции за доставка', order.delivery_instructions?.trim()],
    ['Бележка', order.customer_note?.trim()],
  ].filter((note, index, all) => note[1] && all.findIndex((candidate) => candidate[1] === note[1]) === index);
}
function notesHeading(order) {
  return ['phone', 'viber'].includes(order.source) ? 'Бележки' : 'Бележка от клиента';
}
function requestId(key, payload) {
  const k = 'salon-orders:order-op:' + key;
  const saved = sessionStorage.getItem(k);
  if (saved) return { ...JSON.parse(saved), k };
  const operation = { id: crypto.randomUUID(), payload };
  sessionStorage.setItem(k, JSON.stringify(operation));
  return { ...operation, k };
}
function translated(error) { const m = error?.message || ''; if (/fully reserved/i.test(m)) return 'Доставката изисква пълна резервация на всеки ред.'; if (/unknown stock/i.test(m)) return 'За продукта няма въведена наличност.'; if (/Allocation exceeds/i.test(m)) return 'Количеството надвишава липсата или свободната наличност.'; if (/Administrator access/i.test(m)) return 'Нямате одобрен администраторски достъп.'; return m || 'Операцията не е завършена. При неясен резултат повторете същото действие.'; }

export async function createAdminOrdersPage() {
  const main = e('main', 'admin-orders-page py-4 py-md-5');
  main.innerHTML = '<div class="container"><section class="admin-orders-shell"><header class="admin-orders-heading"><div><p class="eyebrow mb-1">АДМИНИСТРАЦИЯ</p><h1 class="h2 mb-1">Поръчки</h1><p class="text-body-secondary mb-0">Обработка, резервиране и доставка.</p></div><span class="badge text-bg-danger new-count" data-new>0 нови</span></header><div class="admin-orders-content mt-4"></div></section></div>';
  const content = main.querySelector('.admin-orders-content');
  const state = { orders: [], order: null, selectedOrderId: null, searchQuery: '', statusFilter: '', lines: [], summaryLines: [], reservations: [], stock: [], busy: false, version: 0, summaryVersion: 0, clients: null, products: null, prices: null, createBusy: false, quantityEditors: new Map() };
  const clear = (message) => { state.version += 1; state.orders = []; state.order = null; state.quantityEditors.clear(); content.replaceChildren(createAlert('warning', message)); };
  const rpc = async (name, payload, key) => { const op = requestId(key, payload); const { error } = await supabase.rpc(name, { p_request_id: op.id, ...op.payload }); if (error) throw error; sessionStorage.removeItem(op.k); };
  const message = (box, type, text) => box.replaceChildren(createAlert(type, text));
  const adminCreateKey = 'salon-orders:admin-create-order';
  const adminDeliveredCreateKey = 'salon-orders:admin-create-delivered-order';
  const adminOrderOperation = () => { try { return JSON.parse(sessionStorage.getItem(adminCreateKey)); } catch { return null; } };
  const adminDeliveredOrderOperation = () => { try { return JSON.parse(sessionStorage.getItem(adminDeliveredCreateKey)); } catch { return null; } };
  const saveAdminDeliveredOrderOperation = (operation) => sessionStorage.setItem(adminDeliveredCreateKey, JSON.stringify(operation));
  async function ensureNewOrderData() {
    if (state.clients && state.products && state.prices) return;
    const [clients, products, prices] = await Promise.all([
      supabase.from('salon_clients').select('id, salon_name, contact_name, phone, email').order('salon_name'),
      supabase.from('products').select('id, name, article_code, size_label').order('name'),
      supabase.rpc('get_admin_product_prices'),
    ]);
    if (clients.error || products.error || prices.error) return;
    state.clients = clients.data || []; state.products = products.data || []; state.prices = new Map((prices.data || []).map((price) => [String(price.product_id), price]));
    redraw = renderList();
  }
  const newUuid = () => crypto.randomUUID();
  const priceLabel = (product) => { const price = state.prices?.get(String(product.id)); return `${product.name}${product.article_code ? ` (${product.article_code})` : ''} — ${price ? euro.format(price.retail_price) : 'без въведена цена'}`; };
  const currentSummaryLines = (orderId) => state.summaryLines.filter((line) => line.order_id === orderId && line.is_current);
  const productSummary = (orderId) => {
    const lines = currentSummaryLines(orderId);
    const first = lines.slice(0, 2).map((line) => `${line.product_name_snapshot} × ${line.quantity}`);
    return [...first, ...(lines.length > 2 ? [`и още ${lines.length - 2} продукта`] : [])].join(' · ');
  };
  async function refreshListSummaries() {
    const summaryVersion = ++state.summaryVersion;
    const orderIds = state.orders.map((order) => order.id);
    if (!orderIds.length) { state.summaryLines = []; return; }
    const { data, error } = await supabase
      .from('order_lines')
      .select('id, order_id, product_name_snapshot, quantity, is_current')
      .in('order_id', orderIds)
      .eq('is_current', true)
      .order('id');
    if (error || summaryVersion !== state.summaryVersion) return;
    state.summaryLines = data || [];
    redraw?.();
  }

  function newOrderPanel() {
    const panel = e('details', 'admin-order-panel mb-3');
    panel.open = false;
    panel.append(e('summary', '', 'Нова поръчка'));
    const body = e('div', 'pt-3'); panel.append(body);
    if (!state.clients || !state.products || !state.prices) { body.append(createAlert('info', 'Зареждане на клиенти, продукти и цени…')); void ensureNewOrderData(); return panel; }
    let deliveredRetry = adminDeliveredOrderOperation();
    const deliveredOrder = deliveredRetry?.orderId && state.orders.find((order) => order.id === deliveredRetry.orderId);
    if (deliveredOrder && deliveredOrder.status !== 'IN_PROGRESS') {
      sessionStorage.removeItem(adminDeliveredCreateKey);
      deliveredRetry = null;
    }
    if (deliveredRetry?.orderId) {
      body.append(createAlert('warning', 'Поръчката е създадена, но доставката ѝ не е потвърдена. Отворете я, за да довършите доставката със запазените дата, час и UUID.'));
      const openOrder = e('button', 'btn btn-outline-primary w-100 mt-3', 'Отвори създадената поръчка');
      openOrder.type = 'button';
      openOrder.onclick = () => { state.selectedOrderId = deliveredRetry.orderId; void load(deliveredRetry.orderId); };
      body.append(openOrder);
      return panel;
    }
    let retry = adminOrderOperation();
    if (retry) body.append(createAlert('warning', 'Има непотвърдена заявка за нова поръчка. Повторете я със запазените UUID и данни.'));
    if (deliveredRetry) body.append(createAlert('warning', 'Има непотвърдена заявка за поръчка като доставена. Повторението ще използва същите данни, дата, час и UUID.'));
    const form = e('form', 'row g-3'); const feedback = e('div', 'col-12'); form.append(feedback);
    const clientField = e('div', 'col-12'); const client = e('select', 'form-select'); client.name = 'client'; client.required = true; client.append(e('option', '', 'Изберете салон')); state.clients.forEach((item) => { const option = e('option', '', `${item.salon_name || item.contact_name || 'Салон без име'}${item.phone ? ` · ${item.phone}` : ''}`); option.value = item.id; client.append(option); }); clientField.append(e('label', 'form-label fw-semibold', 'Салон клиент'), client); form.append(clientField);
    const statusField = e('div', 'col-12'); const status = e('select', 'form-select'); status.name = 'status'; [['APPROVED', 'Одобрена'], ['IN_PROGRESS', 'В обработка']].forEach(([value, label]) => { const option = e('option', '', label); option.value = value; status.append(option); }); statusField.append(e('label', 'form-label fw-semibold', 'Начален статус'), status);
    const deliveredField = e('div', 'col-12'); const deliveredToggle = e('input', 'form-check-input'); deliveredToggle.type = 'checkbox'; deliveredToggle.name = 'createDelivered'; deliveredToggle.id = 'create-delivered-order';
    const deliveredLabel = e('label', 'form-check-label fw-semibold', 'Създай като доставена'); deliveredLabel.htmlFor = deliveredToggle.id;
    const deliveredHelp = e('p', 'form-text mb-0', 'Изисква пълна резервация. Доставката ще приспадне наличността и ще влезе в отчетите за действителната дата. Ако продажбата вече е приспадната ръчно, първо я изравнете.');
    const actualDelivery = e('div', 'row g-2 mt-1'); actualDelivery.hidden = true;
    const defaultActual = sofiaDateTimeValues(new Date());
    const actualDate = e('input', 'form-control'); actualDate.type = 'date'; actualDate.name = 'actualDate'; actualDate.value = defaultActual.date;
    const actualTime = e('input', 'form-control'); actualTime.type = 'time'; actualTime.name = 'actualTime'; actualTime.step = '1'; actualTime.value = defaultActual.time;
    [['Реална дата на доставка', actualDate], ['Реален час на доставка', actualTime]].forEach(([label, input]) => { const field = e('div', 'col-12 col-sm-6'); field.append(e('label', 'form-label fw-semibold', label), input); actualDelivery.append(field); });
    deliveredField.append(e('div', 'form-check', undefined), deliveredHelp, actualDelivery); deliveredField.firstElementChild.append(deliveredToggle, deliveredLabel);
    const requestedDate = e('input', 'form-control'); requestedDate.type = 'date'; requestedDate.name = 'requestedDate'; const confirmedDate = e('input', 'form-control'); confirmedDate.type = 'date'; confirmedDate.name = 'confirmedDate'; const dateFields = []; [['Заявена дата', requestedDate], ['Потвърдена дата', confirmedDate]].forEach(([label, input]) => { const field = e('div', 'col-12 col-sm-6'); field.append(e('label', 'form-label fw-semibold', label), input); dateFields.push(field); });
    const notes = e('textarea', 'form-control'); notes.name = 'notes'; notes.rows = 2; const notesField = e('div', 'col-12'); notesField.append(e('label', 'form-label fw-semibold', 'Бележки'), notes, e('p', 'form-text mb-0', 'Удобен час за доставка или други уточнения.'));
    const linesBox = e('div', 'col-12'); linesBox.append(e('h3', 'h6 mb-2', 'Продукти'));
    const rows = e('div', 'd-grid gap-2'); const add = e('button', 'btn btn-outline-primary w-100 mt-2', 'Добави продукт'); add.type = 'button';
    let productPickerIndex = 0;
    const addRow = () => {
      const row = e('div', 'row g-2 align-items-end');
      const productField = e('div', 'col-12 col-sm-8');
      const picker = e('div', 'admin-order-product-picker');
      const productId = e('input'); productId.type = 'hidden'; productId.dataset.productId = 'true';
      const pickerId = `admin-order-product-picker-${++productPickerIndex}`;
      const product = e('input', 'form-control'); product.type = 'search'; product.name = 'productSearch'; product.autocomplete = 'off'; product.placeholder = 'Име или артикулен код'; product.required = true; product.id = pickerId; product.setAttribute('role', 'combobox'); product.setAttribute('aria-autocomplete', 'list'); product.setAttribute('aria-expanded', 'false');
      const productLabel = e('label', 'form-label', 'Продукт'); productLabel.htmlFor = pickerId;
      const clearProduct = e('button', 'btn btn-outline-secondary', 'Изчисти'); clearProduct.type = 'button'; clearProduct.disabled = true; clearProduct.ariaLabel = 'Изчисти избрания продукт';
      const inputGroup = e('div', 'input-group'); inputGroup.append(product, clearProduct);
      const results = e('div', 'admin-order-product-results list-group'); results.id = `${pickerId}-results`; results.setAttribute('role', 'listbox'); results.hidden = true; product.setAttribute('aria-controls', results.id);
      const resultStatus = e('p', 'visually-hidden'); resultStatus.setAttribute('aria-live', 'polite');
      let matches = [];
      let activeIndex = -1;
      const searchable = (item) => [item.name, item.article_code].filter(Boolean).join(' ').toLocaleLowerCase('bg');
      const displayProduct = (item) => `${item.name}${item.article_code ? ` · ${item.article_code}` : ''}`;
      const closeResults = () => { results.hidden = true; product.setAttribute('aria-expanded', 'false'); product.removeAttribute('aria-activedescendant'); activeIndex = -1; };
      const chooseProduct = (item) => { productId.value = item.id; product.value = displayProduct(item); product.setCustomValidity(''); clearProduct.disabled = false; closeResults(); resultStatus.textContent = `Избран продукт: ${displayProduct(item)}.`; };
      const renderResults = () => {
        const query = product.value.trim().toLocaleLowerCase('bg');
        matches = state.products.filter((item) => !query || searchable(item).includes(query));
        activeIndex = -1; results.replaceChildren();
        if (!matches.length) {
          const empty = e('div', 'list-group-item text-body-secondary', 'Няма продукти с това име или артикулен код.'); empty.setAttribute('role', 'status'); results.append(empty); resultStatus.textContent = empty.textContent;
        } else {
          matches.slice(0, 30).forEach((item, index) => {
            const option = e('button', 'list-group-item list-group-item-action text-start'); option.type = 'button'; option.id = `${pickerId}-option-${index}`; option.setAttribute('role', 'option'); option.append(e('strong', 'd-block', item.name), e('small', 'text-body-secondary', `${item.article_code || 'Без артикулен код'} · ${priceLabel(item)}`)); option.onmousedown = (event) => event.preventDefault(); option.onclick = () => chooseProduct(item); results.append(option);
          });
          matches = matches.slice(0, 30); resultStatus.textContent = `${matches.length} продукта.`;
        }
        results.hidden = false; product.setAttribute('aria-expanded', 'true');
      };
      const setActive = (index) => {
        if (!matches.length) return;
        activeIndex = (index + matches.length) % matches.length;
        [...results.querySelectorAll('[role="option"]')].forEach((option, optionIndex) => option.classList.toggle('active', optionIndex === activeIndex));
        const active = results.querySelector(`[role="option"]:nth-child(${activeIndex + 1})`);
        if (active) { product.setAttribute('aria-activedescendant', active.id); active.scrollIntoView({ block: 'nearest' }); }
      };
      product.oninput = renderResults;
      product.onfocus = renderResults;
      product.onkeydown = (event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); if (results.hidden) renderResults(); setActive(activeIndex + 1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); if (results.hidden) renderResults(); setActive(activeIndex - 1); }
        else if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); chooseProduct(matches[activeIndex]); }
        else if (event.key === 'Escape') { closeResults(); }
      };
      product.onblur = () => window.setTimeout(closeResults, 150);
      clearProduct.onclick = () => { productId.value = ''; product.value = ''; product.setCustomValidity(''); clearProduct.disabled = true; resultStatus.textContent = 'Избраният продукт е изчистен.'; product.focus(); renderResults(); };
      picker.append(productId, productLabel, inputGroup, results, resultStatus); productField.append(picker);
      const quantityField = e('div', 'col-8 col-sm-3'); const quantity = e('input', 'form-control'); quantity.type = 'number'; quantity.min = '1'; quantity.step = '1'; quantity.value = '1'; quantity.required = true; quantityField.append(e('label', 'form-label', 'Брой'), quantity);
      const removeField = e('div', 'col-4 col-sm-1'); const remove = e('button', 'btn btn-outline-danger w-100', '×'); remove.type = 'button'; remove.ariaLabel = 'Премахни продукт'; remove.title = 'Премахни продукт'; remove.onclick = () => row.remove(); removeField.append(e('label', 'form-label d-block', ' '), remove);
      row.append(productField, quantityField, removeField); rows.append(row);
    };
    add.onclick = addRow; addRow(); linesBox.append(rows, add, e('p', 'form-text mb-0', 'Недостатъчната или неизвестна наличност не спира създаването.'));
    const submitField = e('div', 'col-12'); const submit = e('button', 'btn btn-primary w-100', retry ? 'Повтори новата поръчка' : 'Създай поръчка'); submit.type = 'submit'; submitField.append(submit);
    const updateDeliveredFields = () => { const isDelivered = deliveredToggle.checked; actualDelivery.hidden = !isDelivered; actualDate.required = isDelivered; actualTime.required = isDelivered; status.disabled = isDelivered; if (isDelivered) status.value = 'IN_PROGRESS'; submit.textContent = retry ? 'Повтори новата поръчка' : (deliveredRetry ? 'Повтори създаването като доставена' : (isDelivered ? 'Създай като доставена' : 'Създай поръчка')); };
    if (retry || deliveredRetry) { deliveredToggle.disabled = true; if (deliveredRetry) { deliveredToggle.checked = true; const savedValues = sofiaDateTimeValues(new Date(deliveredRetry.deliveredAt)); actualDate.value = savedValues.date; actualTime.value = savedValues.time; actualDate.disabled = true; actualTime.disabled = true; } }
    deliveredToggle.onchange = updateDeliveredFields; updateDeliveredFields();
    form.append(linesBox, statusField, deliveredField, ...dateFields, notesField, submitField);
    form.onsubmit = async (event) => { event.preventDefault(); if (state.createBusy) return; const lineValues = [...rows.children].map((row) => ({ product_id: Number(row.querySelector('[data-product-id]').value), quantity: Number(row.querySelector('input[type="number"]').value) })); if (!client.value || !lineValues.length || lineValues.some((line) => !Number.isInteger(line.product_id) || !Number.isInteger(line.quantity) || line.quantity <= 0)) { message(feedback, 'danger', 'Изберете салон и поне един продукт с положително цяло количество.'); return; }
      if (deliveredRetry) { await createAndDeliverAdminOrder(deliveredRetry, feedback, submit); return; }
      const payload = { p_salon_client_id: Number(client.value), p_source: 'phone', p_initial_status: status.value, p_requested_delivery_date: requestedDate.value || null, p_requested_delivery_time_from: null, p_requested_delivery_time_to: null, p_confirmed_delivery_date: confirmedDate.value || null, p_confirmed_delivery_time_from: null, p_confirmed_delivery_time_to: null, p_delivery_instructions: null, p_customer_note: notes.value.trim() || null, p_lines: lineValues };
      if (deliveredToggle.checked) {
        const deliveredAt = sofiaDateTimeToIso(actualDate.value, actualTime.value);
        if (!deliveredAt) { message(feedback, 'danger', 'Въведеният час не е валиден за Европа/София. Изберете друга дата или час.'); return; }
        const operation = { create: { id: newUuid(), payload: { ...payload, p_initial_status: 'IN_PROGRESS' } }, deliveredAt, orderId: null, delivery: null };
        saveAdminDeliveredOrderOperation(operation);
        await createAndDeliverAdminOrder(operation, feedback, submit);
        return;
      }
      const operation = retry || { id: newUuid(), payload }; retry = operation; state.createBusy = true; submit.disabled = true; message(feedback, 'info', 'Създаване на поръчката…'); try { sessionStorage.setItem(adminCreateKey, JSON.stringify(operation)); const { data, error } = await supabase.rpc('create_admin_order', { p_request_id: operation.id, ...operation.payload }); if (error) throw error; sessionStorage.removeItem(adminCreateKey); retry = null; state.selectedOrderId = (Array.isArray(data) ? data[0] : data).order_id; await refreshOrdersAndSelection(); message(feedback, 'success', 'Поръчката е създадена и е отворена с резервите и недостига си.'); } catch (error) { message(feedback, 'danger', `Резултатът не е потвърден: ${translated(error)} Повторете същата заявка.`); } finally { state.createBusy = false; if (submit.isConnected) submit.disabled = false; } };
    body.append(form); return panel;
  }

  function renderList() {
    content.innerHTML = '<div class="row g-4"><section class="col-12 col-xl-5"><div class="admin-order-panel"><label class="form-label fw-semibold">Търсене</label><input class="form-control" data-search type="search" placeholder="Номер, салон или контакт"><label class="form-label fw-semibold mt-3">Статус</label><select class="form-select" data-filter><option value="">Всички</option><option>NEW</option><option>APPROVED</option><option>IN_PROGRESS</option><option>DENIED</option><option>DONE</option></select><div class="admin-order-list mt-3" data-list></div></div></section><section class="col-12 col-xl-7"><div class="admin-order-panel" data-detail><p class="text-body-secondary mb-0">Изберете поръчка.</p></div></section></div>';
    const list = content.querySelector('[data-list]'); const search = content.querySelector('[data-search]'); const filter = content.querySelector('[data-filter]');
    list.parentElement.insertBefore(newOrderPanel(), list);
    search.value = state.searchQuery; filter.value = state.statusFilter;
    const draw = () => { list.replaceChildren(); const q = state.searchQuery.toLowerCase(); const rows = state.orders.filter((o) => (!state.statusFilter || o.status === state.statusFilter) && (!q || [o.order_number, o.salon_name_snapshot, o.contact_name_snapshot].join(' ').toLowerCase().includes(q))); if (!rows.length) list.append(createAlert('info', 'Няма поръчки по този филтър.')); rows.forEach((o) => { const b = e('button', 'admin-order-card text-start' + (state.selectedOrderId === o.id ? ' selected' : '')); b.type = 'button'; b.innerHTML = '<span class="badge text-bg-secondary">' + labels[o.status] + '</span><strong>№ ' + o.order_number + '</strong><span>' + blank(o.salon_name_snapshot || o.contact_name_snapshot) + '</span><small>' + blank(o.confirmed_delivery_date || o.requested_delivery_date) + '</small>'; const summary = productSummary(o.id); if (summary) b.append(e('small', 'admin-order-product-summary', summary)); b.onclick = () => load(o.id); list.append(b); }); };
    search.oninput = () => { state.searchQuery = search.value; draw(); }; filter.onchange = () => { state.statusFilter = filter.value; draw(); }; draw(); void refreshListSummaries(); return draw;
  }
  let redraw;
  const activeQty = (line) => state.reservations.filter((r) => r.order_line_id === line.id && r.status === 'active').reduce((n, r) => n + r.quantity, 0);
  const pendingDeliveredOrderFor = (orderId) => {
    const operation = adminDeliveredOrderOperation();
    return operation?.orderId === orderId && operation?.delivery?.payload?.p_order_id === orderId && operation?.delivery?.payload?.p_delivered_at ? operation : null;
  };
  const deliveryReservationIssue = (orderId) => {
    if (state.order?.id !== orderId) return 'Създадената поръчка не може да се зареди за проверка на резервациите.';
    const current = state.lines.filter((line) => line.is_current);
    if (!current.length) return 'Създадената поръчка няма редове за доставка.';
    const unknown = current.filter((line) => !state.stock.some((item) => item.product_id === line.product_id));
    if (unknown.length) return `Няма въведена наличност за: ${unknown.map((line) => line.product_name_snapshot).join(', ')}. Въведете наличност, след това резервирайте всички количества.`;
    const incomplete = current.filter((line) => activeQty(line) !== line.quantity);
    if (incomplete.length) return `Не са резервирани всички количества: ${incomplete.map((line) => `${line.product_name_snapshot} (${activeQty(line)} от ${line.quantity})`).join(', ')}. Резервирайте липсващите количества преди доставка.`;
    return null;
  };
  const visibleFeedback = (fallback) => content.querySelector('[data-detail] [data-feedback]') || fallback;
  async function createAndDeliverAdminOrder(operation, fallbackFeedback, control) {
    if (state.createBusy) return;
    state.createBusy = true; control.disabled = true;
    try {
      if (!operation?.create?.id || !operation?.create?.payload || !operation.deliveredAt) throw new Error('Запазената заявка за поръчка като доставена е невалидна.');
      saveAdminDeliveredOrderOperation(operation);
      if (!operation.orderId) {
        message(fallbackFeedback, 'info', 'Създаване на поръчката…');
        const { data, error } = await supabase.rpc('create_admin_order', { p_request_id: operation.create.id, ...operation.create.payload });
        if (error) throw error;
        const created = Array.isArray(data) ? data[0] : data;
        if (!created?.order_id) throw new Error('Създадената поръчка не върна номер за проследяване.');
        operation.orderId = created.order_id;
        operation.delivery = { id: newUuid(), payload: { p_order_id: operation.orderId, p_delivered_at: operation.deliveredAt } };
        saveAdminDeliveredOrderOperation(operation);
      }
      state.selectedOrderId = operation.orderId;
      await refreshOrdersAndSelection();
      const feedback = visibleFeedback(fallbackFeedback);
      if (state.order?.id !== operation.orderId) {
        message(feedback, 'warning', 'Поръчката е създадена, но не може да се зареди за проверка. Не е изпратено отбелязване на доставка; отворете запазената поръчка и повторете действието.');
        return;
      }
      if (state.order.status === 'DONE') {
        sessionStorage.removeItem(adminDeliveredCreateKey);
        message(feedback, 'success', 'Поръчката вече е отбелязана като доставена.');
        return;
      }
      if (state.order.status !== 'IN_PROGRESS') throw new Error('Създадената поръчка не е в статус „В обработка“ и не може да се достави.');
      const issue = deliveryReservationIssue(operation.orderId);
      if (issue) {
        message(feedback, 'warning', `Поръчката е създадена, но не е отбелязана като доставена. ${issue}`);
        return;
      }
      message(feedback, 'info', 'Отбелязване на доставка…');
      const { error } = await supabase.rpc('deliver_order', { p_request_id: operation.delivery.id, ...operation.delivery.payload });
      if (error) throw error;
      sessionStorage.removeItem(adminDeliveredCreateKey);
      await refreshOrdersAndSelection();
      message(visibleFeedback(fallbackFeedback), 'success', 'Поръчката е създадена като доставена. Наличността е приспадната и продажбата е включена за действителната дата на доставка.');
    } catch (error) {
      message(visibleFeedback(fallbackFeedback), 'danger', `Поръчката може вече да е създадена, но доставката не е потвърдена: ${translated(error)} Отворете запазената поръчка и повторете същото действие.`);
    } finally {
      state.createBusy = false;
      if (control.isConnected) control.disabled = false;
    }
  }
  async function run(control, box, task) { if (state.busy) return; state.busy = true; control.disabled = true; message(box, 'info', 'Изпращане… При прекъсване повторете същото действие.'); try { await task(); message(box, 'success', 'Промяната е записана. Обновяване…'); await refreshOrdersAndSelection(); } catch (error) { message(box, 'danger', translated(error)); } finally { state.busy = false; control.disabled = false; } }
  function button(label, style, box, task, disabled, confirmation) { const b = e('button', 'btn ' + style + ' w-100', label); b.type = 'button'; b.disabled = !!disabled; b.title = disabled ? 'Първо резервирайте всички количества.' : ''; b.onclick = () => run(b, box, async () => { if (!confirmation || window.confirm(confirmation)) await task(); }); return b; }

  async function prices(box, orderId) { const { data, error } = await supabase.rpc('get_admin_order_price_snapshots', { p_order_id: orderId }); if (error || state.order?.id !== orderId) { box.textContent = 'Цените не могат да се заредят.'; return; } const current = (data || []).filter((x) => x.is_current); const total = current.reduce((n, x) => n + Number(x.retail_price) * x.quantity, 0); box.innerHTML = '<ul class="list-unstyled mb-2">' + current.map((x) => '<li>' + x.product_name_snapshot + ' × ' + x.quantity + ': ' + euro.format(x.retail_price) + '</li>').join('') + '</ul><strong>Общо: ' + euro.format(total) + '</strong>'; }
  function quantityEditorForm(order, current, feedback) {
    const key = 'replace:' + order.id;
    const expectedIds = current.map((line) => String(line.product_id));
    const quantityMap = (lines) => {
      if (!Array.isArray(lines) || lines.length !== expectedIds.length) return null;
      const quantities = {};
      for (const line of lines) {
        const productId = String(line.product_id);
        const quantity = Number(line.quantity);
        if (!expectedIds.includes(productId) || !Number.isInteger(quantity) || quantity <= 0 || quantities[productId] !== undefined) return null;
        quantities[productId] = quantity;
      }
      return expectedIds.every((productId) => quantities[productId] !== undefined) ? quantities : null;
    };
    const sameQuantities = (first, second) => expectedIds.every((productId) => Number(first?.[productId]) === Number(second?.[productId]));
    const confirmed = Object.fromEntries(current.map((line) => [String(line.product_id), Number(line.quantity)]));
    let savedRetry = savedOperation(key);
    let retryQuantities = quantityMap(savedRetry?.payload?.p_lines);
    let editor = state.quantityEditors.get(order.id);
    if (!editor) {
      editor = { baseline: confirmed, draft: Object.fromEntries(expectedIds.map((productId) => [productId, String((retryQuantities || confirmed)[productId])])) };
      state.quantityEditors.set(order.id, editor);
    } else if (!retryQuantities && sameQuantities(quantityMap(Object.entries(editor.draft).map(([product_id, quantity]) => ({ product_id, quantity }))) || {}, editor.baseline)) {
      editor.baseline = confirmed;
      editor.draft = Object.fromEntries(expectedIds.map((productId) => [productId, String(confirmed[productId])]));
    }
    const form = e('form', 'mt-3');
    form.noValidate = true;
    form.append(e('label', 'form-label fw-semibold', 'Редакция на количества'));
    if (savedRetry) form.append(createAlert('warning', 'Има непотвърдено запазване. Повторението ще използва същите количества и UUID.'));
    const inputs = current.map((line) => {
      const group = e('div', 'input-group mb-2');
      group.append(e('span', 'input-group-text', line.product_name_snapshot));
      const input = e('input', 'form-control'); input.type = 'number'; input.min = '1'; input.step = '1'; input.dataset.product = line.product_id; input.value = editor.draft[String(line.product_id)] ?? String(line.quantity); input.setAttribute('aria-label', `Количество за ${line.product_name_snapshot}`); group.append(input); form.append(group); return input;
    });
    const submit = e('button', 'btn btn-outline-primary w-100', savedRetry ? 'Повтори запазването на количествата' : 'Запази количествата'); submit.type = 'submit'; form.append(submit);
    const currentQuantities = () => Object.fromEntries(inputs.map((input) => [String(input.dataset.product), input.value]));
    const sync = () => {
      editor.draft = currentQuantities();
      const quantities = quantityMap(Object.entries(editor.draft).map(([product_id, quantity]) => ({ product_id, quantity })));
      const changed = !!quantities && !sameQuantities(quantities, editor.baseline);
      const matchesRetry = !retryQuantities || (!!quantities && sameQuantities(quantities, retryQuantities));
      submit.disabled = state.busy || !changed || !matchesRetry;
      submit.title = !matchesRetry ? 'Първо върнете количествата от непотвърденото запазване, за да повторите същата заявка.' : (!quantities ? 'Въведете положителни цели количества.' : (changed ? '' : 'Няма променени количества за запазване.'));
    };
    inputs.forEach((input) => input.oninput = sync); sync();
    form.onsubmit = async (event) => {
      event.preventDefault(); sync(); if (submit.disabled || state.busy) return;
      const currentValues = quantityMap(Object.entries(editor.draft).map(([product_id, quantity]) => ({ product_id, quantity })));
      const payload = savedRetry?.payload || { p_order_id: order.id, p_lines: expectedIds.map((productId) => ({ product_id: Number(productId), quantity: currentValues[productId] })) };
      state.busy = true; submit.disabled = true; message(feedback, 'info', 'Запазване на количествата…');
      try {
        const operation = requestId(key, payload);
        const { error } = await supabase.rpc('replace_approved_order_lines', { p_request_id: operation.id, ...operation.payload });
        if (error) throw error;
        sessionStorage.removeItem(operation.k); savedRetry = null; retryQuantities = null;
        const savedQuantities = quantityMap(payload.p_lines);
        editor.baseline = savedQuantities;
        editor.draft = Object.fromEntries(expectedIds.map((productId) => [productId, String(savedQuantities[productId])]));
        await refreshOrdersAndSelection();
        message(visibleFeedback(feedback), 'success', 'Количествата са запазени.');
      } catch (error) {
        savedRetry = savedOperation(key); retryQuantities = quantityMap(savedRetry?.payload?.p_lines); submit.textContent = 'Повтори запазването на количествата';
        message(feedback, 'danger', `Количествата не са потвърдени: ${translated(error)} Повторете същото запазване.`);
      } finally {
        state.busy = false;
        if (submit.isConnected) sync();
      }
    };
    return form;
  }
  function detail() {
    const o = state.order; const detailBox = content.querySelector('[data-detail]'); const current = state.lines.filter((x) => x.is_current); const fullyReserved = current.every((x) => activeQty(x) === x.quantity);
    detailBox.innerHTML = '<div class="d-flex justify-content-between mb-3"><div><p class="eyebrow mb-1">ПОРЪЧКА № ' + o.order_number + '</p><h2 class="h4 mb-0">' + labels[o.status] + '</h2></div><span class="badge text-bg-secondary">' + o.source + '</span></div><div data-feedback></div><div class="snapshot-grid"><div><b>Салон</b><br>' + blank(o.salon_name_snapshot) + '</div><div><b>Контакт</b><br>' + blank(o.contact_name_snapshot) + '<br>' + blank(o.phone_snapshot) + '<br>' + blank(o.email_snapshot) + '</div><div><b>Адрес</b><br>' + blank(o.address_snapshot) + '</div><div><b>Желан ден за доставка</b><br>' + (o.requested_delivery_date || 'Не е посочен') + '</div><div><b>Потвърден ден за доставка</b><br>' + (o.confirmed_delivery_date || 'Още не е потвърден') + '</div><div><b>Бележка за доставка от клиента</b><br>' + (o.delivery_instructions || 'Не е посочена') + '</div><div><b>Бележка към поръчката</b><br>' + blank(o.customer_note) + '</div></div><details class="mt-3"><summary>Дати и детайли за доставка</summary><form class="row g-2 pt-3" data-delivery>' + dateInputs(o) + '<div class="col-12"><label class="form-label">Инструкции</label><textarea class="form-control" name="instructions">' + (o.delivery_instructions || '') + '</textarea></div><div class="col-12"><label class="form-label">Бележка</label><textarea class="form-control" name="note">' + (o.customer_note || '') + '</textarea></div>' + (['APPROVED','IN_PROGRESS'].includes(o.status) ? '<div class="col-12"><button class="btn btn-outline-primary w-100">Запази детайлите</button></div>' : '') + '</form></details><h3 class="h5 mt-4">Редове и резервиране</h3><div data-lines></div><details class="mt-3"><summary>Исторически цени и общо</summary><div class="pt-3" data-prices>Зареждане…</div></details><div class="admin-order-actions mt-4" data-actions></div>';
    if (o.status === 'DONE') {
      const actual = e('div');
      actual.append(e('b', '', 'Реална дата и час на доставка'), document.createElement('br'), document.createTextNode(displaySofiaDateTime(o.delivered_at)));
      detailBox.querySelector('.snapshot-grid').append(actual);
    }
    [...detailBox.querySelectorAll('.snapshot-grid > div')].filter((item) => item.textContent.startsWith('Бележка за доставка') || item.textContent.startsWith('Бележка към')).forEach((item) => item.remove());
    const notes = customerNotes(o);
    if (notes.length) {
      const noteSection = e('section', 'mt-3');
      noteSection.append(e('h3', 'h6', notesHeading(o)));
      notes.forEach((note) => {
        const paragraph = e('p', 'mb-1');
        if (notes.length > 1) paragraph.append(e('strong', '', note[0] + ': '));
        paragraph.append(document.createTextNode(note[1]));
        noteSection.append(paragraph);
      });
      detailBox.querySelector('.snapshot-grid').after(noteSection);
    }
    const protectedForm = detailBox.querySelector('[data-delivery]');
    protectedForm.querySelector('[name="instructions"]').closest('.col-12').remove();
    protectedForm.querySelector('[name="note"]').closest('.col-12').remove();
    const feedback = detailBox.querySelector('[data-feedback]');
    if (state.statusFilter && state.statusFilter !== o.status) {
      message(feedback, 'info', 'Поръчката вече не отговаря на активния филтър и е премахната от списъка, но детайлите остават отворени.');
    }
    const lines = detailBox.querySelector('[data-lines]');
    lines.previousElementSibling.textContent = 'Продукти и наличности';
    current.forEach((line) => {
      const reserved = activeQty(line);
      const shortage = line.quantity - reserved;
      const stock = state.stock.find((item) => item.product_id === line.product_id);
      const card = e('article', 'order-line-card');
      card.append(e('strong', '', line.product_name_snapshot));
      if (line.product_size_snapshot) card.append(e('small', 'text-body-secondary', line.product_size_snapshot));
      const quantities = e('div', 'order-stock-summary');
      [['Поръчани', line.quantity], ['Резервирани за тази поръчка', reserved], ['Недостиг', shortage]].forEach(([label, value]) => {
        const item = e('span', 'order-stock-item'); item.append(document.createTextNode(`${label}: `), e('strong', '', String(value))); quantities.append(item);
      });
      if (stock) {
        const physical = Number(stock.physical_quantity);
        const available = physical - Number(stock.reserved_quantity);
        [['Общо в склада', physical], ['Свободни в склада', available]].forEach(([label, value]) => {
          const item = e('span', 'order-stock-item'); item.append(document.createTextNode(`${label}: `), e('strong', '', String(value))); quantities.append(item);
        });
      } else {
        quantities.append(e('span', 'order-stock-unknown', 'Наличността не е въведена'));
      }
      card.append(quantities);
      if (shortage && ['APPROVED','IN_PROGRESS'].includes(o.status)) { const form = e('form', 'd-flex gap-2 mt-2'); form.innerHTML = '<input class="form-control" type="number" min="1" max="' + shortage + '" required><button class="btn btn-outline-primary">Резервирай</button>'; form.onsubmit = (ev) => { ev.preventDefault(); const q = Number(form.querySelector('input').value); run(form.querySelector('button'), feedback, () => rpc('allocate_waiting_order_line', { p_order_line_id: line.id, p_quantity: q }, 'allocate:' + line.id)); }; card.append(form); }
      lines.append(card);
    });
    if (o.status === 'APPROVED') lines.append(quantityEditorForm(o, current, feedback));
    const actions = detailBox.querySelector('[data-actions]');
    if (o.status === 'NEW') { const f = e('form', ''); f.innerHTML = '<label class="form-label fw-semibold">Потвърдена дата</label><input class="form-control mb-2" name="date" type="date" required><div class="row g-2"><div class="col"><input class="form-control" name="from" type="time"></div><div class="col"><input class="form-control" name="to" type="time"></div></div><button class="btn btn-primary w-100 mt-2">Одобри и резервирай</button>'; f.onsubmit = (ev) => { ev.preventDefault(); run(f.querySelector('button'), feedback, () => rpc('approve_order', { p_order_id:o.id, p_confirmed_delivery_date:f.date.value, p_confirmed_delivery_time_from:f.from.value || null, p_confirmed_delivery_time_to:f.to.value || null, p_delivery_instructions:null }, 'approve:' + o.id)); }; actions.append(f); }
    if (o.status === 'APPROVED') actions.append(button('Започни обработка', 'btn-outline-primary', feedback, () => rpc('start_order_delivery', { p_order_id:o.id }, 'start:' + o.id)));
    if (o.status === 'IN_PROGRESS') actions.append(deliveryCompletionForm(o, feedback, fullyReserved));
    if (['NEW','APPROVED','IN_PROGRESS'].includes(o.status)) actions.append(button('Откажи поръчката', 'btn-outline-danger', feedback, async () => { const reason = window.prompt('Посочете задължителна причина за отказ:'); if (!reason?.trim()) throw new Error('Причината за отказ е задължителна.'); await rpc('deny_order', { p_order_id:o.id, p_denial_reason:reason }, 'deny:' + o.id); }, false, 'Потвърждавате ли отказа?'));
    const delivery = detailBox.querySelector('[data-delivery]'); if (delivery) delivery.onsubmit = (ev) => { ev.preventDefault(); run(delivery.querySelector('button'), feedback, () => rpc('update_order_delivery_details', { p_order_id:o.id, p_requested_delivery_date:delivery.requestedDate.value || null, p_requested_delivery_time_from:delivery.requestedFrom.value || null, p_requested_delivery_time_to:delivery.requestedTo.value || null, p_confirmed_delivery_date:delivery.confirmedDate.value || null, p_confirmed_delivery_time_from:delivery.confirmedFrom.value || null, p_confirmed_delivery_time_to:delivery.confirmedTo.value || null, p_delivery_instructions:o.delivery_instructions, p_customer_note:o.customer_note }, 'details:' + o.id)); };
    prices(detailBox.querySelector('[data-prices]'), o.id);
  }
  function deliveryCompletionForm(order, feedback, fullyReserved) {
    const key = 'deliver:' + order.id;
    const savedCreatedDelivery = pendingDeliveredOrderFor(order.id);
    const saved = savedCreatedDelivery?.delivery || savedOperation(key);
    const savedTimestamp = saved?.payload?.p_order_id === order.id && saved?.payload?.p_delivered_at;
    const values = sofiaDateTimeValues(savedTimestamp ? new Date(saved.payload.p_delivered_at) : new Date());
    const form = e('form', 'delivery-completion-form');
    form.noValidate = true;
    form.append(e('h3', 'h5 mb-1', 'Реална дата и час на доставка'));
    form.append(e('p', 'text-body-secondary small mb-3', 'Часът се тълкува в часовата зона Европа/София. Доставката ще приспадне резервираната наличност. Ако същата продажба вече е приспадната ръчно, първо я изравнете.'));
    if (savedTimestamp) form.append(createAlert('warning', savedCreatedDelivery ? 'Поръчката е създадена, но доставката не е потвърдена. Повторението ще използва същите дата, час и UUID.' : 'Има непотвърдена заявка за доставка. Повторението ще използва същите дата, час и UUID.'));
    if (!fullyReserved) form.append(createAlert('warning', 'Първо резервирайте всички количества, за да отбележите доставка.'));
    const row = e('div', 'row g-2');
    [['date', 'Дата', values.date], ['time', 'Час', values.time]].forEach(([name, label, value]) => {
      const field = e('div', 'col-12 col-sm-6'); const input = e('input', 'form-control');
      input.type = name; input.name = name; input.value = value; input.required = true; input.disabled = !!savedTimestamp; if (name === 'time') input.step = '1';
      const inputLabel = e('label', 'form-label fw-semibold', label); inputLabel.htmlFor = `actual-delivery-${name}-${order.id}`; input.id = inputLabel.htmlFor;
      field.append(inputLabel, input); row.append(field);
    });
    const submit = e('button', 'btn btn-success w-100 mt-3', savedTimestamp ? (savedCreatedDelivery ? 'Повтори доставката на създадената поръчка' : 'Повтори отбелязването на доставка') : 'Отбележи като доставена');
    submit.type = 'submit'; submit.disabled = !fullyReserved; submit.title = !fullyReserved ? 'Първо резервирайте всички количества.' : '';
    form.append(row, submit);
    form.onsubmit = (event) => {
      event.preventDefault();
      const p_delivered_at = savedTimestamp || sofiaDateTimeToIso(form.elements.date.value, form.elements.time.value);
      if (!p_delivered_at) {
        message(feedback, 'danger', 'Въведеният час не е валиден за Европа/София. Изберете друга дата или час.');
        return;
      }
      if (!window.confirm('Потвърждавате ли доставката? Тя ще приспадне резервираната наличност. Ако тази продажба вече е приспадната ръчно, първо я изравнете.')) return;
      if (savedCreatedDelivery) { void createAndDeliverAdminOrder(savedCreatedDelivery, feedback, submit); return; }
      run(submit, feedback, () => rpc('deliver_order', { p_order_id: order.id, p_delivered_at }, key));
    };
    return form;
  }
  function dateInputs(o) { return [['requestedDate','Заявена дата',o.requested_delivery_date,'date'],['requestedFrom','Заявено от',o.requested_delivery_time_from,'time'],['requestedTo','Заявено до',o.requested_delivery_time_to,'time'],['confirmedDate','Потвърдена дата',o.confirmed_delivery_date,'date'],['confirmedFrom','Потвърдено от',o.confirmed_delivery_time_from,'time'],['confirmedTo','Потвърдено до',o.confirmed_delivery_time_to,'time']].map((x) => '<div class="col-6"><label class="form-label">' + x[1] + '</label><input class="form-control" name="' + x[0] + '" type="' + x[3] + '" value="' + (x[2] || '') + '"></div>').join(''); }
  async function load(id) { state.selectedOrderId = id; const v = ++state.version; const { data:o, error } = await supabase.from('orders').select(orderFields).eq('id',id).single(); if (v !== state.version) return; if (error) { const feedback = content.querySelector('[data-feedback]'); if (feedback) message(feedback, 'danger', 'Детайлите не могат да бъдат обновени. Последно заредените данни остават видими.'); return; } const {data:lines} = await supabase.from('order_lines').select('id, order_id, product_id, product_name_snapshot, product_size_snapshot, quantity, is_current').eq('order_id',id); const ids=(lines || []).map((x)=>x.id); const [{data:reservations},{data:stock}] = await Promise.all([ids.length ? supabase.from('stock_reservations').select('order_line_id, quantity, status').in('order_line_id',ids) : Promise.resolve({data:[]}),supabase.from('stock_levels').select('product_id, physical_quantity, reserved_quantity')]); if(v!==state.version)return; state.order=o;state.lines=lines||[];state.reservations=reservations||[];state.stock=stock||[]; detail(); redraw?.(); }
  async function refreshOrdersAndSelection() { const v = ++state.version; const {data,error}=await supabase.from('orders').select(orderFields).order('created_at',{ascending:false}); if (error || v !== state.version) return; state.orders=data||[];main.querySelector('[data-new]').textContent=state.orders.filter((x)=>x.status==='NEW').length+' нови';redraw?.(); void refreshListSummaries(); if(state.selectedOrderId) await load(state.selectedOrderId); }
  async function refresh(session) { if(!isSupabaseConfigured){clear('Нужна е Supabase конфигурация.');return;} if(!session?.user){clear('Влезте с одобрен администраторски профил.');return;} try { if(!await getApprovedAdminProfile(session.user.id)){clear('Тази страница е само за одобрени администратори.');return;} if (!redraw) { const {data,error}=await supabase.from('orders').select(orderFields).order('created_at',{ascending:false}); if(error)throw error;state.orders=data||[];main.querySelector('[data-new]').textContent=state.orders.filter((x)=>x.status==='NEW').length+' нови';redraw=renderList(); } else { await refreshOrdersAndSelection(); } } catch { if (!redraw) clear('Поръчките не могат да бъдат заредени.'); } }
  const initial=await getSession();await refresh(initial.session);const unsubscribe=subscribeToSessionChanges((_event,session)=>{if(!session?.user)clear('Сесията е прекратена.');else void refresh(session);});window.addEventListener('salon-auth-signed-out',()=>{unsubscribe();clear('Сесията е прекратена.');},{once:true});window.addEventListener('focus',()=>void getSession().then((x)=>refresh(x.session)));return main;
}
