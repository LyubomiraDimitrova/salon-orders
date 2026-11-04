import { createAlert, getSession, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';
import { getApprovedAdminProfile } from '../services/admin-access.js';

const statusDetails = {
  pending: { label: 'Чака одобрение', badge: 'warning' },
  approved: { label: 'Одобрен', badge: 'success' },
  denied: { label: 'Отказан', badge: 'danger' },
};

function getStatusDetails(status) {
  return statusDetails[status] || { label: 'Неизвестен статус', badge: 'secondary' };
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createContactItem(label, value, href) {
  const item = document.createElement('li');
  item.className = 'admin-client-detail';
  const labelElement = document.createElement('span');
  labelElement.className = 'admin-client-detail-label';
  labelElement.textContent = label;
  item.append(labelElement);

  if (href && value) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = value;
    item.append(link);
  } else {
    item.append(document.createTextNode(value || 'Не е посочено'));
  }

  return item;
}

function createClientCard(profile, onStatusChange) {
  const salonClient = Array.isArray(profile.salon_clients)
    ? profile.salon_clients[0]
    : profile.salon_clients;
  const status = getStatusDetails(profile.approval_status);
  const card = document.createElement('article');
  card.className = 'admin-client-card';
  card.dataset.profileId = profile.id;

  const header = document.createElement('div');
  header.className = 'd-flex align-items-start justify-content-between gap-3 mb-3';
  const identity = document.createElement('div');
  identity.append(
    createTextElement('p', 'eyebrow mb-1', 'КЛИЕНТСКИ ПРОФИЛ'),
    createTextElement('h2', 'h5 mb-0', salonClient?.salon_name || salonClient?.contact_name || 'Клиент без попълнено име'),
  );
  const badge = createTextElement('span', `badge text-bg-${status.badge} admin-status-badge`, status.label);
  header.append(identity, badge);

  const details = document.createElement('ul');
  details.className = 'admin-client-details list-unstyled mb-3';
  details.append(
    createContactItem('Лице за контакт', salonClient?.contact_name),
    createContactItem('Телефон', salonClient?.phone, salonClient?.phone ? `tel:${salonClient.phone}` : null),
    createContactItem('Имейл', salonClient?.email, salonClient?.email ? `mailto:${salonClient.email}` : null),
    createContactItem('Адрес', salonClient?.address),
  );

  if (!salonClient) {
    details.append(createTextElement('li', 'admin-client-missing-detail', 'Към този профил няма свързан салонен запис.'));
  }

  const actionArea = document.createElement('div');
  actionArea.className = 'admin-client-actions';
  const feedback = document.createElement('div');
  feedback.className = 'admin-client-feedback';
  feedback.setAttribute('aria-live', 'polite');

  if (profile.approval_status !== 'approved') {
    const approveButton = document.createElement('button');
    approveButton.className = 'btn btn-primary flex-grow-1';
    approveButton.type = 'button';
    approveButton.textContent = 'Одобри клиента';
    approveButton.addEventListener('click', () => onStatusChange(profile, 'approved', card, feedback));
    actionArea.append(approveButton);
  }

  if (profile.approval_status !== 'denied') {
    const denyButton = document.createElement('button');
    denyButton.className = 'btn btn-outline-danger flex-grow-1';
    denyButton.type = 'button';
    denyButton.textContent = 'Откажи клиента';
    denyButton.addEventListener('click', () => onStatusChange(profile, 'denied', card, feedback));
    actionArea.append(denyButton);
  }

  card.append(header, details, actionArea, feedback);
  return card;
}

export async function createAdminPage() {
  const main = document.createElement('main');
  main.className = 'admin-page py-4 py-md-5';
  main.innerHTML = `
    <div class="container">
      <section class="admin-shell" aria-labelledby="admin-page-title">
        <div class="admin-page-heading">
          <p class="eyebrow mb-2">АДМИНИСТРАЦИЯ</p>
          <h1 id="admin-page-title" class="h2 mb-2">Клиенти</h1>
          <p class="text-body-secondary mb-0">Прегледайте регистрациите и променете само статуса им на одобрение.</p>
        </div>
        <div class="admin-page-content mt-4"></div>
      </section>
    </div>
  `;

  const content = main.querySelector('.admin-page-content');
  let requestVersion = 0;
  let activeProfileId = null;
  let currentProfiles = [];
  let selectedFilter = 'pending';

  function clearRestrictedContent(message, type = 'warning') {
    requestVersion += 1;
    currentProfiles = [];
    activeProfileId = null;
    content.replaceChildren(createAlert(type, message));
  }

  function renderClientList(feedbackMessage = null, feedbackType = 'success') {
    const controls = document.createElement('div');
    controls.className = 'admin-list-controls mb-3';
    const filterLabel = createTextElement('label', 'form-label fw-semibold mb-1', 'Статус на регистрацията');
    filterLabel.htmlFor = 'admin-status-filter';
    const filter = document.createElement('select');
    filter.id = 'admin-status-filter';
    filter.className = 'form-select';
    filter.value = selectedFilter;
    [
      ['pending', 'Чакащи одобрение'],
      ['approved', 'Одобрени'],
      ['denied', 'Отказани'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      filter.append(option);
    });
    filter.addEventListener('change', () => {
      selectedFilter = filter.value;
      renderClientList();
    });
    controls.append(filterLabel, filter);

    const list = document.createElement('div');
    list.className = 'admin-client-list';
    const visibleProfiles = currentProfiles.filter((profile) => profile.approval_status === selectedFilter);

    if (visibleProfiles.length === 0) {
      list.append(createAlert('info', 'Няма клиентски регистрации с този статус.'));
    } else {
      visibleProfiles.forEach((profile) => list.append(createClientCard(profile, updateApprovalStatus)));
    }

    content.replaceChildren();
    if (feedbackMessage) {
      content.append(createAlert(feedbackType, feedbackMessage));
    }
    content.append(controls, list);
  }

  async function updateApprovalStatus(profile, nextStatus, card, feedback) {
    if (activeProfileId || profile.approval_status === nextStatus) {
      return;
    }

    activeProfileId = profile.id;
    card.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    feedback.replaceChildren(createAlert('info', 'Статусът се запазва…'));

    try {
      const { data: updatedProfile, error } = await supabase
        .from('profiles')
        .update({ approval_status: nextStatus })
        .eq('id', profile.id)
        .eq('role', 'client')
        .select('id, approval_status')
        .single();

      if (error) {
        throw error;
      }

      currentProfiles = currentProfiles.map((currentProfile) => (
        currentProfile.id === updatedProfile.id
          ? { ...currentProfile, approval_status: updatedProfile.approval_status }
          : currentProfile
      ));
      renderClientList(nextStatus === 'approved' ? 'Клиентът е одобрен.' : 'На клиента е отказан достъп.');
    } catch {
      feedback.replaceChildren(createAlert('danger', 'Статусът не беше променен. Проверете връзката си и опитайте отново.'));
      card.querySelectorAll('button').forEach((button) => {
        button.disabled = false;
      });
    } finally {
      activeProfileId = null;
    }
  }

  async function loadAdminContent(session) {
    const version = ++requestVersion;
    content.replaceChildren(createAlert('info', 'Проверка на администраторския достъп…'));

    try {
      const adminProfile = await getApprovedAdminProfile(session.user.id);
      if (version !== requestVersion) {
        return;
      }

      if (!adminProfile) {
        clearRestrictedContent('Тази страница е достъпна само за одобрени администратори.');
        return;
      }

      content.replaceChildren(createAlert('info', 'Зареждане на клиентските регистрации…'));
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select(`
          id,
          approval_status,
          created_at,
          salon_clients (
            salon_name,
            contact_name,
            phone,
            email,
            address
          )
        `)
        .eq('role', 'client')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      if (version !== requestVersion) {
        return;
      }

      currentProfiles = profiles || [];
      renderClientList();
    } catch {
      if (version === requestVersion) {
        clearRestrictedContent('Клиентските регистрации не могат да бъдат заредени. Опитайте отново по-късно.', 'danger');
      }
    }
  }

  async function refreshAccess() {
    if (!isSupabaseConfigured) {
      clearRestrictedContent('За администрацията е нужна активна връзка със Supabase.', 'info');
      return;
    }

    const { session, error } = await getSession();
    if (error || !session?.user) {
      clearRestrictedContent('Влезте с одобрен администраторски профил, за да управлявате регистрациите.');
      return;
    }

    await loadAdminContent(session);
  }

  const unsubscribe = subscribeToSessionChanges((_event, session) => {
    if (!session?.user) {
      clearRestrictedContent('Сесията е прекратена. Влезте отново, за да управлявате регистрациите.');
      return;
    }

    void loadAdminContent(session);
  });

  window.addEventListener('salon-auth-signed-out', () => {
    unsubscribe();
    clearRestrictedContent('Сесията е прекратена. Влезте отново, за да управлявате регистрациите.');
  }, { once: true });
  window.addEventListener('focus', () => {
    void refreshAccess();
  });

  await refreshAccess();
  return main;
}
