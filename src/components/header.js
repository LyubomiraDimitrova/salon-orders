import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';
import { loadOwnProfile } from '../auth/auth-helpers.js';
import { clearClientOrderStorage, getCartItemCount } from '../orders/client-order-store.js';

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
  let activeAccountId = null;

  async function render(session) {
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
        window.alert('Изходът не може да бъде извършен. Опитайте отново.');
        return;
      }

      clearClientOrderStorage(session.user.id);
      window.dispatchEvent(new Event('salon-auth-signed-out'));
      window.location.assign('index.html');
    });

    group.append(profileLink, logoutButton);
    navigation.replaceChildren(group);

    try {
      const { profile } = await loadOwnProfile(session.user.id);
      if (!profile || activeAccountId !== session.user.id) {
        return;
      }

      if (profile.role === 'admin' && profile.approval_status === 'approved') {
        group.prepend(createNavigationLink('Отчети', 'reports.html', currentPage === 'reports'));
        group.prepend(createNavigationLink('Поръчки', 'admin-orders.html', currentPage === 'admin-orders'));
        group.prepend(createNavigationLink('Наличности', 'inventory.html', currentPage === 'inventory'));
        group.prepend(createNavigationLink('Клиенти', 'admin.html', currentPage === 'admin'));
        return;
      }

      if (profile.role === 'client' && profile.approval_status === 'approved' && profile.salon_client_id) {
        const cartLink = createNavigationLink('Кошница', 'cart.html', currentPage === 'cart');
        const updateCartLabel = () => {
          cartLink.textContent = `Кошница (${getCartItemCount(session.user.id)})`;
        };
        const ordersLink = createNavigationLink('Моите поръчки', 'orders.html', currentPage === 'orders');
        updateCartLabel();
        group.insertBefore(cartLink, profileLink);
        group.insertBefore(ordersLink, profileLink);
        window.addEventListener('salon-cart-updated', (event) => {
          if (event.detail?.accountId === session.user.id) {
            updateCartLabel();
          }
        });
      }
    } catch {
      // Protected pages remain the source of truth if the profile check cannot complete.
    }
  }

  if (!isSupabaseConfigured) {
    void render(null);
    return;
  }

  supabase.auth.getSession().then(({ data }) => {
    activeAccountId = data.session?.user.id || null;
    void render(data.session);
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      activeAccountId = session?.user.id || null;
      void render(session);
    }, 0);
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
        <a class="navbar-brand fw-bold fs-4" href="index.html" aria-label="Salon Orders — начало">
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
            <li class="nav-item"><a class="nav-link${isHomePage ? ' active' : ''}"${isHomePage ? ' aria-current="page"' : ''} href="index.html">Начало</a></li>
            <li class="nav-item"><a class="nav-link${isCatalogPage ? ' active' : ''}"${isCatalogPage ? ' aria-current="page"' : ''} href="catalog.html">Каталог</a></li>
            <li class="nav-item" data-auth-navigation></li>
          </ul>
        </div>
      </div>
    </nav>
  `;
  mountAccountNavigation(header, currentPage);
  return header;
}
