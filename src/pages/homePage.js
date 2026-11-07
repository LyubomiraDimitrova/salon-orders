import { getSession, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { getApprovedAdminProfile } from '../services/admin-access.js';
import { isSupabaseConfigured } from '../services/supabase-client.js';

function renderPublicHome(main) {
  main.innerHTML = `
    <section class="hero-section py-5 py-lg-6">
      <div class="container py-lg-4">
        <div class="row align-items-center g-5">
          <div class="col-lg-7">
            <p class="eyebrow mb-3">ЗА ВАШАТА КОСА</p>
            <h1 class="display-4 fw-bold mb-4">Професионална грижа, подбрана с внимание.</h1>
            <p class="lead text-body-secondary mb-4">
              Открийте продукти за ежедневна грижа и салонни резултати — на едно спокойно и удобно място.
            </p>
            <a class="btn btn-primary btn-lg px-4" href="catalog.html">Разгледайте колекцията</a>
          </div>
          <div class="col-lg-5">
            <div class="hero-card p-4 p-md-5">
              <p class="eyebrow mb-3">SALON ORDERS</p>
              <p class="h3 fw-semibold mb-3">Красотата започва с добра грижа.</p>
              <p class="mb-0 text-body-secondary">Скоро ще можете да разглеждате внимателно подбран каталог за вашия тип коса.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="welcome" class="py-5 bg-white">
      <div class="container">
        <div class="row g-4">
          <div class="col-md-4">
            <article class="feature-card h-100 p-4">
              <h2 class="h4">Подбран каталог</h2>
              <p class="mb-0 text-body-secondary">Продукти за грижа, стилизиране и вдъхновение.</p>
            </article>
          </div>
          <div class="col-md-4">
            <article class="feature-card h-100 p-4">
              <h2 class="h4">Лесен избор</h2>
              <p class="mb-0 text-body-secondary">Ясна информация, която помага да откриете подходящата грижа.</p>
            </article>
          </div>
          <div class="col-md-4">
            <article class="feature-card h-100 p-4">
              <h2 class="h4">Салонно отношение</h2>
              <p class="mb-0 text-body-secondary">Внимание към всеки детайл от избора до грижата у дома.</p>
            </article>
          </div>
        </div>
      </div>
    </section>`;
}

function renderAdminHome(main) {
  main.innerHTML = `
    <section class="hero-section py-5 py-lg-6">
      <div class="container py-lg-4">
        <div class="row align-items-center g-5">
          <div class="col-lg-7">
            <p class="eyebrow mb-3">АДМИНИСТРАЦИЯ</p>
            <h1 class="display-4 fw-bold mb-4">Професионална грижа, подбрана с внимание.</h1>
            <p class="lead text-body-secondary mb-4">Бърз достъп до ежедневните задачи за управление на салона.</p>
            <div class="admin-home-actions">
              <a class="btn btn-primary btn-lg" href="admin-orders.html">Поръчки</a>
              <a class="btn btn-primary btn-lg" href="admin.html">Клиенти</a>
            </div>
          </div>
          <div class="col-lg-5">
            <div class="hero-card p-4 p-md-5">
              <p class="eyebrow mb-3">SALON ORDERS</p>
              <p class="mb-0 text-body-secondary">Управлявайте поръчките, клиентите и важните данни за салона от едно място.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="py-5 bg-white">
      <div class="container">
        <div class="row g-4">
          <div class="col-md-4">
            <a class="feature-card admin-home-feature-link h-100 p-4" href="catalog.html">
              <h2 class="h4">Каталог</h2>
              <p class="mb-0 text-body-secondary">Продукти за грижа, стилизиране и вдъхновение.</p>
            </a>
          </div>
          <div class="col-md-4">
            <a class="feature-card admin-home-feature-link h-100 p-4" href="inventory.html">
              <h2 class="h4">Наличности</h2>
              <p class="mb-0 text-body-secondary">Следете количествата и движенията на продуктите.</p>
            </a>
          </div>
          <div class="col-md-4">
            <a class="feature-card admin-home-feature-link h-100 p-4" href="reports.html">
              <h2 class="h4">Отчети</h2>
              <p class="mb-0 text-body-secondary">Преглеждайте продадените количества по продукт и период.</p>
            </a>
          </div>
        </div>
      </div>
    </section>`;
}

function renderLoadingHome(main) {
  main.innerHTML = `
    <section class="hero-section py-5 py-lg-6" aria-busy="true">
      <div class="container py-lg-4">
        <p class="text-body-secondary mb-0">Проверка на достъпа…</p>
      </div>
    </section>`;
}

export function createHomePage() {
  const main = document.createElement('main');
  let accessCheckVersion = 0;

  async function refreshHome(session) {
    const version = ++accessCheckVersion;
    renderLoadingHome(main);

    if (!isSupabaseConfigured) {
      renderPublicHome(main);
      return;
    }

    const sessionResult = session === undefined ? await getSession() : { session };
    if (version !== accessCheckVersion) return;
    const activeSession = sessionResult.session;
    if (!activeSession?.user) {
      renderPublicHome(main);
      return;
    }

    try {
      const adminProfile = await getApprovedAdminProfile(activeSession.user.id);
      if (version !== accessCheckVersion) return;
      if (adminProfile) {
        renderAdminHome(main);
        return;
      }
    } catch {
      if (version !== accessCheckVersion) return;
    }

    if (version === accessCheckVersion) renderPublicHome(main);
  }

  renderLoadingHome(main);
  void refreshHome();
  subscribeToSessionChanges((_event, session) => {
    void refreshHome(session);
  });
  window.addEventListener('focus', () => { void refreshHome(); });

  return main;
}
