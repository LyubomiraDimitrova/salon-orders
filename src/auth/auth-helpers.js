import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';

export const PROFILE_PAGE = 'profile.html';

export function getSafeNextPage() {
  const nextPage = new URLSearchParams(window.location.search).get('next');
  return nextPage === PROFILE_PAGE ? nextPage : PROFILE_PAGE;
}

export function createAlert(type, message) {
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.role = type === 'danger' ? 'alert' : 'status';
  alert.textContent = message;
  return alert;
}

export function setFormBusy(form, submitButton, isBusy, busyLabel) {
  const controls = form.querySelectorAll('input, button');

  controls.forEach((control) => {
    control.disabled = isBusy;
  });

  if (!submitButton.dataset.defaultLabel) {
    submitButton.dataset.defaultLabel = submitButton.textContent;
  }

  submitButton.textContent = isBusy ? busyLabel : submitButton.dataset.defaultLabel;
}

export function getAuthErrorMessage(error, fallback) {
  const message = error?.message?.toLowerCase() || '';

  if (message.includes('invalid login credentials')) {
    return 'Невалиден имейл или парола.';
  }

  if (message.includes('email not confirmed')) {
    return 'Потвърдете имейла си, преди да влезете.';
  }

  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'Вече има регистрация с този имейл. Проверете пощата си или влезте.';
  }

  return fallback;
}

export function getPasswordPolicyErrorMessage(error) {
  const apiMessage = error?.message?.trim();
  const normalizedMessage = apiMessage?.toLowerCase() || '';
  const requirements = [];
  const lengthMatch = normalizedMessage.match(/(?:at least|minimum of)\s+(\d+)\s+(?:characters|character)/);

  if (lengthMatch) {
    requirements.push(`поне ${lengthMatch[1]} знака`);
  }

  if (normalizedMessage.includes('lowercase')) {
    requirements.push('малка буква');
  }

  if (normalizedMessage.includes('uppercase')) {
    requirements.push('главна буква');
  }

  if (normalizedMessage.includes('digit') || normalizedMessage.includes('number')) {
    requirements.push('цифра');
  }

  if (normalizedMessage.includes('symbol') || normalizedMessage.includes('special character')) {
    requirements.push('символ');
  }

  if (normalizedMessage.includes('leaked') || normalizedMessage.includes('pwned')) {
    return 'Паролата е открита в известен списък с изтекли пароли. Изберете различна, уникална парола.';
  }

  if (requirements.length > 0) {
    return `Паролата не отговаря на изискванията: ${requirements.join(', ')}.`;
  }

  return 'Паролата не отговаря на изискванията. Изберете по-силна парола и опитайте отново.';
}

export async function getSession() {
  if (!isSupabaseConfigured) {
    return { session: null, error: null };
  }

  const { data, error } = await supabase.auth.getSession();
  return { session: data.session, error };
}

export function subscribeToSessionChanges(callback) {
  if (!isSupabaseConfigured) {
    return () => {};
  }

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    window.setTimeout(() => callback(event, session), 0);
  });

  return () => data.subscription.unsubscribe();
}

export async function loadOwnProfile(userId) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, approval_status, salon_client_id')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (!profile || !profile.salon_client_id || profile.approval_status === 'denied') {
    return { profile, salonClient: null };
  }

  const { data: salonClient, error: salonClientError } = await supabase
    .from('salon_clients')
    .select('salon_name, contact_name, phone, email, address')
    .eq('id', profile.salon_client_id)
    .maybeSingle();

  if (salonClientError) {
    throw salonClientError;
  }

  return { profile, salonClient };
}

export async function updateOwnSalonContact(salonClientId, contactValues) {
  const { data, error } = await supabase
    .from('salon_clients')
    .update(contactValues)
    .eq('id', salonClientId)
    .select('salon_name, contact_name, phone, email, address')
    .single();

  if (error) {
    throw error;
  }

  return data;
}
