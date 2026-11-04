import {
  createAlert,
  getAuthErrorMessage,
  getSession,
  loadOwnProfile,
  setFormBusy,
  subscribeToSessionChanges,
  updateOwnSalonContact,
} from './auth-helpers.js';
import { createAuthPageLayout, createFormField } from './auth-page-layout.js';
import { isSupabaseConfigured } from '../services/supabase-client.js';

const approvalMessages = {
  pending: {
    type: 'warning',
    title: 'Изчаква одобрение',
    message: 'Регистрацията ви чака одобрение. Може да актуализирате данните на салона си.',
  },
  approved: {
    type: 'success',
    title: 'Одобрен профил',
    message: 'Профилът ви е одобрен. Данните на салона ви могат да се актуализират по всяко време.',
  },
  denied: {
    type: 'danger',
    title: 'Регистрацията не е одобрена',
    message: 'Свържете се с администратора, ако смятате, че това е грешка.',
  },
};

function createProfileSummary(profile, userEmail) {
  const summary = document.createElement('section');
  summary.className = 'auth-profile-summary mb-4';
  const status = approvalMessages[profile.approval_status] || approvalMessages.pending;
  const heading = document.createElement('h2');
  heading.className = 'h5 mb-2';
  heading.textContent = status.title;
  const message = document.createElement('p');
  message.className = 'mb-3';
  message.textContent = status.message;
  const email = document.createElement('p');
  email.className = 'small mb-1';
  email.textContent = `Вход с имейл: ${userEmail || 'Не е посочен'}`;
  const role = document.createElement('p');
  role.className = 'small mb-0';
  role.textContent = `Роля: ${profile.role === 'admin' ? 'Администратор' : 'Клиент'}`;

  summary.append(heading, message, email, role);
  return { summary, status };
}

function createSalonForm(profile, salonClient) {
  const form = document.createElement('form');
  form.noValidate = true;
  const heading = document.createElement('h2');
  heading.className = 'h4 mb-3';
  heading.textContent = 'Данни за салона';
  const salonName = createFormField({ id: 'profile-salon-name', label: 'Име на салона', required: true });
  const contactName = createFormField({ id: 'profile-contact-name', label: 'Лице за контакт', required: true });
  const phone = createFormField({
    id: 'profile-phone',
    label: 'Телефон',
    type: 'tel',
    autocomplete: 'tel',
    required: true,
  });
  const email = createFormField({
    id: 'profile-contact-email',
    label: 'Имейл за контакт',
    type: 'email',
    autocomplete: 'email',
    required: true,
  });
  const addressWrapper = document.createElement('div');
  addressWrapper.className = 'mb-3';
  const addressLabel = document.createElement('label');
  addressLabel.className = 'form-label fw-semibold';
  addressLabel.htmlFor = 'profile-address';
  addressLabel.textContent = 'Адрес';
  const address = document.createElement('textarea');
  address.className = 'form-control';
  address.id = 'profile-address';
  address.name = 'profile-address';
  address.rows = 3;
  address.autocomplete = 'street-address';
  addressWrapper.append(addressLabel, address);
  const status = document.createElement('div');
  status.className = 'mb-3';
  status.setAttribute('aria-live', 'polite');
  const submitButton = document.createElement('button');
  submitButton.className = 'btn btn-primary w-100';
  submitButton.type = 'submit';
  submitButton.textContent = 'Запазване на данните';

  salonName.input.value = salonClient.salon_name || '';
  contactName.input.value = salonClient.contact_name || '';
  phone.input.value = salonClient.phone || '';
  email.input.value = salonClient.email || '';
  address.value = salonClient.address || '';

  form.append(
    heading,
    salonName.wrapper,
    contactName.wrapper,
    phone.wrapper,
    email.wrapper,
    addressWrapper,
    status,
    submitButton,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.replaceChildren();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const values = {
      salon_name: salonName.input.value.trim(),
      contact_name: contactName.input.value.trim(),
      phone: phone.input.value.trim(),
      email: email.input.value.trim(),
      address: address.value.trim() || null,
    };

    setFormBusy(form, submitButton, true, 'Запазване…');

    try {
      const savedContact = await updateOwnSalonContact(profile.salon_client_id, values);
      salonName.input.value = savedContact.salon_name || '';
      contactName.input.value = savedContact.contact_name || '';
      phone.input.value = savedContact.phone || '';
      email.input.value = savedContact.email || '';
      address.value = savedContact.address || '';
      status.append(createAlert('success', 'Данните са запазени.'));
    } catch (error) {
      status.append(createAlert('danger', getAuthErrorMessage(error, 'Данните не можаха да бъдат запазени. Опитайте отново.')));
    } finally {
      setFormBusy(form, submitButton, false, 'Запазване…');
    }
  });

  return form;
}

export async function createProfilePage() {
  const { main, content } = createAuthPageLayout({
    eyebrow: 'МОЯТ ПРОФИЛ',
    title: 'Профил и салон',
    introduction: 'Прегледайте статуса на регистрацията и актуализирайте данните за контакт.',
  });

  if (!isSupabaseConfigured) {
    return main;
  }

  function showSignedOutState() {
    const loginLink = document.createElement('a');
    loginLink.className = 'btn btn-primary w-100';
    loginLink.href = 'login.html?next=profile.html';
    loginLink.textContent = 'Към вход';
    content.replaceChildren(
      createAlert('warning', 'Влезте в профила си, за да видите данните на салона.'),
      loginLink,
    );
  }

  async function loadProfile() {
    const { session, error: sessionError } = await getSession();

    if (sessionError) {
      content.replaceChildren(createAlert('danger', 'Сесията не може да бъде проверена. Опитайте отново.'));
      return;
    }

    if (!session?.user) {
      showSignedOutState();
      return;
    }

    content.replaceChildren(createAlert('info', 'Зареждане на профила…'));

    try {
      const { profile, salonClient } = await loadOwnProfile(session.user.id);

      if (!profile) {
        content.replaceChildren(createAlert('warning', 'Профилът ви все още се подготвя. Излезте и влезте отново след малко.'));
        return;
      }

      const { summary, status } = createProfileSummary(profile, session.user.email);
      content.replaceChildren(summary);

      if (profile.approval_status === 'denied') {
        return;
      }

      if (!profile.salon_client_id) {
        content.append(createAlert('info', 'Към този профил няма свързан салонен запис.'));
        return;
      }

      if (!salonClient) {
        content.append(createAlert('warning', 'Данните на салона не са налични за този профил.'));
        return;
      }

      content.append(createSalonForm(profile, salonClient));

      if (status.type === 'pending') {
        const note = document.createElement('p');
        note.className = 'form-text mt-3 mb-0';
        note.textContent = 'Одобрението не се променя от тази страница.';
        content.append(note);
      }
    } catch (error) {
      content.replaceChildren(createAlert('danger', getAuthErrorMessage(error, 'Профилът не можа да бъде зареден. Опитайте отново.')));
    }
  }

  const unsubscribe = subscribeToSessionChanges((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      unsubscribe();
      showSignedOutState();
    }
  });

  window.addEventListener(
    'salon-auth-signed-out',
    () => {
      unsubscribe();
      showSignedOutState();
    },
    { once: true },
  );

  await loadProfile();
  return main;
}
