import { createAlert, getSession, loadOwnProfile, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';
import {
  buildWebsiteOrderPayload,
  clearClientOrderStorage,
  discardSubmissionIfPayloadChanged,
  getClientCart,
  getOrCreateWebsiteSubmission,
  getPendingWebsiteSubmission,
  saveClientCart,
} from './client-order-store.js';

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createPrivateAccessState(message, linkLabel = 'Към вход') {
  const wrapper = createElement('section', 'client-order-card p-4');
  const link = createElement('a', 'btn btn-primary w-100', linkLabel);
  link.href = 'login.html?next=cart.html';
  wrapper.append(createAlert('warning', message), link);
  return wrapper;
}

function isApprovedClient(profile) {
  return profile?.role === 'client'
    && profile.approval_status === 'approved'
    && Boolean(profile.salon_client_id);
}

function getFormValues(form) {
  return {
    requestedDeliveryDate: form.elements.requestedDeliveryDate.value,
    deliveryInstructions: form.elements.deliveryInstructions.value,
  };
}

function createCartItem(item, onQuantityChange, onRemove) {
  const row = createElement('li', 'client-cart-item py-3');
  const details = createElement('div', 'mb-3');
  const name = createElement('h2', 'h6 mb-1', item.name);
  const metadata = [item.brandName, item.sizeLabel, item.articleCode ? `Арт. ${item.articleCode}` : null]
    .filter(Boolean)
    .join(' · ');
  details.append(name);
  if (metadata) details.append(createElement('p', 'small text-body-secondary mb-0', metadata));

  const controls = createElement('div', 'd-flex flex-wrap align-items-end gap-2');
  const quantityGroup = createElement('div');
  const quantityLabel = createElement('label', 'form-label small mb-1', 'Количество');
  const quantityInput = document.createElement('input');
  quantityInput.className = 'form-control client-cart-quantity';
  quantityInput.type = 'number';
  quantityInput.min = '1';
  quantityInput.max = '2147483647';
  quantityInput.step = '1';
  quantityInput.inputMode = 'numeric';
  quantityInput.value = String(item.quantity);
  quantityLabel.htmlFor = `cart-quantity-${item.productId}`;
  quantityInput.id = quantityLabel.htmlFor;
  quantityInput.addEventListener('change', () => onQuantityChange(item.productId, quantityInput.value));
  quantityGroup.append(quantityLabel, quantityInput);

  const removeButton = createElement('button', 'btn btn-outline-primary', 'Премахни');
  removeButton.type = 'button';
  removeButton.addEventListener('click', () => onRemove(item.productId));
  controls.append(quantityGroup, removeButton);
  row.append(details, controls);
  return row;
}

export function createCartPage() {
  const main = createElement('main', 'client-order-page py-4 py-md-5');
  const container = createElement('div', 'container');
  const heading = createElement('h1', 'display-6 fw-bold mb-3', 'Кошница');
  const introduction = createElement('p', 'lead text-body-secondary mb-4', 'Изпратете заявка за доставка. Наличността и срокът се потвърждават от администратора.');
  const content = createElement('section');
  container.append(heading, introduction, content);
  main.append(container);

  let accountId = null;
  let form = null;
  let itemsContainer = null;
  let pageActive = true;

  function renderCart() {
    if (!accountId || !itemsContainer) return;

    const cart = getClientCart(accountId);
    itemsContainer.replaceChildren();

    if (cart.length === 0) {
      const empty = createElement('div', 'client-order-summary p-4');
      const catalogLink = createElement('a', 'btn btn-primary w-100', 'Към каталога');
      catalogLink.href = 'catalog.html';
      empty.append(createElement('p', 'mb-3', 'Кошницата е празна.'), catalogLink);
      itemsContainer.append(empty);
      form.querySelector('button[type="submit"]').disabled = true;
      return;
    }

    const list = createElement('ul', 'list-unstyled client-order-card p-3 p-md-4 mb-0');
    cart.forEach((item) => list.append(createCartItem(
      item,
      (productId, value) => {
        const quantity = Number(value);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
          renderCart();
          return;
        }
        saveClientCart(accountId, cart.map((cartItem) => (
          cartItem.productId === productId ? { ...cartItem, quantity } : cartItem
        )));
        discardSubmissionIfPayloadChanged(accountId, buildWebsiteOrderPayload(getClientCart(accountId), getFormValues(form)));
        renderCart();
      },
      (productId) => {
        saveClientCart(accountId, cart.filter((cartItem) => cartItem.productId !== productId));
        discardSubmissionIfPayloadChanged(accountId, buildWebsiteOrderPayload(getClientCart(accountId), getFormValues(form)));
        renderCart();
      },
    )));
    itemsContainer.append(list);
    form.querySelector('button[type="submit"]').disabled = false;
  }

  function renderOrderForm() {
    const card = createElement('section', 'client-order-card p-3 p-md-4');
    form = document.createElement('form');
    form.noValidate = true;
    const formStatus = createElement('div', 'mb-3');
    formStatus.setAttribute('aria-live', 'polite');
    const date = document.createElement('input');
    const instructions = document.createElement('textarea');
    const submit = createElement('button', 'btn btn-primary w-100', 'Изпрати заявката');
    submit.type = 'submit';
    date.type = 'date';
    date.name = 'requestedDeliveryDate';
    date.required = true;
    instructions.name = 'deliveryInstructions';
    [date, instructions].forEach((control) => control.className = 'form-control');
    instructions.rows = 3;
    instructions.maxLength = 2000;

    const pending = getPendingWebsiteSubmission(accountId);
    if (pending?.payload) {
      date.value = pending.payload.p_requested_delivery_date || '';
      instructions.value = pending.payload.p_delivery_instructions || '';
    }

    const fields = [
      ['Желан ден за доставка', date, 'Заявеният ден подлежи на потвърждение от администратора.'],
      ['Бележка за доставката (например удобен час)', instructions, null],
    ];
    fields.forEach(([labelText, control, hint], index) => {
      const wrapper = createElement('div', 'mb-3');
      const label = createElement('label', 'form-label fw-semibold', labelText);
      const id = `cart-field-${index}`;
      control.id = id;
      label.htmlFor = id;
      wrapper.append(label, control);
      if (hint) wrapper.append(createElement('div', 'form-text', hint));
      form.append(wrapper);
    });
    form.append(formStatus, submit);

    form.addEventListener('input', () => {
      discardSubmissionIfPayloadChanged(accountId, buildWebsiteOrderPayload(getClientCart(accountId), getFormValues(form)));
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      formStatus.replaceChildren();
      const cart = getClientCart(accountId);

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      if (cart.length === 0) {
        formStatus.append(createAlert('danger', 'Добавете поне един продукт в кошницата.'));
        return;
      }

      const payload = buildWebsiteOrderPayload(cart, getFormValues(form));
      let submission;
      try {
        submission = getOrCreateWebsiteSubmission(accountId, payload);
      } catch {
        formStatus.append(createAlert('danger', 'Заявката не може да получи защитен идентификатор. Опитайте с актуален браузър.'));
        return;
      }

      const controls = form.querySelectorAll('input, textarea, button');
      controls.forEach((control) => control.disabled = true);
      submit.textContent = 'Изпращане…';

      try {
        const { data, error } = await supabase.rpc('submit_website_order', {
          p_request_id: submission.requestId,
          ...submission.payload,
        });

        if (error) throw error;
        const order = Array.isArray(data) ? data[0] : data;
        if (!order?.order_number) {
          throw new Error('The server did not confirm an order number.');
        }

        clearClientOrderStorage(accountId);
        content.replaceChildren(
          createAlert('success', `Заявката е изпратена успешно. Номер на поръчката: № ${order.order_number}.`),
          (() => {
            const historyLink = createElement('a', 'btn btn-primary', 'Към моите поръчки');
            historyLink.href = 'orders.html';
            return historyLink;
          })(),
        );
      } catch (error) {
        formStatus.append(createAlert(
          'danger',
          'Не получихме потвърждение за заявката. Данните и идентификаторът са запазени; опитайте отново със същата заявка.',
        ));
      } finally {
        controls.forEach((control) => control.disabled = false);
        submit.textContent = 'Изпрати заявката';
      }
    });

    card.append(createElement('h2', 'h4 mb-3', 'Данни за заявката'), form);
    return card;
  }

  async function loadPage() {
    if (!isSupabaseConfigured || !pageActive) return;
    const { session, error } = await getSession();
    if (error) {
      content.replaceChildren(createAlert('danger', 'Сесията не може да бъде проверена. Опитайте отново.'));
      return;
    }
    if (!session?.user) {
      content.replaceChildren(createPrivateAccessState('Влезте с одобрен клиентски профил, за да изпратите поръчка.'));
      return;
    }

    try {
      const { profile } = await loadOwnProfile(session.user.id);
      if (!isApprovedClient(profile)) {
        content.replaceChildren(createPrivateAccessState('Само одобрени клиентски профили могат да изпращат поръчки.', 'Към профила'));
        content.querySelector('a').href = 'profile.html';
        return;
      }

      accountId = session.user.id;
      itemsContainer = createElement('section', 'mb-4');
      content.replaceChildren(itemsContainer, renderOrderForm());
      renderCart();
    } catch {
      content.replaceChildren(createAlert('danger', 'Кошницата не може да бъде заредена. Опитайте отново.'));
    }
  }

  if (!isSupabaseConfigured) {
    content.append(createAlert('warning', 'Кошницата ще бъде налична след настройване на връзката с услугата.'));
    return main;
  }

  const unsubscribe = subscribeToSessionChanges((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      pageActive = false;
      if (accountId) clearClientOrderStorage(accountId);
      content.replaceChildren(createPrivateAccessState('Влезте с одобрен клиентски профил, за да изпратите поръчка.'));
    }
  });
  window.addEventListener('salon-auth-signed-out', () => unsubscribe(), { once: true });
  void loadPage();
  return main;
}
