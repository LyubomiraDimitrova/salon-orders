import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';

function createNavigationLink(label, href, isActive = false) {
  const link = document.createElement('a');
  link.className = `nav-link${isActive ? ' active' : ''}`;
  link.href = href;
  link.textContent = label;
  link.toggleAttribute('aria-current', isActive);
  return link;
}

function mountAccountNavigation(header, currentPage) {
  const navigation = header.querySelector('[data-auth-navigation]');

  function render(session) {
    const group = document.createElement('div');
    group.className = 'd-lg-flex align-items-lg-center gap-lg-2';

    if (!session) {
      group.append(
        createNavigationLink('Вход', 'login.html', currentPage === 'login'),
        createNavigationLink('Регистрация', 'register.html', currentPage === 'register'),
      );
      navigation.replaceChildren(group);
      return;
    }

    const profileLink = createNavigationLink('Профил', 'profile.html', currentPage === 'profile');
    const logoutButton = document.createElement('button');
    logoutButton.className = 'nav-link auth-logout';
    logoutButton.type = 'button';
    logoutButton.textContent = 'Изход';
    logoutButton.addEventListener('click', async () => {
      logoutButton.disabled = true;
      const { error } = await supabase.auth.signOut();

      if (error) {
        logoutButton.disabled = false;
        window.alert('Изходът не можа да бъде извършен. Опитайте отново.');
        return;
      }

      window.dispatchEvent(new Event('salon-auth-signed-out'));
      window.location.assign('index.html');
    });

    group.append(profileLink, logoutButton);
    navigation.replaceChildren(group);
  }

  if (!isSupabaseConfigured) {
    render(null);
    return;
  }

  supabase.auth.getSession().then(({ data }) => render(data.session));
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => render(session), 0);
  });
}

export function createHeader({ currentPage = 'home' } = {}) {
  const isHomePage = currentPage === 'home';
  const isCatalogPage = currentPage === 'catalog';
  const header = document.createElement('header');
  header.className = 'site-header border-bottom';
  header.innerHTML = `
    <nav class="navbar navbar-expand-lg navbar-light py-3" aria-label="Основна навигация">
      <div class="container">
        <a class="navbar-brand fw-bold fs-4" href="/" aria-label="Salon Orders — начало">
          Salon <span>Orders</span>
        </a>
        <button
          class="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#mainNavigation"
          aria-controls="mainNavigation"
          aria-expanded="false"
          aria-label="Отвори навигацията"
        >
          <span class="navbar-toggler-icon"></span>
        </button>
        <div id="mainNavigation" class="collapse navbar-collapse">
          <ul class="navbar-nav ms-auto align-items-lg-center gap-lg-2">
            <li class="nav-item"><a class="nav-link active" aria-current="page" href="/">Начало</a></li>
            <li class="nav-item"><span class="nav-link text-body-secondary">Каталог</span></li>
            <li class="nav-item"><span class="nav-link text-body-secondary">За салона</span></li>
            <li class="nav-item" data-auth-navigation></li>
          </ul>
        </div>
      </div>
    </nav>
  `;

  const [homeLink, catalogPlaceholder] = header.querySelectorAll('.nav-item .nav-link');
  const brandLink = header.querySelector('.navbar-brand');
  const catalogLink = document.createElement('a');

  brandLink.href = 'index.html';
  homeLink.href = 'index.html';
  homeLink.textContent = 'Начало';
  homeLink.classList.toggle('active', isHomePage);
  homeLink.toggleAttribute('aria-current', isHomePage);

  catalogLink.className = `nav-link${isCatalogPage ? ' active' : ''}`;
  catalogLink.href = 'catalog.html';
  catalogLink.textContent = 'Каталог';
  catalogLink.toggleAttribute('aria-current', isCatalogPage);
  catalogPlaceholder.replaceWith(catalogLink);
  mountAccountNavigation(header, currentPage);

  return header;
}
