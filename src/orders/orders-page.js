import { createAlert, getSession, loadOwnProfile, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';
import { clearClientOrderStorage } from './client-order-store.js';
import {
  createStatusBadge,
  formatDate,
  formatDateTime,
  formatTimeInterval,
} from './order-page-utils.js';

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function isApprovedClient(profile) {
  return profile?.role === 'client'
    && profile.approval_status === 'approved'
    && Boolean(profile.salon_client_id);
}

function createPrivateAccessState(message, href = 'login.html?next=orders.html', label = 'Към вход') {
  const wrapper = createElement('section', 'client-order-card p-4');
  const link = createElement('a', 'btn btn-primary w-100', label);
  link.href = href;
  wrapper.append(createAlert('warning', message), link);
  return wrapper;
}

function appendSnapshotField(container, label, value) {
  if (!value) return;
  const row = createElement('p', 'mb-1');
  row.append(createElement('strong', null, `${label}: `), document.createTextNode(value));
  container.append(row);
}

function createLineDescription(line) {
  const parts = [
    line.brand_name_snapshot,
    line.product_size_snapshot,
    line.product_article_code_snapshot ? `Арт. ${line.product_article_code_snapshot}` : null,
    line.product_series_name_snapshot,
    [line.product_shade_number_snapshot, line.product_shade_name_snapshot].filter(Boolean).join(' '),
    line.product_developer_concentration_snapshot,
  ].filter(Boolean);

  return parts.join(' · ');
}

function createOrderCard(order) {
  const card = createElement('details', 'client-order-history-card p-3 p-md-4');
  const summary = createElement('summary', 'd-flex flex-wrap justify-content-between align-items-center gap-2');
  const heading = createElement('div');
  heading.append(
    createElement('h2', 'h5 mb-1', `Поръчка № ${order.order_number}`),
    createElement('p', 'small text-body-secondary mb-0', `Подадена: ${formatDateTime(order.created_at)}`),
  );
  summary.append(heading, createStatusBadge(order.status));

  const body = createElement('div', 'pt-4');
  const delivery = createElement('section', 'mb-4');
  delivery.append(createElement('h3', 'h6', 'Заявена доставка'));
  appendSnapshotField(delivery, 'Дата', formatDate(order.requested_delivery_date));
  appendSnapshotField(delivery, 'Часови интервал', formatTimeInterval(order.requested_delivery_time_from, order.requested_delivery_time_to));
  appendSnapshotField(delivery, 'Инструкции', order.delivery_instructions);
  appendSnapshotField(delivery, 'Бележка', order.customer_note);

  const contact = createElement('section', 'mb-4');
  contact.append(createElement('h3', 'h6', 'Контакт при подаване'));
  appendSnapshotField(contact, 'Салон', order.salon_name_snapshot);
  appendSnapshotField(contact, 'Лице за контакт', order.contact_name_snapshot);
  appendSnapshotField(contact, 'Телефон', order.phone_snapshot);
  appendSnapshotField(contact, 'Имейл', order.email_snapshot);
  appendSnapshotField(contact, 'Адрес', order.address_snapshot);

  const products = createElement('section', 'mb-4');
  products.append(createElement('h3', 'h6', 'Заявени продукти'));
  const list = createElement('ul', 'client-order-snapshot-list');
  (order.order_lines || []).forEach((line) => {
    const item = createElement('li');
    item.append(createElement('strong', null, `${line.product_name_snapshot} — ${line.quantity} бр.`));
    const description = createLineDescription(line);
    if (description) item.append(createElement('div', 'small text-body-secondary', description));
    list.append(item);
  });
  products.append(list);

  const changeNotice = createAlert('info', 'За промяна или отказ се свържете с нас.');
  card.append(summary, body);
  body.append(delivery, contact, products, changeNotice);
  return card;
}

export function createOrdersPage() {
  const main = createElement('main', 'client-order-page py-4 py-md-5');
  const container = createElement('div', 'container');
  const heading = createElement('h1', 'display-6 fw-bold mb-3', 'Моите поръчки');
  const introduction = createElement('p', 'lead text-body-secondary mb-4', 'Прегледайте заявките си и запазените данни към момента на подаването им.');
  const content = createElement('section', 'd-grid gap-3');
  container.append(heading, introduction, content);
  main.append(container);

  let accountId = null;
  let pageActive = true;

  async function loadOrders() {
    if (!isSupabaseConfigured || !pageActive) return;
    const { session, error: sessionError } = await getSession();
    if (sessionError) {
      content.replaceChildren(createAlert('danger', 'Сесията не може да бъде проверена. Опитайте отново.'));
      return;
    }
    if (!session?.user) {
      content.replaceChildren(createPrivateAccessState('Влезте с одобрен клиентски профил, за да видите поръчките си.'));
      return;
    }

    try {
      const { profile } = await loadOwnProfile(session.user.id);
      if (!isApprovedClient(profile)) {
        content.replaceChildren(createPrivateAccessState(
          'Само одобрени клиентски профили могат да преглеждат историята на поръчките.',
          'profile.html',
          'Към профила',
        ));
        return;
      }

      accountId = session.user.id;
      content.replaceChildren(createAlert('info', 'Зареждане на поръчките…'));
      const { data: orders, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          status,
          requested_delivery_date,
          requested_delivery_time_from,
          requested_delivery_time_to,
          salon_name_snapshot,
          contact_name_snapshot,
          phone_snapshot,
          email_snapshot,
          address_snapshot,
          delivery_instructions,
          customer_note,
          created_at,
          order_lines (
            id,
            product_id,
            product_name_snapshot,
            product_size_snapshot,
            product_article_code_snapshot,
            brand_name_snapshot,
            product_series_name_snapshot,
            product_shade_number_snapshot,
            product_shade_name_snapshot,
            product_developer_concentration_snapshot,
            quantity
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!orders?.length) {
        const empty = createElement('section', 'client-order-summary p-4');
        const catalogLink = createElement('a', 'btn btn-primary', 'Към каталога');
        catalogLink.href = 'catalog.html';
        empty.append(createElement('p', 'mb-3', 'Все още нямате изпратени поръчки.'), catalogLink);
        content.replaceChildren(empty);
        return;
      }

      content.replaceChildren(...orders.map(createOrderCard));
    } catch {
      content.replaceChildren(createAlert('danger', 'Историята на поръчките не може да бъде заредена. Опитайте отново.'));
    }
  }

  if (!isSupabaseConfigured) {
    content.append(createAlert('warning', 'Историята ще бъде налична след настройване на връзката с услугата.'));
    return main;
  }

  const unsubscribe = subscribeToSessionChanges((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      pageActive = false;
      if (accountId) clearClientOrderStorage(accountId);
      content.replaceChildren(createPrivateAccessState('Влезте с одобрен клиентски профил, за да видите поръчките си.'));
    }
  });
  window.addEventListener('salon-auth-signed-out', () => unsubscribe(), { once: true });
  void loadOrders();
  return main;
}
