import { createAlert, getSession, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { getApprovedAdminProfile } from '../services/admin-access.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';

const statusLabels = { pending: 'Чака одобрение', approved: 'Одобрен', denied: 'Отказан' };
const statusStyles = { pending: 'warning', approved: 'success', denied: 'danger' };
const salonFields = [
  ['salon_name', 'Име на салона'],
  ['contact_name', 'Лице за контакт'],
  ['phone', 'Телефон'],
  ['email', 'Имейл'],
  ['address', 'Адрес'],
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function messageOf(error, fallback) {
  return error?.message?.trim() || fallback;
}

export async function createAdminPage() {
  const main = el('main', 'admin-page py-4 py-md-5');
  main.innerHTML = `
    <div class="container">
      <section class="admin-shell">
        <header class="admin-page-heading">
          <div class="admin-page-heading-content">
            <div>
              <p class="eyebrow mb-2">АДМИНИСТРАЦИЯ</p>
              <h1 class="h2 mb-2">Клиенти</h1>
              <p class="text-body-secondary mb-0">Салони, контакти и одобрения на регистрации.</p>
            </div>
            <div class="admin-heading-actions" data-admin-heading-actions></div>
          </div>
        </header>
        <div class="admin-page-content mt-4"></div>
      </section>
    </div>`;

  const content = main.querySelector('.admin-page-content');
  const headingActions = main.querySelector('[data-admin-heading-actions]');
  const state = {
    activeAdminUserId: null,
    busy: false,
    clients: [],
    creating: false,
    editingId: null,
    profiles: [],
    search: '',
    status: 'all',
    version: 0,
  };

  function clear(text, type = 'warning') {
    state.version += 1;
    state.activeAdminUserId = null;
    state.busy = false;
    state.clients = [];
    state.creating = false;
    state.editingId = null;
    state.profiles = [];
    headingActions.replaceChildren();
    content.replaceChildren(createAlert(type, text));
  }

  function linkedProfile(clientId) {
    return state.profiles.find((profile) => String(profile.salon_client_id) === String(clientId));
  }

  function valuesFromForm(form) {
    return Object.fromEntries(salonFields.map(([name]) => [name, form.elements[name].value.trim() || null]));
  }

  function formHasUnsavedChanges(form) {
    const values = valuesFromForm(form);
    const editing = state.clients.find((client) => String(client.id) === String(state.editingId));

    if (!editing) {
      return Object.values(values).some(Boolean);
    }

    return salonFields.some(([name]) => String(values[name] || '') !== String(editing[name] || ''));
  }

  function confirmDiscardForm() {
    const form = content.querySelector('[data-salon-form]');
    return !form
      || !formHasUnsavedChanges(form)
      || window.confirm('Имате незапазени промени. Отказвате ли се от тях?');
  }

  function renderHeadingActions() {
    const addButton = el('button', 'btn btn-primary admin-add-salon-button', 'Добави салон');
    addButton.type = 'button';
    addButton.addEventListener('click', () => {
      if (state.busy || !confirmDiscardForm()) return;
      state.creating = true;
      state.editingId = null;
      render();
    });
    headingActions.replaceChildren(addButton);
  }

  function createSalonForm() {
    const editing = state.clients.find((client) => String(client.id) === String(state.editingId));
    const formBox = el('section', 'admin-client-card admin-salon-form mb-3');
    const form = el('form', 'row g-3');
    const formFeedback = el('div', 'col-12', '');
    const isEditing = Boolean(editing);

    form.dataset.salonForm = '';
    formBox.append(el('h2', 'h5 mb-3', isEditing ? 'Редакция на салон' : 'Нов салон / контакт'));
    form.append(formFeedback);

    salonFields.forEach(([name, label]) => {
      const field = el('div', name === 'address' ? 'col-12' : 'col-12 col-sm-6');
      const fieldLabel = el('label', 'form-label fw-semibold', label);
      const input = name === 'address' ? el('textarea', 'form-control') : el('input', 'form-control');
      const inputId = `salon-${name}`;

      input.id = inputId;
      input.name = name;
      input.value = editing?.[name] || '';
      fieldLabel.htmlFor = inputId;
      if (name === 'email') input.type = 'email';
      if (name === 'phone') input.type = 'tel';
      if (name === 'address') input.rows = 2;
      field.append(fieldLabel, input);
      form.append(field);
    });

    const actions = el('div', 'col-12 d-flex flex-wrap gap-2');
    const submit = el('button', 'btn btn-primary flex-grow-1', isEditing ? 'Запази салона' : 'Създай салон');
    const cancel = el('button', 'btn btn-outline-secondary', 'Отказ');
    submit.type = 'submit';
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      if (state.busy || !confirmDiscardForm()) return;
      state.creating = false;
      state.editingId = null;
      render();
    });
    actions.append(submit, cancel);
    form.append(actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.busy) return;

      state.busy = true;
      submit.disabled = true;
      cancel.disabled = true;
      submit.textContent = 'Записване…';
      const values = valuesFromForm(form);

      try {
        const query = isEditing
          ? supabase.from('salon_clients').update(values).eq('id', editing.id)
          : supabase.from('salon_clients').insert(values);
        const { error } = await query;
        if (error) throw error;

        state.creating = false;
        state.editingId = null;
        await load(undefined, {
          forceReload: true,
          successMessage: isEditing ? 'Данните за салона са запазени.' : 'Салонът е създаден.',
        });
      } catch (error) {
        formFeedback.replaceChildren(createAlert('danger', messageOf(error, 'Салонът не беше записан.')));
      } finally {
        state.busy = false;
        if (submit.isConnected) {
          submit.disabled = false;
          cancel.disabled = false;
          submit.textContent = isEditing ? 'Запази салона' : 'Създай салон';
        }
      }
    });

    formBox.append(form);
    return { form, formBox };
  }

  function render(message, type = 'success') {
    const root = el('div', 'admin-client-workspace');
    const feedback = el('div', 'admin-client-feedback');
    if (message) feedback.append(createAlert(type, message));

    const controls = el('div', 'admin-list-controls mb-3');
    const search = el('input', 'form-control mb-2');
    search.type = 'search';
    search.placeholder = 'Салон, контакт, телефон или имейл';
    search.value = state.search;
    const filter = el('select', 'form-select');
    [
      ['all', 'Всички салони'],
      ['pending', 'Чакащи одобрение'],
      ['approved', 'Одобрени'],
      ['denied', 'Отказани'],
      ['standalone', 'Без свързан профил'],
    ].forEach(([value, label]) => {
      const option = el('option', '', label);
      option.value = value;
      filter.append(option);
    });
    filter.value = state.status;

    const list = el('div', 'admin-client-list');
    const formState = state.creating || state.editingId ? createSalonForm() : null;

    function openEditForm(client) {
      if (state.busy || !confirmDiscardForm()) return;
      state.creating = false;
      state.editingId = client.id;
      render();
    }

    function drawCards() {
      list.replaceChildren();
      const query = state.search.trim().toLocaleLowerCase('bg');
      const clients = state.clients.filter((client) => {
        const profile = linkedProfile(client.id);
        const matchesSearch = !query || [client.salon_name, client.contact_name, client.phone, client.email]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('bg')
          .includes(query);
        const matchesStatus = state.status === 'all'
          || (state.status === 'standalone' ? !profile : profile?.approval_status === state.status);
        return matchesSearch && matchesStatus;
      });

      if (!clients.length) {
        list.append(createAlert('info', 'Няма салони по избраните условия.'));
      }

      clients.forEach((client) => {
        const profile = linkedProfile(client.id);
        const card = el('article', 'admin-client-card');
        const header = el('div', 'd-flex justify-content-between align-items-start gap-3 mb-3');
        const title = el('div');
        title.append(
          el('p', 'eyebrow mb-1', profile ? 'СВЪРЗАН КЛИЕНТСКИ ПРОФИЛ' : 'САЛОН БЕЗ ПРОФИЛ'),
          el('h2', 'h5 mb-0', client.salon_name || client.contact_name || 'Салон без име'),
        );
        header.append(
          title,
          el(
            'span',
            `badge text-bg-${profile ? statusStyles[profile.approval_status] : 'secondary'} admin-status-badge`,
            profile ? statusLabels[profile.approval_status] : 'Без свързан профил',
          ),
        );

        const details = el('ul', 'admin-client-details list-unstyled mb-3');
        [
          ['Лице за контакт', client.contact_name],
          ['Телефон', client.phone],
          ['Имейл', client.email],
          ['Адрес', client.address],
        ].forEach(([label, value]) => {
          const item = el('li', 'admin-client-detail');
          item.append(el('span', 'admin-client-detail-label', label), document.createTextNode(value || 'Не е посочено'));
          details.append(item);
        });

        const actionsRow = el('div', 'admin-client-actions');
        const edit = el('button', 'btn btn-outline-primary', 'Редактирай');
        edit.type = 'button';
        edit.addEventListener('click', () => openEditForm(client));
        actionsRow.append(edit);

        if (profile) {
          ['approved', 'denied']
            .filter((next) => next !== profile.approval_status)
            .forEach((next) => {
              const button = el(
                'button',
                next === 'approved' ? 'btn btn-primary' : 'btn btn-outline-danger',
                next === 'approved' ? 'Одобри клиента' : 'Откажи клиента',
              );
              button.type = 'button';
              button.addEventListener('click', () => void updateApproval(profile, next, card));
              actionsRow.append(button);
            });
        }

        card.append(header, details, actionsRow);
        list.append(card);
      });
    }

    search.addEventListener('input', () => {
      state.search = search.value;
      drawCards();
    });
    filter.addEventListener('change', () => {
      state.status = filter.value;
      drawCards();
    });
    controls.append(search, filter);
    root.append(feedback);
    if (formState) root.append(formState.formBox);
    root.append(controls, list);
    content.replaceChildren(root);
    renderHeadingActions();
    drawCards();

    if (state.creating) {
      window.requestAnimationFrame(() => formState?.form.elements.salon_name.focus());
    }
  }

  async function updateApproval(profile, status, card) {
    if (state.busy) return;
    state.busy = true;
    card.querySelectorAll('button').forEach((button) => { button.disabled = true; });

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ approval_status: status })
        .eq('id', profile.id)
        .eq('role', 'client');
      if (error) throw error;
      await load(undefined, { forceReload: true, successMessage: 'Статусът на регистрацията е обновен.' });
    } catch (error) {
      card.append(createAlert('danger', messageOf(error, 'Статусът не беше променен.')));
      card.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    } finally {
      state.busy = false;
    }
  }

  async function load(session, { forceReload = false, successMessage = '' } = {}) {
    const version = ++state.version;
    const activeSession = session === undefined ? (await getSession()).session : session;
    if (version !== state.version) return;
    const canPreserveWorkspace = state.activeAdminUserId === activeSession?.user?.id
      && Boolean(content.querySelector('.admin-client-workspace'));

    if (!canPreserveWorkspace) {
      headingActions.replaceChildren();
      content.replaceChildren(createAlert('info', 'Проверка на администраторския достъп…'));
    }

    try {
      if (!isSupabaseConfigured) {
        clear('За администрацията е нужна връзка със Supabase.', 'info');
        return;
      }
      if (!activeSession?.user) {
        clear('Тази страница е достъпна само за одобрени администратори.');
        return;
      }
      const profile = await getApprovedAdminProfile(activeSession.user.id);
      if (version !== state.version) return;
      if (!profile) {
        clear('Тази страница е достъпна само за одобрени администратори.');
        return;
      }
      if (canPreserveWorkspace && !forceReload) return;

      const [clients, profiles] = await Promise.all([
        supabase
          .from('salon_clients')
          .select('id, salon_name, contact_name, phone, email, address, created_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('id, salon_client_id, approval_status, created_at')
          .eq('role', 'client'),
      ]);
      if (clients.error) throw clients.error;
      if (profiles.error) throw profiles.error;
      if (version !== state.version) return;

      state.activeAdminUserId = activeSession.user.id;
      state.clients = clients.data || [];
      state.profiles = profiles.data || [];
      render(successMessage);
    } catch (error) {
      if (version === state.version) {
        clear(messageOf(error, 'Клиентите не могат да бъдат заредени.'), 'danger');
      }
    }
  }

  const initial = await getSession();
  await load(initial.session);
  const unsubscribe = subscribeToSessionChanges((_event, session) => {
    if (!session?.user) clear('Сесията е прекратена.');
    else void load(session);
  });
  window.addEventListener('salon-auth-signed-out', () => {
    unsubscribe();
    clear('Сесията е прекратена.');
  }, { once: true });
  window.addEventListener('focus', () => { void load(); });

  return main;
}
