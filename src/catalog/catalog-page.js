import { loadPublicCatalog } from './catalog-data.js';
import { getSession, loadOwnProfile, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { getApprovedAdminProfile } from '../services/admin-access.js';
import { isSupabaseConfigured } from '../services/supabase-client.js';
import { createAdminCatalogManagement } from '../admin-products/admin-products-page.js';
import { addProductToClientCart } from '../orders/client-order-store.js';
import { getCategoryIllustration } from './category-illustrations.js';

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
}

function createLabel(text, control) {
  const label = createElement('label', 'form-label fw-semibold', text);
  label.htmlFor = control.id;
  return label;
}

function addDetail(details, label, value) {
  if (!value) {
    return;
  }

  const row = createElement('p', 'catalog-detail mb-2');
  row.append(createElement('strong', null, `${label}: `), document.createTextNode(value));
  details.append(row);
}

function getSafeImageUrl(imagePath) {
  if (!imagePath) {
    return null;
  }

  try {
    const imageUrl = new URL(imagePath, window.location.origin);
    const isExternalImage = imageUrl.protocol === 'https:' || imageUrl.protocol === 'http:';
    const isSameOriginImage = imageUrl.origin === window.location.origin;

    return isExternalImage || isSameOriginImage ? imageUrl.href : null;
  } catch {
    return null;
  }
}

function createCategoryIllustration(categoryName) {
  const illustration = document.createElement('img');
  illustration.className = 'catalog-category-illustration';
  illustration.src = getCategoryIllustration(categoryName);
  illustration.alt = '';
  illustration.setAttribute('aria-hidden', 'true');
  return illustration;
}

function createImage(imagePath, categoryName) {
  const illustration = createCategoryIllustration(categoryName);
  const safeImageUrl = getSafeImageUrl(imagePath);

  if (!safeImageUrl) {
    return illustration;
  }

  const image = document.createElement('img');
  image.className = 'catalog-product-image';
  image.src = safeImageUrl;
  image.alt = '';
  image.loading = 'lazy';
  image.addEventListener('error', () => image.replaceWith(illustration), { once: true });
  return image;
}

function createProductCard(product, brandName, categoryName, onAddToCart) {
  const column = createElement('div', 'col');
  const card = createElement('article', 'card catalog-product-card border-0');
  const media = createElement('div', 'catalog-product-media');
  const body = createElement('div', 'card-body d-flex flex-column p-4');
  const details = createElement('div', 'catalog-details-content');
  const detailDisclosure = document.createElement('details');
  const detailsSummary = createElement('summary', 'catalog-details-summary', 'Детайли');

  media.append(createImage(product.image_path, categoryName));

  if (product.is_recommended) {
    media.append(createElement('span', 'badge catalog-recommended-badge', 'Препоръчан'));
  }

  body.append(createElement('h2', 'h5 card-title catalog-product-title mb-3', product.name));
  addDetail(details, 'Марка', brandName || 'Не е посочена');
  addDetail(details, 'Серия', product.series_name);
  addDetail(details, 'Категория', categoryName || 'Не е посочена');
  addDetail(details, 'Разфасовка', product.size_label);
  addDetail(details, 'Нюанс', [product.shade_number, product.shade_name].filter(Boolean).join(' '));
  addDetail(details, 'Концентрация', product.developer_concentration);
  detailDisclosure.append(detailsSummary, details);
  body.append(detailDisclosure);

  if (onAddToCart) {
    const addButton = createElement('button', 'btn btn-primary w-100 mt-3', 'Добави в кошницата');
    addButton.type = 'button';
    addButton.addEventListener('click', () => {
      onAddToCart(product);
      addButton.textContent = 'Добавено';
    });
    body.append(addButton);
  }

  card.append(media, body);
  column.append(card);
  return column;
}

function setSelectOptions(select, placeholder, records) {
  const options = [new Option(placeholder, '')];

  records
    .slice()
    .sort((first, second) => first.name.localeCompare(second.name, 'bg'))
    .forEach((record) => options.push(new Option(record.name, String(record.id))));

  select.replaceChildren(...options);
}

function matchesSearch(product, query) {
  if (!query) {
    return true;
  }

  const searchableText = [product.name, product.article_code]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('bg');

  return searchableText.includes(query);
}

export function createCatalogPage() {
  const visitorIntroduction = 'Разгледайте професионални продукти, подбрани за вашата грижа.';
  const adminIntroduction = 'Разгледай като админ';
  const main = createElement('main', 'catalog-page py-5');
  const container = createElement('div', 'container');
  const heading = createElement('h1', 'display-5 fw-bold mb-3', 'Каталог');
  const introduction = createElement('p', 'lead text-body-secondary mb-4', visitorIntroduction);
  const adminManagement = createElement('section', 'catalog-admin-management-slot');
  const filters = createElement('form', 'catalog-filters row g-3 align-items-end mb-4');
  const searchInput = document.createElement('input');
  const brandSelect = document.createElement('select');
  const categorySelect = document.createElement('select');
  const clearButton = createElement('button', 'btn btn-outline-primary catalog-clear-filters', 'Изчисти всичко');
  const summary = createElement('p', 'catalog-summary mb-4', '');
  const content = createElement('section', 'catalog-content');

  searchInput.id = 'catalog-search';
  searchInput.className = 'form-control';
  searchInput.type = 'search';
  searchInput.placeholder = 'Име или артикулен код';
  searchInput.autocomplete = 'off';
  brandSelect.id = 'catalog-brand';
  brandSelect.className = 'form-select';
  categorySelect.id = 'catalog-category';
  categorySelect.className = 'form-select';
  clearButton.type = 'button';
  clearButton.disabled = true;

  [
    ['col-12 col-lg-4', createLabel('Търсене', searchInput), searchInput],
    ['col-12 col-md-5 col-lg-3', createLabel('Марка', brandSelect), brandSelect],
    ['col-12 col-md-5 col-lg-3', createLabel('Категория', categorySelect), categorySelect],
    ['col-12 col-lg-auto', createElement('span', 'visually-hidden', 'Филтри'), clearButton],
  ].forEach(([columnClass, label, control]) => {
    const field = createElement('div', columnClass);
    field.append(label, control);
    filters.append(field);
  });

  let catalog = null;
  let loading = false;
  let adminCheckVersion = 0;
  let clientOrderingAccountId = null;

  let adminManagementPage = null;

  function setIntroduction(text) {
    introduction.textContent = text;
    introduction.hidden = false;
  }

  function showPublicCatalog() {
    setIntroduction(visitorIntroduction);
    adminManagement.replaceChildren();
    filters.hidden = false;
    summary.hidden = false;
    content.hidden = false;
  }

  function showCatalogModePending() {
    introduction.hidden = true;
    adminManagement.replaceChildren(createElement(
      'p',
      'catalog-mode-status text-body-secondary mb-4',
      'Проверка на достъпа до каталога…',
    ));
    filters.hidden = true;
    summary.hidden = true;
    content.hidden = true;
  }

  async function refreshCatalogMode(session) {
    const version = ++adminCheckVersion;
    introduction.hidden = true;

    if (!isSupabaseConfigured) {
      showPublicCatalog();
      return;
    }

    const sessionResult = session === undefined ? await getSession() : { session };
    if (version !== adminCheckVersion) {
      return;
    }
    const activeSession = sessionResult.session;
    if (!activeSession?.user) {
      clientOrderingAccountId = null;
      showPublicCatalog();
      renderProducts();
      return;
    }

    try {
      const adminProfile = await getApprovedAdminProfile(activeSession.user.id);
      if (version !== adminCheckVersion) {
        return;
      }
      if (!adminProfile) {
        showPublicCatalog();
        if (version === adminCheckVersion) {
          const { profile } = await loadOwnProfile(activeSession.user.id);
          clientOrderingAccountId = profile?.role === 'client'
            && profile.approval_status === 'approved'
            && profile.salon_client_id
            ? activeSession.user.id
            : null;
          renderProducts();
        }
        return;
      }

      clientOrderingAccountId = null;
      setIntroduction(adminIntroduction);
      filters.hidden = true;
      summary.hidden = true;
      content.hidden = true;
      adminManagementPage ||= createAdminCatalogManagement();
      const managementPage = await adminManagementPage;
      if (version === adminCheckVersion) {
        if (adminManagement.firstChild !== managementPage) {
          adminManagement.replaceChildren(managementPage);
        }
      }
    } catch {
      if (version === adminCheckVersion) {
        clientOrderingAccountId = null;
        showPublicCatalog();
        renderProducts();
      }
    }
  }

  function renderState(title, message, canRetry = false) {
    const state = createElement('div', 'catalog-state text-center py-5');
    state.append(createElement('h2', 'h4 mb-2', title), createElement('p', 'text-body-secondary mb-0', message));

    if (canRetry) {
      const retryButton = createElement('button', 'btn btn-primary mt-3', 'Опитайте отново');
      retryButton.type = 'button';
      retryButton.addEventListener('click', loadCatalog);
      state.append(retryButton);
    }

    content.replaceChildren(state);
  }

  function getFilteredProducts() {
    const query = searchInput.value.trim().toLocaleLowerCase('bg');

    return catalog.products
      .filter((product) => matchesSearch(product, query))
      .filter((product) => !brandSelect.value || String(product.brand_id) === brandSelect.value)
      .filter((product) => !categorySelect.value || String(product.category_id) === categorySelect.value)
      .sort((first, second) => {
        const recommendationDifference = Number(Boolean(second.is_recommended)) - Number(Boolean(first.is_recommended));
        return recommendationDifference || first.name.localeCompare(second.name, 'bg');
      });
  }

  function renderProducts() {
    if (!catalog || loading) {
      return;
    }

    const products = getFilteredProducts();
    const hasActiveFilters = Boolean(searchInput.value || brandSelect.value || categorySelect.value);
    clearButton.disabled = !hasActiveFilters;

    if (catalog.products.length === 0) {
      summary.textContent = '';
      renderState('Каталогът е празен', 'Продуктите ще бъдат добавени скоро.');
      return;
    }

    if (products.length === 0) {
      summary.textContent = '';
      renderState('Няма намерени продукти', 'Променете търсенето или изчистете филтрите.');
      return;
    }

    const brandNames = new Map(catalog.brands.map((brand) => [String(brand.id), brand.name]));
    const categoryNames = new Map(catalog.categories.map((category) => [String(category.id), category.name]));
    const grid = createElement('div', 'row row-cols-1 row-cols-sm-2 row-cols-lg-3 g-4');

    products.forEach((product) => {
      grid.append(createProductCard(
        product,
        brandNames.get(String(product.brand_id)),
        categoryNames.get(String(product.category_id)),
        clientOrderingAccountId
          ? (selectedProduct) => addProductToClientCart(clientOrderingAccountId, {
            ...selectedProduct,
            brandName: brandNames.get(String(selectedProduct.brand_id)),
          })
          : null,
      ));
    });

    summary.textContent = `Открити продукти: ${products.length}`;
    content.replaceChildren(grid);
  }

  async function loadCatalog() {
    loading = true;
    filters.querySelectorAll('input, select, button').forEach((control) => {
      control.disabled = true;
    });
    summary.textContent = '';
    renderState('Зареждане на каталога', 'Моля, изчакайте.');

    try {
      catalog = await loadPublicCatalog();
      setSelectOptions(brandSelect, 'Всички марки', catalog.brands);
      setSelectOptions(categorySelect, 'Всички категории', catalog.categories);
    } catch {
      summary.textContent = '';
      renderState('Каталогът не може да бъде зареден', 'Проверете връзката си и опитайте отново.', true);
    } finally {
      loading = false;
      filters.querySelectorAll('input, select, button').forEach((control) => {
        control.disabled = false;
      });
      clearButton.disabled = !searchInput.value && !brandSelect.value && !categorySelect.value;
    }

    renderProducts();
  }

  filters.addEventListener('submit', (event) => event.preventDefault());
  [searchInput, brandSelect, categorySelect].forEach((control) => {
    control.addEventListener(control === searchInput ? 'input' : 'change', renderProducts);
  });
  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    brandSelect.value = '';
    categorySelect.value = '';
    renderProducts();
  });

  container.append(heading, introduction, adminManagement, filters, summary, content);
  main.append(container);
  showCatalogModePending();
  void refreshCatalogMode();
  subscribeToSessionChanges((_event, session) => {
    void refreshCatalogMode(session);
  });
  window.addEventListener('focus', () => {
    void refreshCatalogMode();
  });
  loadCatalog();
  return main;
}
