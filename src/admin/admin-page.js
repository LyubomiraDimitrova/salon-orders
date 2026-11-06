import { createAlert, getSession, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { getApprovedAdminProfile } from '../services/admin-access.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';

const statusLabels = { pending: 'Чака одобрение', approved: 'Одобрен', denied: 'Отказан' };
const statusStyles = { pending: 'warning', approved: 'success', denied: 'danger' };
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const messageOf = (error, fallback) => error?.message?.trim() || fallback;

export async function createAdminPage() {
  const main = el('main', 'admin-page py-4 py-md-5');
  main.innerHTML = '<div class="container"><section class="admin-shell"><header class="admin-page-heading"><p class="eyebrow mb-2">АДМИНИСТРАЦИЯ</p><h1 class="h2 mb-2">Клиенти</h1><p class="text-body-secondary mb-0">Салони, контакти и одобрения на регистрации.</p></header><div class="admin-page-content mt-4"></div></section></div>';
  const content = main.querySelector('.admin-page-content');
  const state = { clients: [], profiles: [], search: '', status: 'all', version: 0, busy: false, editingId: null };
  const clear = (text, type = 'warning') => { state.version += 1; state.clients = []; state.profiles = []; state.editingId = null; content.replaceChildren(createAlert(type, text)); };
  const linkedProfile = (clientId) => state.profiles.find((profile) => String(profile.salon_client_id) === String(clientId));

  function render(message, type = 'success') {
    const root = el('div'); if (message) root.append(createAlert(type, message));
    const controls = el('div', 'admin-list-controls mb-3'); const search = el('input', 'form-control mb-2'); search.type = 'search'; search.placeholder = 'Салон, контакт, телефон или имейл'; search.value = state.search;
    const filter = el('select', 'form-select'); [['all', 'Всички салони'], ['pending', 'Чакащи одобрение'], ['approved', 'Одобрени'], ['denied', 'Отказани'], ['standalone', 'Без свързан профил']].forEach(([value, label]) => { const option = el('option', '', label); option.value = value; filter.append(option); }); filter.value = state.status;
    const formBox = el('section', 'admin-client-card mb-3'); const form = el('form', 'row g-3'); const editing = state.clients.find((client) => String(client.id) === String(state.editingId));
    formBox.append(el('h2', 'h5 mb-3', state.editingId ? 'Редакция на салон' : 'Нов салон / контакт'));
    const fields = [['salon_name', 'Име на салона'], ['contact_name', 'Лице за контакт'], ['phone', 'Телефон'], ['email', 'Имейл'], ['address', 'Адрес']];
    fields.forEach(([name, label]) => { const field = el('div', name === 'address' ? 'col-12' : 'col-12 col-sm-6'); const fieldLabel = el('label', 'form-label fw-semibold', label); const input = name === 'address' ? el('textarea', 'form-control') : el('input', 'form-control'); input.name = name; input.value = editing?.[name] || ''; if (name === 'email') input.type = 'email'; if (name === 'phone') input.type = 'tel'; if (name === 'address') input.rows = 2; field.append(fieldLabel, input); form.append(field); });
    const actions = el('div', 'col-12 d-flex flex-wrap gap-2'); const submit = el('button', 'btn btn-primary flex-grow-1', state.editingId ? 'Запази салона' : 'Създай салон'); submit.type = 'submit'; actions.append(submit);
    if (state.editingId) { const cancel = el('button', 'btn btn-outline-secondary', 'Отказ'); cancel.type = 'button'; cancel.onclick = () => { state.editingId = null; render(); }; actions.append(cancel); }
    form.append(actions); formBox.append(form);
    const list = el('div', 'admin-client-list');
    const drawCards = () => {
      list.replaceChildren(); const q = state.search.trim().toLowerCase();
      const clients = state.clients.filter((client) => { const profile = linkedProfile(client.id); const matchesSearch = !q || [client.salon_name, client.contact_name, client.phone, client.email].filter(Boolean).join(' ').toLowerCase().includes(q); const matchesStatus = state.status === 'all' || (state.status === 'standalone' ? !profile : profile?.approval_status === state.status); return matchesSearch && matchesStatus; });
      if (!clients.length) list.append(createAlert('info', 'Няма салони по избраните условия.'));
      clients.forEach((client) => {
        const profile = linkedProfile(client.id); const card = el('article', 'admin-client-card'); const header = el('div', 'd-flex justify-content-between align-items-start gap-3 mb-3'); const title = el('div'); title.append(el('p', 'eyebrow mb-1', profile ? 'СВЪРЗАН КЛИЕНТСКИ ПРОФИЛ' : 'САЛОН БЕЗ ПРОФИЛ'), el('h2', 'h5 mb-0', client.salon_name || client.contact_name || 'Салон без име')); header.append(title, el('span', `badge text-bg-${profile ? statusStyles[profile.approval_status] : 'secondary'} admin-status-badge`, profile ? statusLabels[profile.approval_status] : 'Без свързан профил'));
        const details = el('ul', 'admin-client-details list-unstyled mb-3'); [['Лице за контакт', client.contact_name], ['Телефон', client.phone], ['Имейл', client.email], ['Адрес', client.address]].forEach(([label, value]) => { const item = el('li', 'admin-client-detail'); item.append(el('span', 'admin-client-detail-label', label), document.createTextNode(value || 'Не е посочено')); details.append(item); });
        const actionsRow = el('div', 'admin-client-actions'); const edit = el('button', 'btn btn-outline-primary', 'Редактирай'); edit.type = 'button'; edit.onclick = () => { state.editingId = client.id; render(); }; actionsRow.append(edit);
        if (profile) ['approved', 'denied'].filter((next) => next !== profile.approval_status).forEach((next) => { const button = el('button', next === 'approved' ? 'btn btn-primary' : 'btn btn-outline-danger', next === 'approved' ? 'Одобри клиента' : 'Откажи клиента'); button.type = 'button'; button.onclick = () => void updateApproval(profile, next, card); actionsRow.append(button); });
        card.append(header, details, actionsRow); list.append(card);
      });
    };
    search.oninput = () => { state.search = search.value; drawCards(); }; filter.onchange = () => { state.status = filter.value; drawCards(); }; controls.append(search, filter);
    form.onsubmit = async (event) => { event.preventDefault(); if (state.busy) return; state.busy = true; submit.disabled = true; submit.textContent = 'Записване…'; const values = Object.fromEntries(fields.map(([name]) => [name, form.elements[name].value.trim() || null])); try { const query = state.editingId ? supabase.from('salon_clients').update(values).eq('id', state.editingId) : supabase.from('salon_clients').insert(values); const { error } = await query; if (error) throw error; state.editingId = null; await load(); } catch (error) { root.prepend(createAlert('danger', messageOf(error, 'Салонът не беше записан.'))); } finally { state.busy = false; if (submit.isConnected) { submit.disabled = false; submit.textContent = state.editingId ? 'Запази салона' : 'Създай салон'; } } };
    root.append(controls, formBox, list); content.replaceChildren(root); drawCards();
  }

  async function updateApproval(profile, status, card) { if (state.busy) return; state.busy = true; card.querySelectorAll('button').forEach((button) => { button.disabled = true; }); try { const { error } = await supabase.from('profiles').update({ approval_status: status }).eq('id', profile.id).eq('role', 'client'); if (error) throw error; await load(); } catch (error) { card.append(createAlert('danger', messageOf(error, 'Статусът не беше променен.'))); card.querySelectorAll('button').forEach((button) => { button.disabled = false; }); } finally { state.busy = false; } }
  async function load(session) {
    const version = ++state.version; content.replaceChildren(createAlert('info', 'Зареждане на салоните…'));
    try { if (!isSupabaseConfigured) { clear('За администрацията е нужна връзка със Supabase.', 'info'); return; } const activeSession = session || (await getSession()).session; if (!activeSession?.user || !await getApprovedAdminProfile(activeSession.user.id)) { clear('Тази страница е достъпна само за одобрени администратори.'); return; }
      const [clients, profiles] = await Promise.all([supabase.from('salon_clients').select('id, salon_name, contact_name, phone, email, address, created_at').order('created_at', { ascending: false }), supabase.from('profiles').select('id, salon_client_id, approval_status, created_at').eq('role', 'client')]); if (clients.error) throw clients.error; if (profiles.error) throw profiles.error; if (version !== state.version) return; state.clients = clients.data || []; state.profiles = profiles.data || []; render();
    } catch (error) { if (version === state.version) clear(messageOf(error, 'Клиентите не могат да бъдат заредени.'), 'danger'); }
  }
  const initial = await getSession(); await load(initial.session);
  const unsubscribe = subscribeToSessionChanges((_event, session) => { if (!session?.user) clear('Сесията е прекратена.'); else void load(session); });
  window.addEventListener('salon-auth-signed-out', () => { unsubscribe(); clear('Сесията е прекратена.'); }, { once: true }); window.addEventListener('focus', () => { void load(); });
  return main;
}
