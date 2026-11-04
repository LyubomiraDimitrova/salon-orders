import {
  createAlert,
  getAuthErrorMessage,
  getSafeNextPage,
  getSession,
  setFormBusy,
} from './auth-helpers.js';
import { createAuthPageLayout, createFormField } from './auth-page-layout.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';

export async function createLoginPage() {
  const { main, content } = createAuthPageLayout({
    eyebrow: 'ДОБРЕ ДОШЛИ',
    title: 'Вход',
    introduction: 'Влезте, за да прегледате и актуализирате данните на салона си.',
  });

  if (!isSupabaseConfigured) {
    return main;
  }

  const { session } = await getSession();
  if (session) {
    window.location.replace(getSafeNextPage());
    return main;
  }

  const form = document.createElement('form');
  form.noValidate = true;
  const email = createFormField({
    id: 'login-email',
    label: 'Имейл',
    type: 'email',
    autocomplete: 'email',
    required: true,
  });
  const password = createFormField({
    id: 'login-password',
    label: 'Парола',
    type: 'password',
    autocomplete: 'current-password',
    required: true,
    passwordToggle: true,
  });
  const status = document.createElement('div');
  status.className = 'mb-3';
  status.setAttribute('aria-live', 'polite');
  const submitButton = document.createElement('button');
  submitButton.className = 'btn btn-primary w-100';
  submitButton.type = 'submit';
  submitButton.textContent = 'Вход';
  const registerPrompt = document.createElement('p');
  registerPrompt.className = 'text-center mb-0 mt-4';
  registerPrompt.innerHTML = 'Нямате регистрация? <a href="register.html">Регистрирайте се</a>.';

  form.append(email.wrapper, password.wrapper, status, submitButton, registerPrompt);
  content.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.replaceChildren();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setFormBusy(form, submitButton, true, 'Влизане…');

    const { error } = await supabase.auth.signInWithPassword({
      email: email.input.value.trim(),
      password: password.input.value,
    });

    if (error) {
      status.append(createAlert('danger', getAuthErrorMessage(error, 'Входът не можа да бъде извършен. Опитайте отново.')));
      setFormBusy(form, submitButton, false, 'Влизане…');
      return;
    }

    window.location.assign(getSafeNextPage());
  });

  return main;
}
