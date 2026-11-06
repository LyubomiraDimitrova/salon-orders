import { createAlert, getSession, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { getApprovedAdminProfile } from '../services/admin-access.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';

const orderFields = 'id, order_number, source, status, requested_delivery_date, requested_delivery_time_from, requested_delivery_time_to, confirmed_delivery_date, confirmed_delivery_time_from, confirmed_delivery_time_to, salon_name_snapshot, contact_name_snapshot, phone_snapshot, email_snapshot, address_snapshot, delivery_instructions, customer_note, denial_reason, delivered_at, created_at';
const labels = { NEW: 'Нова', APPROVED: 'Одобрена', IN_PROGRESS: 'В обработка', DENIED: 'Отказана', DONE: 'Доставена' };
const euro = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' });
const e = (tag, cls, text) => { const x = document.createElement(tag); x.className = cls || ''; if (text !== undefined) x.textContent = text; return x; };
const blank = (v) => v || '—';
function customerNotes(order) {
  return [
    ['Инструкции за доставка', order.delivery_instructions?.trim()],
    ['Бележка', order.customer_note?.trim()],
  ].filter((note, index, all) => note[1] && all.findIndex((candidate) => candidate[1] === note[1]) === index);
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
  const state = { orders: [], order: null, selectedOrderId: null, searchQuery: '', statusFilter: '', lines: [], summaryLines: [], reservations: [], stock: [], busy: false, version: 0, summaryVersion: 0, clients: null, products: null, prices: null, createBusy: false };
  const clear = (message) => { state.version += 1; state.orders = []; state.order = null; content.replaceChildren(createAlert('warning', message)); };
  const rpc = async (name, payload, key) => { const op = requestId(key, payload); const { error } = await supabase.rpc(name, { p_request_id: op.id, ...op.payload }); if (error) throw error; sessionStorage.removeItem(op.k); };
  const message = (box, type, text) => box.replaceChildren(createAlert(type, text));
  const adminCreateKey = 'salon-orders:admin-create-order';
  const adminOrderOperation = () => { try { return JSON.parse(sessionStorage.getItem(adminCreateKey)); } catch { return null; } };
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
    let retry = adminOrderOperation();
    if (retry) body.append(createAlert('warning', 'Има непотвърдена заявка за нова поръчка. Повторете я със запазените UUID и данни.'));
    const form = e('form', 'row g-3'); const feedback = e('div', 'col-12'); form.append(feedback);
    const clientField = e('div', 'col-12'); const client = e('select', 'form-select'); client.name = 'client'; client.required = true; client.append(e('option', '', 'Изберете салон')); state.clients.forEach((item) => { const option = e('option', '', `${item.salon_name || item.contact_name || 'Салон без име'}${item.phone ? ` · ${item.phone}` : ''}`); option.value = item.id; client.append(option); }); clientField.append(e('label', 'form-label fw-semibold', 'Салон клиент'), client); form.append(clientField);
    const sourceField = e('div', 'col-6'); const source = e('select', 'form-select'); source.name = 'source'; [['phone', 'Телефон'], ['viber', 'Viber']].forEach(([value, label]) => { const option = e('option', '', label); option.value = value; source.append(option); }); sourceField.append(e('label', 'form-label fw-semibold', 'Източник'), source);
    const statusField = e('div', 'col-6'); const status = e('select', 'form-select'); status.name = 'status'; [['APPROVED', 'Одобрена'], ['IN_PROGRESS', 'В обработка']].forEach(([value, label]) => { const option = e('option', '', label); option.value = value; status.append(option); }); statusField.append(e('label', 'form-label fw-semibold', 'Начален статус'), status); form.append(sourceField, statusField);
    const requestedDate = e('input', 'form-control'); requestedDate.type = 'date'; requestedDate.name = 'requestedDate'; const confirmedDate = e('input', 'form-control'); confirmedDate.type = 'date'; confirmedDate.name = 'confirmedDate'; [['Заявена дата', requestedDate], ['Потвърдена дата', confirmedDate]].forEach(([label, input]) => { const field = e('div', 'col-6'); field.append(e('label', 'form-label fw-semibold', label), input); form.append(field); });
    const requestedFrom = e('input', 'form-control'); requestedFrom.type = 'time'; requestedFrom.name = 'requestedFrom'; const requestedTo = e('input', 'form-control'); requestedTo.type = 'time'; requestedTo.name = 'requestedTo'; const confirmedFrom = e('input', 'form-control'); confirmedFrom.type = 'time'; confirmedFrom.name = 'confirmedFrom'; const confirmedTo = e('input', 'form-control'); confirmedTo.type = 'time'; confirmedTo.name = 'confirmedTo'; [['Заявено от', requestedFrom], ['Заявено до', requestedTo], ['Потвърдено от', confirmedFrom], ['Потвърдено до', confirmedTo]].forEach(([label, input]) => { const field = e('div', 'col-6'); field.append(e('label', 'form-label', label), input); form.append(field); });
    const instructions = e('textarea', 'form-control'); instructions.name = 'instructions'; instructions.rows = 2; const note = e('textarea', 'form-control'); note.name = 'note'; note.rows = 2; [['Инструкции за доставка', instructions], ['Бележка', note]].forEach(([label, input]) => { const field = e('div', 'col-12'); field.append(e('label', 'form-label fw-semibold', label), input); form.append(field); });
    const linesBox = e('div', 'col-12'); linesBox.append(e('h3', 'h6 mb-2', 'Продукти'));
    const rows = e('div', 'd-grid gap-2'); const add = e('button', 'btn btn-outline-primary w-100 mt-2', 'Добави продукт'); add.type = 'button';
    const addRow = () => { const row = e('div', 'row g-2 align-items-end'); const productField = e('div', 'col-8'); const product = e('select', 'form-select'); product.required = true; product.append(e('option', '', 'Изберете продукт')); state.products.forEach((item) => { const option = e('option', '', priceLabel(item)); option.value = item.id; product.append(option); }); productField.append(e('label', 'form-label', 'Продукт'), product); const quantityField = e('div', 'col-3'); const quantity = e('input', 'form-control'); quantity.type = 'number'; quantity.min = '1'; quantity.step = '1'; quantity.value = '1'; quantity.required = true; quantityField.append(e('label', 'form-label', 'Брой'), quantity); const removeField = e('div', 'col-1'); const remove = e('button', 'btn btn-outline-danger w-100', '×'); remove.type = 'button'; remove.ariaLabel = 'Премахни продукт'; remove.onclick = () => row.remove(); removeField.append(remove); row.append(productField, quantityField, removeField); rows.append(row); };
    add.onclick = addRow; addRow(); linesBox.append(rows, add, e('p', 'form-text mb-0', 'Недостатъчната или неизвестна наличност не спира създаването.')); form.append(linesBox);
    const submitField = e('div', 'col-12'); const submit = e('button', 'btn btn-primary w-100', retry ? 'Повтори новата поръчка' : 'Създай поръчка'); submit.type = 'submit'; submitField.append(submit); form.append(submitField);
    form.onsubmit = async (event) => { event.preventDefault(); if (state.createBusy) return; const lineValues = [...rows.children].map((row) => ({ product_id: Number(row.querySelector('select').value), quantity: Number(row.querySelector('input').value) })); if (!client.value || !lineValues.length || lineValues.some((line) => !Number.isInteger(line.product_id) || !Number.isInteger(line.quantity) || line.quantity <= 0)) { message(feedback, 'danger', 'Изберете салон и поне един продукт с положително цяло количество.'); return; }
      const payload = { p_salon_client_id: Number(client.value), p_source: source.value, p_initial_status: status.value, p_requested_delivery_date: requestedDate.value || null, p_requested_delivery_time_from: requestedFrom.value || null, p_requested_delivery_time_to: requestedTo.value || null, p_confirmed_delivery_date: confirmedDate.value || null, p_confirmed_delivery_time_from: confirmedFrom.value || null, p_confirmed_delivery_time_to: confirmedTo.value || null, p_delivery_instructions: instructions.value.trim() || null, p_customer_note: note.value.trim() || null, p_lines: lineValues };
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
  async function run(control, box, task) { if (state.busy) return; state.busy = true; control.disabled = true; message(box, 'info', 'Изпращане… При прекъсване повторете същото действие.'); try { await task(); message(box, 'success', 'Промяната е записана. Обновяване…'); await refreshOrdersAndSelection(); } catch (error) { message(box, 'danger', translated(error)); } finally { state.busy = false; control.disabled = false; } }
  function button(label, style, box, task, disabled, confirmation) { const b = e('button', 'btn ' + style + ' w-100', label); b.type = 'button'; b.disabled = !!disabled; b.title = disabled ? 'Първо резервирайте всички количества.' : ''; b.onclick = () => run(b, box, async () => { if (!confirmation || window.confirm(confirmation)) await task(); }); return b; }

  async function prices(box, orderId) { const { data, error } = await supabase.rpc('get_admin_order_price_snapshots', { p_order_id: orderId }); if (error || state.order?.id !== orderId) { box.textContent = 'Цените не могат да се заредят.'; return; } const current = (data || []).filter((x) => x.is_current); const total = current.reduce((n, x) => n + Number(x.retail_price) * x.quantity, 0); box.innerHTML = '<ul class="list-unstyled mb-2">' + current.map((x) => '<li>' + x.product_name_snapshot + ' × ' + x.quantity + ': ' + euro.format(x.retail_price) + '</li>').join('') + '</ul><strong>Общо: ' + euro.format(total) + '</strong>'; }
  function detail() {
    const o = state.order; const detailBox = content.querySelector('[data-detail]'); const current = state.lines.filter((x) => x.is_current); const fullyReserved = current.every((x) => activeQty(x) === x.quantity);
    detailBox.innerHTML = '<div class="d-flex justify-content-between mb-3"><div><p class="eyebrow mb-1">ПОРЪЧКА № ' + o.order_number + '</p><h2 class="h4 mb-0">' + labels[o.status] + '</h2></div><span class="badge text-bg-secondary">' + o.source + '</span></div><div data-feedback></div><div class="snapshot-grid"><div><b>Салон</b><br>' + blank(o.salon_name_snapshot) + '</div><div><b>Контакт</b><br>' + blank(o.contact_name_snapshot) + '<br>' + blank(o.phone_snapshot) + '<br>' + blank(o.email_snapshot) + '</div><div><b>Адрес</b><br>' + blank(o.address_snapshot) + '</div><div><b>Желан ден за доставка</b><br>' + (o.requested_delivery_date || 'Не е посочен') + '</div><div><b>Потвърден ден за доставка</b><br>' + (o.confirmed_delivery_date || 'Още не е потвърден') + '</div><div><b>Бележка за доставка от клиента</b><br>' + (o.delivery_instructions || 'Не е посочена') + '</div><div><b>Бележка към поръчката</b><br>' + blank(o.customer_note) + '</div></div><details class="mt-3"><summary>Дати и детайли за доставка</summary><form class="row g-2 pt-3" data-delivery>' + dateInputs(o) + '<div class="col-12"><label class="form-label">Инструкции</label><textarea class="form-control" name="instructions">' + (o.delivery_instructions || '') + '</textarea></div><div class="col-12"><label class="form-label">Бележка</label><textarea class="form-control" name="note">' + (o.customer_note || '') + '</textarea></div>' + (['APPROVED','IN_PROGRESS'].includes(o.status) ? '<div class="col-12"><button class="btn btn-outline-primary w-100">Запази детайлите</button></div>' : '') + '</form></details><h3 class="h5 mt-4">Редове и резервиране</h3><div data-lines></div><details class="mt-3"><summary>Исторически цени и общо</summary><div class="pt-3" data-prices>Зареждане…</div></details><div class="admin-order-actions mt-4" data-actions></div>';
    [...detailBox.querySelectorAll('.snapshot-grid > div')].filter((item) => item.textContent.startsWith('Бележка за доставка') || item.textContent.startsWith('Бележка към')).forEach((item) => item.remove());
    const notes = customerNotes(o);
    if (notes.length) {
      const noteSection = e('section', 'mt-3');
      noteSection.append(e('h3', 'h6', 'Бележка от клиента'));
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
    if (o.status === 'APPROVED') { const form = e('form', 'mt-3'); form.innerHTML = '<label class="form-label fw-semibold">Редакция на количества</label>' + current.map((x) => '<div class="input-group mb-2"><span class="input-group-text">' + x.product_name_snapshot + '</span><input class="form-control" data-product="' + x.product_id + '" type="number" min="1" value="' + x.quantity + '"></div>').join('') + '<button class="btn btn-outline-primary w-100">Запази редовете</button>'; form.onsubmit = (ev) => { ev.preventDefault(); const p_lines = [...form.querySelectorAll('[data-product]')].map((x) => ({ product_id: Number(x.dataset.product), quantity: Number(x.value) })); run(form.querySelector('button'), feedback, () => rpc('replace_approved_order_lines', { p_order_id: o.id, p_lines }, 'replace:' + o.id)); }; lines.append(form); }
    const actions = detailBox.querySelector('[data-actions]');
    if (o.status === 'NEW') { const f = e('form', ''); f.innerHTML = '<label class="form-label fw-semibold">Потвърдена дата</label><input class="form-control mb-2" name="date" type="date" required><div class="row g-2"><div class="col"><input class="form-control" name="from" type="time"></div><div class="col"><input class="form-control" name="to" type="time"></div></div><button class="btn btn-primary w-100 mt-2">Одобри и резервирай</button>'; f.onsubmit = (ev) => { ev.preventDefault(); run(f.querySelector('button'), feedback, () => rpc('approve_order', { p_order_id:o.id, p_confirmed_delivery_date:f.date.value, p_confirmed_delivery_time_from:f.from.value || null, p_confirmed_delivery_time_to:f.to.value || null, p_delivery_instructions:null }, 'approve:' + o.id)); }; actions.append(f); }
    if (o.status === 'APPROVED') actions.append(button('Начни обработка', 'btn-outline-primary', feedback, () => rpc('start_order_delivery', { p_order_id:o.id }, 'start:' + o.id)));
    if (o.status === 'IN_PROGRESS') actions.append(button('Отбележи като доставена', 'btn-success', feedback, () => rpc('deliver_order', { p_order_id:o.id, p_delivered_at:new Date().toISOString() }, 'deliver:' + o.id), !fullyReserved, 'Потвърждавате ли доставката?'));
    if (['NEW','APPROVED','IN_PROGRESS'].includes(o.status)) actions.append(button('Откажи поръчката', 'btn-outline-danger', feedback, async () => { const reason = window.prompt('Посочете задължителна причина за отказ:'); if (!reason?.trim()) throw new Error('Причината за отказ е задължителна.'); await rpc('deny_order', { p_order_id:o.id, p_denial_reason:reason }, 'deny:' + o.id); }, false, 'Потвърждавате ли отказа?'));
    const delivery = detailBox.querySelector('[data-delivery]'); if (delivery) delivery.onsubmit = (ev) => { ev.preventDefault(); run(delivery.querySelector('button'), feedback, () => rpc('update_order_delivery_details', { p_order_id:o.id, p_requested_delivery_date:delivery.requestedDate.value || null, p_requested_delivery_time_from:delivery.requestedFrom.value || null, p_requested_delivery_time_to:delivery.requestedTo.value || null, p_confirmed_delivery_date:delivery.confirmedDate.value || null, p_confirmed_delivery_time_from:delivery.confirmedFrom.value || null, p_confirmed_delivery_time_to:delivery.confirmedTo.value || null, p_delivery_instructions:o.delivery_instructions, p_customer_note:o.customer_note }, 'details:' + o.id)); };
    prices(detailBox.querySelector('[data-prices]'), o.id);
  }
  function dateInputs(o) { return [['requestedDate','Заявена дата',o.requested_delivery_date,'date'],['requestedFrom','Заявено от',o.requested_delivery_time_from,'time'],['requestedTo','Заявено до',o.requested_delivery_time_to,'time'],['confirmedDate','Потвърдена дата',o.confirmed_delivery_date,'date'],['confirmedFrom','Потвърдено от',o.confirmed_delivery_time_from,'time'],['confirmedTo','Потвърдено до',o.confirmed_delivery_time_to,'time']].map((x) => '<div class="col-6"><label class="form-label">' + x[1] + '</label><input class="form-control" name="' + x[0] + '" type="' + x[3] + '" value="' + (x[2] || '') + '"></div>').join(''); }
  async function load(id) { state.selectedOrderId = id; const v = ++state.version; const { data:o, error } = await supabase.from('orders').select(orderFields).eq('id',id).single(); if (v !== state.version) return; if (error) { const feedback = content.querySelector('[data-feedback]'); if (feedback) message(feedback, 'danger', 'Детайлите не могат да бъдат обновени. Последно заредените данни остават видими.'); return; } const {data:lines} = await supabase.from('order_lines').select('id, order_id, product_id, product_name_snapshot, product_size_snapshot, quantity, is_current').eq('order_id',id); const ids=(lines || []).map((x)=>x.id); const [{data:reservations},{data:stock}] = await Promise.all([ids.length ? supabase.from('stock_reservations').select('order_line_id, quantity, status').in('order_line_id',ids) : Promise.resolve({data:[]}),supabase.from('stock_levels').select('product_id, physical_quantity, reserved_quantity')]); if(v!==state.version)return; state.order=o;state.lines=lines||[];state.reservations=reservations||[];state.stock=stock||[]; detail(); redraw?.(); }
  async function refreshOrdersAndSelection() { const v = ++state.version; const {data,error}=await supabase.from('orders').select(orderFields).order('created_at',{ascending:false}); if (error || v !== state.version) return; state.orders=data||[];main.querySelector('[data-new]').textContent=state.orders.filter((x)=>x.status==='NEW').length+' нови';redraw?.(); void refreshListSummaries(); if(state.selectedOrderId) await load(state.selectedOrderId); }
  async function refresh(session) { if(!isSupabaseConfigured){clear('Нужна е Supabase конфигурация.');return;} if(!session?.user){clear('Влезте с одобрен администраторски профил.');return;} try { if(!await getApprovedAdminProfile(session.user.id)){clear('Тази страница е само за одобрени администратори.');return;} if (!redraw) { const {data,error}=await supabase.from('orders').select(orderFields).order('created_at',{ascending:false}); if(error)throw error;state.orders=data||[];main.querySelector('[data-new]').textContent=state.orders.filter((x)=>x.status==='NEW').length+' нови';redraw=renderList(); } else { await refreshOrdersAndSelection(); } } catch { if (!redraw) clear('Поръчките не могат да бъдат заредени.'); } }
  const initial=await getSession();await refresh(initial.session);const unsubscribe=subscribeToSessionChanges((_event,session)=>{if(!session?.user)clear('Сесията е прекратена.');else void refresh(session);});window.addEventListener('salon-auth-signed-out',()=>{unsubscribe();clear('Сесията е прекратена.');},{once:true});window.addEventListener('focus',()=>void getSession().then((x)=>refresh(x.session)));return main;
}
