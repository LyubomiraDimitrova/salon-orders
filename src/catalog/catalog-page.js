import { loadPublicCatalog } from './catalog-data.js';

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

function createImage(productName, imagePath) {
  const placeholder = createElement('div', 'catalog-image-placeholder', 'Изображение');
  placeholder.setAttribute('aria-label', `Липсва изображение за ${productName}`);
  const safeImageUrl = getSafeImageUrl(imagePath);

  if (!safeImageUrl) {
    return placeholder;
  }

  const image = document.createElement('img');
  image.className = 'catalog-product-image';
  image.src = safeImageUrl;
  image.alt = productName;
  image.loading = 'lazy';
  image.addEventListener('error', () => image.replaceWith(placeholder), { once: true });
  return image;
}

function createProductCard(product, brandName, categoryName) {
  const column = createElement('div', 'col');
  const card = createElement('article', 'card catalog-product-card h-100 border-0');
  const media = createElement('div', 'catalog-product-media');
  const body = createElement('div', 'card-body d-flex flex-column p-4');
  const details = createElement('div', 'mt-auto');

  media.append(createImage(product.name, product.image_path));

  if (product.is_recommended) {
    body.append(createElement('span', 'badge catalog-recommended-badge align-self-start mb-3', 'Препоръчан'));
  }

  body.append(createElement('h2', 'h5 card-title mb-3', product.name));
  addDetail(details, 'Марка', brandName || 'Не е посочена');
  addDetail(details, 'Серия', product.series_name);
  addDetail(details, 'Категория', categoryName || 'Не е посочена');
  addDetail(details, 'Разфасовка', product.size_label);
  addDetail(details, 'Нюанс', [product.shade_number, product.shade_name].filter(Boolean).join(' '));
  addDetail(details, 'Концентрация', product.developer_concentration);
  body.append(details);
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
  const main = createElement('main', 'catalog-page py-5');
  const container = createElement('div', 'container');
  const heading = createElement('h1', 'display-5 fw-bold mb-3', 'Каталог');
  const introduction = createElement('p', 'lead text-body-secondary mb-4', 'Разгледайте професионални продукти, подбрани за вашата грижа.');
  const filters = createElement('form', 'catalog-filters row g-3 align-items-end mb-4');
  const searchInput = document.createElement('input');
  const brandSelect = document.createElement('select');
  const categorySelect = document.createElement('select');
  const clearButton = createElement('button', 'btn btn-outline-secondary w-100', 'Изчисти филтрите');
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
    ['col-12 col-lg-5', createLabel('Търсене', searchInput), searchInput],
    ['col-12 col-md-5 col-lg-3', createLabel('Марка', brandSelect), brandSelect],
    ['col-12 col-md-5 col-lg-3', createLabel('Категория', categorySelect), categorySelect],
    ['col-12 col-md-2 col-lg-1', createElement('span', 'visually-hidden', 'Филтри'), clearButton],
  ].forEach(([columnClass, label, control]) => {
    const field = createElement('div', columnClass);
    field.append(label, control);
    filters.append(field);
  });

  let catalog = null;
  let loading = false;

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
      grid.append(createProductCard(product, brandNames.get(String(product.brand_id)), categoryNames.get(String(product.category_id))));
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

  container.append(heading, introduction, filters, summary, content);
  main.append(container);
  loadCatalog();
  return main;
}
