import {
  createAlert,
  getAuthErrorMessage,
  getPasswordPolicyErrorMessage,
  getSession,
  setFormBusy,
} from './auth-helpers.js';
import { createAuthPageLayout, createFormField } from './auth-page-layout.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';

export async function createRegisterPage() {
  const { main, content } = createAuthPageLayout({
    eyebrow: 'НОВА РЕГИСТРАЦИЯ',
    title: 'Създайте профил',
    introduction: 'След регистрацията данните на салона ви ще чакат одобрение от администратор.',
  });

  if (!isSupabaseConfigured) {
    return main;
  }

  const { session } = await getSession();
  if (session) {
    window.location.replace('profile.html');
    return main;
  }

  const form = document.createElement('form');
  form.noValidate = true;
  const email = createFormField({
    id: 'register-email',
    label: 'Имейл',
    type: 'email',
    autocomplete: 'email',
    required: true,
  });
  const password = createFormField({
    id: 'register-password',
    label: 'Парола',
    type: 'password',
    autocomplete: 'new-password',
    required: true,
    minLength: 8,
    passwordToggle: true,
  });
  const confirmation = createFormField({
    id: 'register-password-confirmation',
    label: 'Потвърдете паролата',
    type: 'password',
    autocomplete: 'new-password',
    required: true,
    minLength: 8,
    passwordToggle: true,
  });
  const passwordHint = document.createElement('p');
  passwordHint.className = 'form-text mb-3';
  passwordHint.id = 'register-password-requirements';
  passwordHint.textContent = 'Използвайте поне 8 знака.';
  password.input.setAttribute('aria-describedby', passwordHint.id);
  const status = document.createElement('div');
  status.className = 'mb-3';
  status.setAttribute('aria-live', 'polite');
  const submitButton = document.createElement('button');
  submitButton.className = 'btn btn-primary w-100';
  submitButton.type = 'submit';
  submitButton.textContent = 'Регистрация';
  const loginPrompt = document.createElement('p');
  loginPrompt.className = 'text-center mb-0 mt-4';
  loginPrompt.innerHTML = 'Вече имате профил? <a href="login.html">Влезте</a>.';

  form.append(
    email.wrapper,
    password.wrapper,
    passwordHint,
    confirmation.wrapper,
    status,
    submitButton,
    loginPrompt,
  );
  content.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.replaceChildren();

    if (password.input.value.length < password.input.minLength) {
      password.input.setCustomValidity('Паролата трябва да е поне 8 знака.');
      form.reportValidity();
      password.input.setCustomValidity('');
      return;
    }

    if (confirmation.input.value.length < confirmation.input.minLength) {
      confirmation.input.setCustomValidity('Потвърждението на паролата трябва да е поне 8 знака.');
      form.reportValidity();
      confirmation.input.setCustomValidity('');
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (password.input.value !== confirmation.input.value) {
      confirmation.input.setCustomValidity('Паролите не съвпадат.');
      form.reportValidity();
      confirmation.input.setCustomValidity('');
      return;
    }

    setFormBusy(form, submitButton, true, 'Регистрация…');

    const { data, error } = await supabase.auth.signUp({
      email: email.input.value.trim(),
      password: password.input.value,
    });

    if (error) {
      const passwordError = error.code === 'weak_password'
        || /password|leaked|pwned/i.test(error.message || '');
      const message = passwordError
        ? getPasswordPolicyErrorMessage(error)
        : getAuthErrorMessage(error, 'Регистрацията не можа да бъде завършена. Опитайте отново.');
      status.append(createAlert('danger', message));
      setFormBusy(form, submitButton, false, 'Регистрация…');
      return;
    }

    if (data.session) {
      window.location.assign('profile.html');
      return;
    }

    form.replaceChildren(
      createAlert(
        'success',
        'Проверете пощата си и потвърдете имейла. След потвърждение влезте, за да попълните данните на салона си.',
      ),
    );
  });

  return main;
}
