export function createSupabaseConfigurationNotice(message) {
  const notice = document.createElement('section');
  notice.className = 'container pt-3';
  notice.innerHTML = `
    <div class="alert alert-warning mb-0" role="status">
      <strong>Supabase не е настроен.</strong>
      Добавете <code>VITE_SUPABASE_URL</code> и
      <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> в <code>.env.local</code>,
      след което рестартирайте Vite.
      <span class="visually-hidden">${message}</span>
    </div>
  `;

  return notice;
}
