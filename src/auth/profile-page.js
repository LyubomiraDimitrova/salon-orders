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

function adminContactValues(salonClient, draft) {
  return {
    contact_name: draft?.contact_name ?? salonClient?.contact_name ?? '',
    phone: draft?.phone ?? salonClient?.phone ?? '',
    email: draft?.email ?? salonClient?.email ?? '',
    address: draft?.address ?? salonClient?.address ?? '',
  };
}

function appendReadOnlyField(form, label, value, options = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'mb-3';
  const fieldLabel = document.createElement('label');
  fieldLabel.className = 'form-label fw-semibold';
  const fieldId = options.id;
  fieldLabel.htmlFor = fieldId;
  fieldLabel.textContent = label;
  const field = options.multiline ? document.createElement('textarea') : document.createElement('input');
  field.className = 'form-control';
  field.id = fieldId;
  field.readOnly = true;
  field.value = value || 'Не е посочено';
  if (options.multiline) field.rows = 3;
  wrapper.append(fieldLabel, field);
  form.append(wrapper);
}

function createAdminReadOnlyProfile(profile, salonClient, userEmail, onEdit, message) {
  const section = document.createElement('section');
  const heading = document.createElement('h2');
  heading.className = 'h4 mb-3';
  heading.textContent = 'Данни за контакт';
  const feedback = document.createElement('div');
  feedback.setAttribute('aria-live', 'polite');
  if (message) feedback.append(createAlert('success', message));
  const form = document.createElement('form');
  appendReadOnlyField(form, 'Имейл за вход', userEmail, { id: 'admin-login-email' });
  appendReadOnlyField(form, 'Роля', profile.role === 'admin' ? 'Администратор' : profile.role, { id: 'admin-role' });
  appendReadOnlyField(form, 'Лице за контакт', salonClient?.contact_name, { id: 'admin-contact-name' });
  appendReadOnlyField(form, 'Телефон', salonClient?.phone, { id: 'admin-contact-phone' });
  appendReadOnlyField(form, 'Имейл за контакт', salonClient?.email, { id: 'admin-contact-email' });
  appendReadOnlyField(form, 'Адрес', salonClient?.address, { id: 'admin-contact-address', multiline: true });
  section.append(heading, feedback, form);

  if (!salonClient) {
    section.append(createAlert('warning', 'Контактните данни не са налични за този администраторски профил.'));
    return section;
  }

  const edit = document.createElement('button');
  edit.className = 'btn btn-outline-primary w-100';
  edit.type = 'button';
  edit.textContent = 'Редактирай';
  edit.addEventListener('click', onEdit);
  section.append(edit);
  return section;
}

function createAdminContactEditForm(salonClient, draft, handlers) {
  const values = adminContactValues(salonClient, draft);
  const form = document.createElement('form');
  form.noValidate = true;
  const heading = document.createElement('h2');
  heading.className = 'h4 mb-3';
  heading.textContent = 'Редакция на контакти';
  const contactName = createFormField({ id: 'admin-contact-name-edit', label: 'Лице за контакт', required: true });
  const phone = createFormField({ id: 'admin-contact-phone-edit', label: 'Телефон', type: 'tel', autocomplete: 'tel', required: true });
  const email = createFormField({ id: 'admin-contact-email-edit', label: 'Имейл за контакт', type: 'email', autocomplete: 'email', required: true });
  const emailNote = document.createElement('p');
  emailNote.className = 'form-text mb-3';
  emailNote.textContent = 'Промяната на имейла за контакт не променя имейла за вход.';
  const addressWrapper = document.createElement('div');
  addressWrapper.className = 'mb-3';
  const addressLabel = document.createElement('label');
  addressLabel.className = 'form-label fw-semibold';
  addressLabel.htmlFor = 'admin-contact-address-edit';
  addressLabel.textContent = 'Адрес';
  const address = document.createElement('textarea');
  address.className = 'form-control';
  address.id = 'admin-contact-address-edit';
  address.rows = 3;
  address.autocomplete = 'street-address';
  addressWrapper.append(addressLabel, address);
  const feedback = document.createElement('div');
  feedback.className = 'mb-3';
  feedback.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div');
  actions.className = 'd-grid gap-2';
  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.type = 'submit';
  save.textContent = 'Запази';
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-outline-primary';
  cancel.type = 'button';
  cancel.textContent = 'Отказ';
  actions.append(save, cancel);

  contactName.input.value = values.contact_name;
  phone.input.value = values.phone;
  email.input.value = values.email;
  address.value = values.address;

  const readValues = () => ({
    contact_name: contactName.input.value,
    phone: phone.input.value,
    email: email.input.value,
    address: address.value,
  });
  const isDirty = () => {
    const current = readValues();
    return Object.entries(adminContactValues(salonClient)).some(([key, value]) => current[key] !== value);
  };
  [contactName.input, phone.input, email.input, address].forEach((input) => input.addEventListener('input', () => handlers.onDraft(readValues())));
  cancel.addEventListener('click', () => {
    if (isDirty() && !window.confirm('Имате незапазени промени. Отказвате ли ги?')) return;
    handlers.onCancel();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    feedback.replaceChildren();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    handlers.onSave(readValues(), { form, feedback, save, cancel, address });
  });

  form.append(heading, contactName.wrapper, phone.wrapper, email.wrapper, emailNote, addressWrapper, feedback, actions);
  return form;
}

export async function createProfilePage() {
  const { main, content } = createAuthPageLayout({
    eyebrow: 'ПРОФИЛ',
    title: 'Профил',
    introduction: 'Зареждане на профила…',
  });

  const pageEyebrow = main.querySelector('.eyebrow');
  const pageTitle = main.querySelector('#auth-page-title');
  const pageIntroduction = main.querySelector('.text-body-secondary');
  const setClientHeading = () => { pageEyebrow.textContent = 'МОЯТ ПРОФИЛ'; pageTitle.textContent = 'Профил и салон'; pageIntroduction.textContent = 'Прегледайте статуса на регистрацията и актуализирайте данните за контакт.'; };
  const setAdminHeading = () => { pageEyebrow.textContent = 'АДМИНИСТРАЦИЯ'; pageTitle.textContent = 'Профил на администратор'; pageIntroduction.textContent = 'Прегледайте и актуализирайте данните си за контакт.'; };

  if (!isSupabaseConfigured) {
    setClientHeading();
    return main;
  }

  const state = { accountId: null, adminDraft: null, editingAdmin: false, profile: null, salonClient: null, savingAdmin: false, version: 0 };
  const isApprovedAdmin = (profile) => profile?.role === 'admin' && profile.approval_status === 'approved';
  const clearProtectedState = () => { state.accountId = null; state.adminDraft = null; state.editingAdmin = false; state.profile = null; state.salonClient = null; state.savingAdmin = false; };

  function showSignedOutState() {
    clearProtectedState();
    setClientHeading();
    const loginLink = document.createElement('a');
    loginLink.className = 'btn btn-primary w-100';
    loginLink.href = 'login.html?next=profile.html';
    loginLink.textContent = 'Към вход';
    content.replaceChildren(
      createAlert('warning', 'Влезте в профила си, за да видите данните на салона.'),
      loginLink,
    );
  }

  function renderAdminProfile(userEmail, message) {
    setAdminHeading();
    if (!state.editingAdmin) {
      content.replaceChildren(createAdminReadOnlyProfile(state.profile, state.salonClient, userEmail, () => {
        state.editingAdmin = true;
        state.adminDraft = null;
        renderAdminProfile(userEmail);
      }, message));
      return;
    }

    const form = createAdminContactEditForm(state.salonClient, state.adminDraft, {
      onDraft: (draft) => { state.adminDraft = draft; },
      onCancel: () => { state.editingAdmin = false; state.adminDraft = null; renderAdminProfile(userEmail); },
      onSave: async (draft, controls) => {
        if (state.savingAdmin) return;
        const accountId = state.accountId;
        state.savingAdmin = true;
        state.adminDraft = draft;
        setFormBusy(controls.form, controls.save, true, 'Запазване…');
        controls.address.disabled = true;
        try {
          const savedContact = await updateOwnSalonContact(state.profile.salon_client_id, {
            contact_name: draft.contact_name.trim(),
            phone: draft.phone.trim(),
            email: draft.email.trim(),
            address: draft.address.trim() || null,
          });
          if (state.accountId !== accountId || !isApprovedAdmin(state.profile)) return;
          state.salonClient = savedContact;
          state.adminDraft = null;
          state.editingAdmin = false;
          renderAdminProfile(userEmail, 'Данните за контакт са запазени.');
        } catch (error) {
          controls.feedback.append(createAlert('danger', getAuthErrorMessage(error, 'Данните не можаха да бъдат запазени. Опитайте отново.')));
        } finally {
          state.savingAdmin = false;
          if (controls.form.isConnected) {
            setFormBusy(controls.form, controls.save, false, 'Запазване…');
            controls.cancel.disabled = false;
            controls.address.disabled = false;
          }
        }
      },
    });
    content.replaceChildren(form);
  }

  async function loadProfile(sessionOverride, { preserveAdminWorkspace = false } = {}) {
    const { session, error: sessionError } = sessionOverride === undefined ? await getSession() : { session: sessionOverride, error: null };

    if (sessionError) {
      content.replaceChildren(createAlert('danger', 'Сесията не може да бъде проверена. Опитайте отново.'));
      return;
    }

    if (!session?.user) {
      showSignedOutState();
      return;
    }

    const version = ++state.version;
    const sameAccount = state.accountId === session.user.id;
    if (!(preserveAdminWorkspace && sameAccount && state.editingAdmin)) content.replaceChildren(createAlert('info', 'Зареждане на профила…'));

    try {
      const { profile, salonClient } = await loadOwnProfile(session.user.id);
      if (version !== state.version) return;

      if (!profile) {
        clearProtectedState();
        setClientHeading();
        content.replaceChildren(createAlert('warning', 'Профилът ви все още се подготвя. Излезте и влезте отново след малко.'));
        return;
      }

      if (isApprovedAdmin(profile)) {
        if (!sameAccount) clearProtectedState();
        state.accountId = session.user.id;
        state.profile = profile;
        state.salonClient = salonClient;
        if (preserveAdminWorkspace && sameAccount && state.editingAdmin) return;
        renderAdminProfile(session.user.email);
        return;
      }

      clearProtectedState();
      setClientHeading();
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
      if (version !== state.version) return;
      if (preserveAdminWorkspace && sameAccount && state.editingAdmin) return;
      clearProtectedState();
      setClientHeading();
      content.replaceChildren(createAlert('danger', getAuthErrorMessage(error, 'Профилът не можа да бъде зареден. Опитайте отново.')));
    }
  }

  const unsubscribe = subscribeToSessionChanges((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      unsubscribe();
      showSignedOutState();
      return;
    }
    void loadProfile(session, { preserveAdminWorkspace: true });
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
  window.addEventListener('focus', () => { void getSession().then(({ session }) => loadProfile(session, { preserveAdminWorkspace: true })); });
  return main;
}
