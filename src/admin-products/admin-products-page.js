import { createAlert, getSession, subscribeToSessionChanges } from '../auth/auth-helpers.js';
import { Modal } from 'bootstrap';
import { getApprovedAdminProfile } from '../services/admin-access.js';
import { isSupabaseConfigured, supabase } from '../services/supabase-client.js';
import { createAdminPriceListsSection } from './price-lists-section.js';

const productFields = 'id, brand_id, category_id, article_code, series_name, name, description, size_label, shade_number, shade_name, shade_color, developer_concentration, image_path, is_hidden, is_recommended, updated_at';
const priceFormatter = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' });

function el(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function optional(value) {
  return value.trim() || null;
}

function messageOf(error, fallback) {
  return error?.message?.trim() || fallback;
}

function finitePositive(value) {
  if (!value.trim()) return null;
  const price = Number(value.replace(',', '.'));
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

function formatPrice(value) {
  return Number.isFinite(Number(value)) ? priceFormatter.format(Number(value)) : '—';
}

function setBusy(form, button, isBusy, busyLabel) {
  form.querySelectorAll('input, select, textarea, button').forEach((control) => {
    control.disabled = isBusy;
  });
  button.dataset.label ||= button.textContent;
  button.textContent = isBusy ? busyLabel : button.dataset.label;
}

function byName(records) {
  return records.slice().sort((a, b) => a.name.localeCompare(b.name, 'bg'));
}

export async function createAdminCatalogManagement() {
  const main = el('section', 'admin-products-page catalog-admin-management');
  const content = main;
  let priceListsSection = null;
  const state = {
    autosaveTimer: null,
    categories: [],
    draftContext: 0,
    isNewDraft: false,
    prices: new Map(),
    deletingProductId: null,
    productDirty: false,
    products: [],
    saveFailed: false,
    saveQueue: Promise.resolve(),
    activeAdminUserId: null,
    version: 0,
    brands: [],
  };

  function confirmDiscardProductChanges() {
    return !state.productDirty || window.confirm('Имате незапазени промени по продукта. Да ги отхвърлите ли?');
  }

  window.addEventListener('beforeunload', (event) => {
    if (!state.productDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link || !state.productDirty || link.target === '_blank') return;
    if (!confirmDiscardProductChanges()) event.preventDefault();
  }, true);

  function clearProtected(message, type = 'warning') {
    priceListsSection?.clear();
    priceListsSection = null;
    state.activeAdminUserId = null;
    state.version += 1;
    state.draftContext += 1;
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
    state.isNewDraft = false;
    state.products = [];
    state.brands = [];
    state.categories = [];
    state.prices.clear();
    content.replaceChildren(createAlert(type, message));
  }

  function shell() {
    const root = el('section', 'admin-products-shell');
    root.innerHTML = `
      <div class="admin-products-feedback mt-3" aria-live="polite"></div>
      <section class="admin-products-meta mt-3" aria-label="Марки и категории">
        <details>
          <summary>Марки и категории</summary>
          <div class="row g-3 pt-3">
            <div class="col-12 col-lg-6">
              <form class="catalog-meta-form" data-brand-form>
                <input name="id" type="hidden" />
                <div class="d-flex justify-content-between gap-2 mb-3"><h2 class="h5 mb-0" data-brand-title>Нова марка</h2><button class="btn btn-sm btn-link" type="button" data-new-brand>Нова</button></div>
                <label class="form-label fw-semibold" for="brand-name">Име на марката</label>
                <input class="form-control" id="brand-name" name="name" maxlength="160" required />
                <div class="row g-3 mt-0"><div class="col-6"><label class="form-label fw-semibold" for="brand-order">Ред на показване</label><input class="form-control" id="brand-order" name="order" type="number" min="0" step="1" value="0" required /><div class="form-text">По-малкото число се показва по-напред.</div></div><div class="col-6 d-flex align-items-end"><div class="form-check mb-2"><input class="form-check-input" id="brand-hidden" name="hidden" type="checkbox" /><label class="form-check-label" for="brand-hidden">Скрита марка</label></div></div></div>
                <button class="btn btn-primary w-100 mt-3" type="submit">Запази марката</button>
              </form>
              <div class="catalog-meta-list mt-3" data-brand-list></div>
            </div>
            <div class="col-12 col-lg-6">
              <form class="catalog-meta-form" data-category-form>
                <input name="id" type="hidden" />
                <div class="d-flex justify-content-between gap-2 mb-3"><h2 class="h5 mb-0" data-category-title>Нова категория</h2><button class="btn btn-sm btn-link" type="button" data-new-category>Нова</button></div>
                <label class="form-label fw-semibold" for="category-name">Име на категорията</label>
                <input class="form-control" id="category-name" name="name" maxlength="160" required />
                <div class="row g-3 mt-0"><div class="col-7"><label class="form-label fw-semibold" for="category-group">Група</label><select class="form-select" id="category-group" name="group"><option value="dye">Бои</option><option value="developer">Оксиданти</option><option value="hair_care">Грижа за коса</option><option value="technical">Технически</option></select></div><div class="col-5"><label class="form-label fw-semibold" for="category-order">Ред на показване</label><input class="form-control" id="category-order" name="order" type="number" min="0" step="1" value="0" required /><div class="form-text">По-малкото число се показва по-напред.</div></div></div>
                <button class="btn btn-primary w-100 mt-3" type="submit">Запази категорията</button>
              </form>
              <div class="catalog-meta-list mt-3" data-category-list></div>
            </div>
          </div>
        </details>
      </section>
      <div class="row g-4 mt-1 align-items-start">
        <section class="col-12 col-xl-5" aria-labelledby="list-title"><div class="admin-products-panel"><div class="d-flex justify-content-between gap-3 mb-3"><div><h2 id="list-title" class="h4 mb-1">Продукти</h2><p class="text-body-secondary mb-0" data-product-count></p></div><button class="btn btn-primary" type="button" data-new-product>Нов продукт</button></div><div class="row g-3"><div class="col-12"><label class="form-label fw-semibold" for="product-search">Търсене</label><input class="form-control" id="product-search" type="search" placeholder="Име, код, серия, марка" autocomplete="off" /></div><div class="col-12"><label class="form-label fw-semibold" for="product-visibility">Видимост</label><select class="form-select" id="product-visibility"><option value="all" selected>Всички</option><option value="published">Публикувани</option><option value="hidden">Скрити</option></select></div></div><div class="admin-product-list mt-3" data-product-list></div></div></section>
        <section class="col-12 col-xl-7" aria-labelledby="editor-title"><form class="admin-products-panel product-editor" data-product-form novalidate>
          <input name="id" type="hidden" />
          <div class="d-flex justify-content-between gap-3 mb-3"><div><p class="eyebrow mb-1" data-editor-mode>НОВА ЧЕРНОВА</p><h2 id="editor-title" class="h4 mb-0">Нов продукт</h2></div><button class="btn btn-sm btn-outline-primary" type="button" data-reset-product>Изчисти</button></div>
          <div data-product-message aria-live="polite"></div>
          <div class="row g-3">
            <div class="col-12"><label class="form-label fw-semibold" for="product-name">Име <span aria-hidden="true">*</span></label><input class="form-control" id="product-name" name="name" maxlength="220" required /></div>
            <div class="col-12 col-md-6"><label class="form-label fw-semibold" for="product-brand">Марка</label><select class="form-select" id="product-brand" name="brand"></select></div>
            <div class="col-12 col-md-6"><label class="form-label fw-semibold" for="product-category">Категория</label><select class="form-select" id="product-category" name="category"></select></div>
            <div class="col-12 col-md-6"><label class="form-label fw-semibold" for="product-code">Артикулен код</label><input class="form-control" id="product-code" name="code" maxlength="120" /></div>
            <div class="col-12 col-md-6"><label class="form-label fw-semibold" for="product-series">Серия</label><input class="form-control" id="product-series" name="series" maxlength="160" /></div>
            <div class="col-12"><label class="form-label fw-semibold" for="product-description">Описание</label><textarea class="form-control" id="product-description" name="description" rows="3" maxlength="2000"></textarea></div>
            <div class="col-12 col-md-6"><label class="form-label fw-semibold" for="product-size">Разфасовка / размер</label><input class="form-control" id="product-size" name="size" maxlength="120" /></div>
            <div class="col-12 col-md-6"><label class="form-label fw-semibold" for="product-developer">Концентрация</label><input class="form-control" id="product-developer" name="developer" maxlength="120" placeholder="напр. 20 VOL" /></div>
            <div class="col-12 col-md-4"><label class="form-label fw-semibold" for="product-shade-number">Номер на нюанс</label><input class="form-control" id="product-shade-number" name="shadeNumber" maxlength="80" /></div>
            <div class="col-12 col-md-4"><label class="form-label fw-semibold" for="product-shade-name">Име на нюанс</label><input class="form-control" id="product-shade-name" name="shadeName" maxlength="120" /></div>
            <div class="col-12 col-md-4"><label class="form-label fw-semibold" for="product-shade-color">Цвят / код</label><input class="form-control" id="product-shade-color" name="shadeColor" maxlength="80" /></div>
            <div class="col-12"><label class="form-label fw-semibold" for="product-image">Адрес на изображение <span class="text-body-secondary fw-normal">(по желание)</span></label><input class="form-control" id="product-image" name="image" type="url" maxlength="1000" placeholder="https://…" /><div class="form-text">Качването на изображения не е част от този екран.</div></div>
          </div>
          <fieldset class="product-price-box mt-4"><legend class="h5 mb-1">Цена</legend><p class="text-body-secondary small mb-3">Цените са видими само за одобрени администратори. Въведете крайна цена с ДДС в EUR.</p><div class="row g-3"><div class="col-12 col-md-4"><label class="form-label fw-semibold" for="retail-price">Крайна цена (EUR)</label><input class="form-control" id="retail-price" name="retail" inputmode="decimal" placeholder="напр. 12,50" /></div><div class="col-6 col-md-4"><label class="form-label fw-semibold" for="salon-price">Салонна цена</label><input class="form-control" id="salon-price" name="salon" readonly value="—" /></div><div class="col-6 col-md-4"><label class="form-label fw-semibold" for="reference-price">Референтна цена</label><input class="form-control" id="reference-price" name="reference" readonly value="—" /></div></div></fieldset>
          <div class="d-flex flex-wrap gap-3 mt-4"><div data-draft-visibility-status class="form-text fw-semibold">Скрит продукт — не се показва в каталога.</div><div data-hidden-product-control><div class="form-check"><input class="form-check-input" id="hidden-product" name="hidden" type="checkbox" /><label class="form-check-label" for="hidden-product">Скрит продукт</label></div><div class="form-text ms-4">Не се показва в публичния каталог.</div></div><div class="form-check"><input class="form-check-input" id="recommended-product" name="recommended" type="checkbox" /><label class="form-check-label" for="recommended-product">Препоръчан</label></div></div>
          <p class="form-text mt-2 mb-0">За публикуване са нужни марка, категория, разфасовка и валидна крайна цена.</p><div class="d-grid gap-2 mt-4"><button class="btn btn-primary" type="submit">Запази промените</button><button class="btn btn-outline-primary" type="button" data-save-draft>Запази чернова</button><button class="btn btn-outline-success" type="button" data-publish-product>Публикувай</button><button class="btn btn-outline-danger" type="button" data-delete-product hidden>Изтрий продукта</button></div>
        </form></section>
      </div>`;

    const deleteConfirmationModal = document.createElement('div');
    deleteConfirmationModal.className = 'modal fade';
    deleteConfirmationModal.id = 'delete-product-confirmation';
    deleteConfirmationModal.tabIndex = -1;
    deleteConfirmationModal.setAttribute('aria-labelledby', 'delete-product-confirmation-title');
    deleteConfirmationModal.setAttribute('aria-describedby', 'delete-product-confirmation-description');
    deleteConfirmationModal.setAttribute('aria-hidden', 'true');
    deleteConfirmationModal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title fs-5" id="delete-product-confirmation-title">Изтриване на продукт</h2>
            <button class="btn-close" type="button" data-bs-dismiss="modal" data-delete-cancel aria-label="Затвори"></button>
          </div>
          <div class="modal-body" id="delete-product-confirmation-description">
            <p class="mb-2">Наистина ли искате да изтриете <strong data-delete-product-name></strong>?</p>
            <p class="mb-0 text-danger-emphasis">Изтриването е окончателно и не може да бъде отменено.</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" data-bs-dismiss="modal" data-delete-cancel>Отказ</button>
            <button class="btn btn-danger" type="button" data-confirm-delete-product>Изтрий</button>
          </div>
        </div>
      </div>`;
    root.append(deleteConfirmationModal);
    return root;
  }

  function renderWorkspace(initialMessage, initialType = 'success') {
    priceListsSection?.clear();
    priceListsSection = null;
    const root = shell();
    content.replaceChildren(root);
    const feedback = root.querySelector('.admin-products-feedback');
    const list = root.querySelector('[data-product-list]');
    const count = root.querySelector('[data-product-count]');
    const search = root.querySelector('#product-search');
    const visibility = root.querySelector('#product-visibility');
    const productForm = root.querySelector('[data-product-form]');
    const formMessage = root.querySelector('[data-product-message]');
    const brandForm = root.querySelector('[data-brand-form]');
    const categoryForm = root.querySelector('[data-category-form]');
    const deleteModalElement = root.querySelector('#delete-product-confirmation');
    const deleteModal = Modal.getOrCreateInstance(deleteModalElement, { backdrop: 'static', focus: true, keyboard: false });
    const deleteModalProductName = deleteModalElement.querySelector('[data-delete-product-name]');
    const deleteModalCancelButtons = deleteModalElement.querySelectorAll('[data-delete-cancel]');
    const cancelDeleteButton = deleteModalElement.querySelector('.modal-footer [data-delete-cancel]');
    const confirmDeleteButton = deleteModalElement.querySelector('[data-confirm-delete-product]');
    let productPendingDeletion = null;
    let productEditRevision = 0;
    let savedProductFormState = '';

    function setDeleteConfirmationBusy(isBusy) {
      confirmDeleteButton.disabled = isBusy;
      deleteModalCancelButtons.forEach((button) => { button.disabled = isBusy; });
      confirmDeleteButton.textContent = isBusy ? 'Изтриване…' : 'Изтрий';
    }

    deleteModalElement.addEventListener('shown.bs.modal', () => {
      if (!state.deletingProductId) cancelDeleteButton.focus();
    });
    deleteModalElement.addEventListener('hidden.bs.modal', () => {
      if (!state.deletingProductId) productPendingDeletion = null;
    });

    const listSection = list.closest('section');
    const listPanel = list.parentElement;
    const editorSection = productForm.closest('section');
    const filterRow = search.closest('.row');
    const brandFilter = document.createElement('select');
    const categoryFilter = document.createElement('select');
    const recommendedFilter = document.createElement('input');
    const clearFiltersButton = el('button', 'btn btn-outline-primary w-100', 'Изчисти филтрите');

    function createListFilter(id, label, control) {
      const field = el('div', 'col-12 col-md-6 col-xl-2');
      const fieldLabel = el('label', 'form-label fw-semibold', label);
      fieldLabel.htmlFor = id;
      control.id = id;
      control.className = 'form-select';
      field.append(fieldLabel, control);
      return field;
    }

    function createRecommendedFilter() {
      const field = el('div', 'col-12 col-md-6 col-xl-2 d-flex align-items-end');
      const wrapper = el('div', 'form-check mb-2');
      const label = el('label', 'form-check-label fw-semibold', 'Само препоръчани');
      recommendedFilter.className = 'form-check-input';
      recommendedFilter.id = 'product-recommended-filter';
      recommendedFilter.type = 'checkbox';
      label.htmlFor = recommendedFilter.id;
      wrapper.append(recommendedFilter, label);
      field.append(wrapper);
      return field;
    }

    search.closest('.col-12').className = 'col-12 col-lg-6 col-xl-3';
    visibility.closest('.col-12').className = 'col-12 col-md-4 col-xl-2';
    const clearFiltersField = el('div', 'col-12 col-xl-1 d-flex align-items-end');
    clearFiltersButton.type = 'button';
    clearFiltersField.append(clearFiltersButton);
    filterRow.append(
      createListFilter('product-brand-filter', 'Марка', brandFilter),
      createListFilter('product-category-filter', 'Категория', categoryFilter),
      createRecommendedFilter(),
      clearFiltersField,
    );
    listSection.className = 'col-12';
    editorSection.className = 'mt-4';
    listPanel.insertBefore(editorSection, list);
    editorSection.hidden = true;

    const editorActions = productForm.querySelector(':scope > .d-flex');
    const closeEditorButton = el('button', 'btn btn-sm btn-outline-secondary', 'Затвори');
    closeEditorButton.type = 'button';
    editorActions.append(closeEditorButton);

    function showEditor() {
      editorSection.hidden = false;
      productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function closeEditor() {
      if (!confirmDiscardProductChanges()) return;
      state.draftContext += 1;
      window.clearTimeout(state.autosaveTimer);
      state.autosaveTimer = null;
      editorSection.hidden = true;
    }

    const announce = (text, type = 'success') => feedback.replaceChildren(createAlert(type, text));
    if (initialMessage) announce(initialMessage, initialType);

    function productFormState() {
      return Array.from(productForm.querySelectorAll('input:not([readonly]), select, textarea'))
        .map((control) => `${control.name}:${control.type === 'checkbox' ? control.checked : control.value}`)
        .join('|');
    }

    function markProductClean(keepUnsavedState = false) {
      savedProductFormState = productFormState();
      if (!keepUnsavedState) state.saveFailed = false;
      state.productDirty = keepUnsavedState || state.saveFailed;
    }

    function updateProductDirtyState() {
      state.productDirty = state.saveFailed || productFormState() !== savedProductFormState;
    }

    function fillProductSelects() {
      const brandValue = productForm.elements.brand.value;
      const categoryValue = productForm.elements.category.value;
      productForm.elements.brand.replaceChildren(new Option('Изберете марка', ''), ...byName(state.brands).map((brand) => new Option(`${brand.name}${brand.is_hidden ? ' (скрита)' : ''}`, brand.id)));
      productForm.elements.category.replaceChildren(new Option('Изберете категория', ''), ...byName(state.categories).map((category) => new Option(category.name, category.id)));
      productForm.elements.brand.value = brandValue;
      productForm.elements.category.value = categoryValue;
      const selectedBrand = brandFilter.value;
      const selectedCategory = categoryFilter.value;
      brandFilter.replaceChildren(new Option('Всички марки', ''), ...byName(state.brands).map((brand) => new Option(brand.name, brand.id)));
      categoryFilter.replaceChildren(new Option('Всички категории', ''), ...byName(state.categories).map((category) => new Option(category.name, category.id)));
      brandFilter.value = selectedBrand;
      categoryFilter.value = selectedCategory;
    }

    function setPrice(price) {
      productForm.elements.retail.value = price?.retail_price ?? '';
      productForm.elements.salon.value = formatPrice(price?.salon_sale_price);
      productForm.elements.reference.value = formatPrice(price?.reference_purchase_price);
    }

    function renderVisibilityControl(isHidden) {
      root.querySelector('[data-draft-visibility-status]').hidden = !isHidden;
      root.querySelector('[data-hidden-product-control]').hidden = isHidden;
      if (!isHidden) {
        productForm.elements.hidden.checked = false;
      }
    }

    function syncSavedProductState(product) {
      productForm.elements.id.value = product.id;
      renderVisibilityControl(product.is_hidden);
      root.querySelector('[data-editor-mode]').textContent = product.is_hidden ? 'СКРИТА ЧЕРНОВА' : 'ПУБЛИКУВАН ПРОДУКТ';
      root.querySelector('#editor-title').textContent = `Редакция: ${product.name}`;
      const publishButton = root.querySelector('[data-publish-product]');
      publishButton.disabled = !product.is_hidden;
      publishButton.textContent = product.is_hidden ? 'Публикувай' : 'Публикуван';
      root.querySelector('[data-delete-product]').hidden = false;
    }

    function resetProduct() {
      state.draftContext += 1;
      window.clearTimeout(state.autosaveTimer);
      state.autosaveTimer = null;
      state.isNewDraft = true;
      state.saveFailed = false;
      productForm.reset();
      productForm.elements.id.value = '';
      renderVisibilityControl(true);
      root.querySelector('[data-editor-mode]').textContent = 'НОВА ЧЕРНОВА';
      root.querySelector('#editor-title').textContent = 'Нов продукт';
      const publishButton = root.querySelector('[data-publish-product]');
      publishButton.disabled = false;
      publishButton.textContent = 'Публикувай';
      root.querySelector('[data-delete-product]').hidden = true;
      formMessage.replaceChildren();
      fillProductSelects();
      setPrice(null);
      markProductClean();
    }

    function editProduct(id, allowDiscard = false) {
      if (!allowDiscard && !confirmDiscardProductChanges()) return;
      state.draftContext += 1;
      window.clearTimeout(state.autosaveTimer);
      state.autosaveTimer = null;
      state.isNewDraft = false;
      state.saveFailed = false;
      const product = state.products.find((item) => String(item.id) === String(id));
      if (!product) return;
      productForm.elements.id.value = product.id;
      productForm.elements.name.value = product.name || '';
      productForm.elements.brand.value = product.brand_id || '';
      productForm.elements.category.value = product.category_id || '';
      productForm.elements.code.value = product.article_code || '';
      productForm.elements.series.value = product.series_name || '';
      productForm.elements.description.value = product.description || '';
      productForm.elements.size.value = product.size_label || '';
      productForm.elements.developer.value = product.developer_concentration || '';
      productForm.elements.shadeNumber.value = product.shade_number || '';
      productForm.elements.shadeName.value = product.shade_name || '';
      productForm.elements.shadeColor.value = product.shade_color || '';
      productForm.elements.image.value = product.image_path || '';
      productForm.elements.hidden.checked = product.is_hidden;
      productForm.elements.recommended.checked = product.is_recommended;
      syncSavedProductState(product);
      fillProductSelects();
      productForm.elements.brand.value = product.brand_id || '';
      productForm.elements.category.value = product.category_id || '';
      setPrice(state.prices.get(String(product.id)));
      formMessage.replaceChildren();
      markProductClean();
      showEditor();
    }

    function renderList() {
      const brandNames = new Map(state.brands.map((brand) => [String(brand.id), brand.name]));
      const categoryNames = new Map(state.categories.map((category) => [String(category.id), category.name]));
      const query = search.value.trim().toLocaleLowerCase('bg');
      const records = state.products
        .filter((product) => visibility.value === 'all'
          || (visibility.value === 'published' && !product.is_hidden)
          || (visibility.value === 'hidden' && product.is_hidden))
        .filter((product) => !brandFilter.value || String(product.brand_id) === brandFilter.value)
        .filter((product) => !categoryFilter.value || String(product.category_id) === categoryFilter.value)
        .filter((product) => !recommendedFilter.checked || product.is_recommended)
        .filter((product) => !query || [product.name, product.article_code, product.series_name, brandNames.get(String(product.brand_id)), categoryNames.get(String(product.category_id))].filter(Boolean).join(' ').toLocaleLowerCase('bg').includes(query))
        .sort((a, b) => a.name.localeCompare(b.name, 'bg'));
      clearFiltersButton.disabled = !search.value
        && visibility.value === 'all'
        && !brandFilter.value
        && !categoryFilter.value
        && !recommendedFilter.checked;
      count.textContent = `${records.length} от ${state.products.length} продукта`;
      list.replaceChildren();
      if (!records.length) {
        list.append(createAlert('info', 'Няма продукти, които отговарят на търсенето.'));
        return;
      }
      records.forEach((product) => {
        const card = el('article', 'admin-product-card');
        const header = el('div', 'd-flex align-items-start justify-content-between gap-2');
        const button = el('button', 'btn btn-sm btn-outline-primary flex-shrink-0', 'Отвори');
        button.type = 'button';
        button.addEventListener('click', () => editProduct(product.id));
        header.append(el('h3', 'h6 mb-1', product.name), button);
        card.append(header, el('p', 'small text-body-secondary mb-2', [brandNames.get(String(product.brand_id)), categoryNames.get(String(product.category_id)), product.size_label].filter(Boolean).join(' · ') || 'Непълна чернова'));
        const badges = el('div', 'd-flex flex-wrap gap-2');
        badges.append(el('span', `badge text-bg-${product.is_hidden ? 'secondary' : 'success'}`, product.is_hidden ? 'Скрита чернова' : 'Публикуван'));
        if (product.is_recommended) badges.append(el('span', 'badge admin-recommended-badge', 'Препоръчан'));
        card.append(badges);
        list.append(card);
      });
    }

    function resetMeta(form, title, text) {
      form.reset();
      form.elements.id.value = '';
      form.elements.order.value = '0';
      root.querySelector(title).textContent = text;
    }

    function renderMetaList(records, target, details, edit) {
      target.replaceChildren();
      if (!records.length) {
        target.append(el('p', 'small text-body-secondary mb-0', 'Все още няма записи.'));
        return;
      }
      byName(records).forEach((record) => {
        const item = el('div', 'catalog-meta-item');
        const description = el('div');
        description.append(el('strong', 'd-block', record.name), el('span', 'small text-body-secondary', details(record)));
        const button = el('button', 'btn btn-sm btn-outline-primary', 'Редакция');
        button.type = 'button';
        button.addEventListener('click', () => edit(record));
        item.append(description, button);
        target.append(item);
      });
    }

    function renderMeta() {
      renderMetaList(state.brands, root.querySelector('[data-brand-list]'), (brand) => `${brand.is_hidden ? 'Скрита' : 'Видима'} · подредба ${brand.sort_order}`, (brand) => {
        brandForm.elements.id.value = brand.id;
        brandForm.elements.name.value = brand.name;
        brandForm.elements.order.value = brand.sort_order;
        brandForm.elements.hidden.checked = brand.is_hidden;
        root.querySelector('[data-brand-title]').textContent = `Редакция: ${brand.name}`;
        brandForm.closest('details').open = true;
      });
      renderMetaList(state.categories, root.querySelector('[data-category-list]'), (category) => `${category.product_group} · подредба ${category.sort_order}`, (category) => {
        categoryForm.elements.id.value = category.id;
        categoryForm.elements.name.value = category.name;
        categoryForm.elements.group.value = category.product_group;
        categoryForm.elements.order.value = category.sort_order;
        root.querySelector('[data-category-title]').textContent = `Редакция: ${category.name}`;
        categoryForm.closest('details').open = true;
      });
    }

    async function saveMeta(event, table, label, buildPayload, store, reset) {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('[type="submit"]');
      const name = form.elements.name.value.trim();
      const sortOrder = Number(form.elements.order.value);
      if (!name || !Number.isInteger(sortOrder) || sortOrder < 0) {
        announce(`Въведете име и неотрицателна цяла подредба за ${label.toLowerCase()}.`, 'danger');
        return;
      }
      setBusy(form, button, true, 'Запазване…');
      try {
        const id = form.elements.id.value;
        const query = id ? supabase.from(table).update(buildPayload(name, sortOrder)).eq('id', id) : supabase.from(table).insert(buildPayload(name, sortOrder));
        const { data, error } = await query.select().single();
        if (error) throw error;
        const index = store.findIndex((record) => String(record.id) === String(data.id));
        if (index >= 0) store[index] = data;
        else store.push(data);
        reset();
        renderMeta();
        fillProductSelects();
        announce(`${label} е запазен${label === 'Категорията' ? 'а' : ''}.`);
      } catch (error) {
        announce(messageOf(error, `${label} не можа да бъде запазен.`), 'danger');
      } finally {
        setBusy(form, button, false, 'Запазване…');
      }
    }

    brandForm.addEventListener('submit', (event) => saveMeta(event, 'brands', 'Марката', (name, sortOrder) => ({ name, sort_order: sortOrder, is_hidden: brandForm.elements.hidden.checked }), state.brands, () => resetMeta(brandForm, '[data-brand-title]', 'Нова марка')));
    categoryForm.addEventListener('submit', (event) => saveMeta(event, 'product_categories', 'Категорията', (name, sortOrder) => ({ name, product_group: categoryForm.elements.group.value, sort_order: sortOrder }), state.categories, () => resetMeta(categoryForm, '[data-category-title]', 'Нова категория')));

    function publishingProblem(product, price) {
      if (!product.brand_id || !product.category_id) return 'За публикуване изберете марка и категория.';
      if (!product.size_label || product.size_label.trim().length < 2) return 'За публикуване въведете смислена разфасовка или размер.';
      if (!price || Number(price.retail_price) <= 0) return 'За публикуване запазете валидна крайна цена.';
      return null;
    }

    async function saveProduct(event, draftOnly = false) {
      event?.preventDefault();
      const button = productForm.querySelector('[type="submit"]');
      const name = productForm.elements.name.value.trim();
      if (!name) {
        formMessage.replaceChildren(createAlert('danger', 'Името е задължително и за скрита чернова.'));
        return;
      }
      const priceValue = draftOnly ? null : finitePositive(productForm.elements.retail.value);
      const hasPrice = !draftOnly && Boolean(productForm.elements.retail.value.trim());
      if (priceValue === undefined) {
        formMessage.replaceChildren(createAlert('danger', 'Крайната цена трябва да е крайно положително число.'));
        return;
      }
      const wantsPublish = !draftOnly && !productForm.elements.hidden.checked;
      const metadata = {
        name,
        brand_id: productForm.elements.brand.value || null,
        category_id: productForm.elements.category.value || null,
        article_code: optional(productForm.elements.code.value),
        series_name: optional(productForm.elements.series.value),
        description: productForm.elements.description.value.trim(),
        size_label: optional(productForm.elements.size.value),
        shade_number: optional(productForm.elements.shadeNumber.value),
        shade_name: optional(productForm.elements.shadeName.value),
        shade_color: optional(productForm.elements.shadeColor.value),
        developer_concentration: optional(productForm.elements.developer.value),
        image_path: optional(productForm.elements.image.value),
        is_recommended: productForm.elements.recommended.checked,
        is_hidden: true,
      };
      setBusy(productForm, button, true, 'Запазване…');
      formMessage.replaceChildren(createAlert('info', 'Запазване на данните като скрита чернова…'));
      let product;
      try {
        const id = productForm.elements.id.value;
        const query = id ? supabase.from('products').update(metadata).eq('id', id) : supabase.from('products').insert(metadata);
        const { data, error } = await query.select(productFields).single();
        if (error) throw error;
        product = data;
        const index = state.products.findIndex((item) => String(item.id) === String(product.id));
        if (index >= 0) state.products[index] = product;
        else state.products.push(product);
        productForm.elements.id.value = product.id;
        productForm.elements.hidden.checked = true;
        root.querySelector('[data-editor-mode]').textContent = 'СКРИТА ЧЕРНОВА';
        root.querySelector('#editor-title').textContent = `Редакция: ${product.name}`;
      } catch (error) {
        formMessage.replaceChildren(createAlert('danger', messageOf(error, 'Данните за продукта не бяха запазени.')));
        setBusy(productForm, button, false, 'Запазване…');
        return;
      }
      let price = state.prices.get(String(product.id));
      if (draftOnly) {
        setPrice(price);
        renderList();
        formMessage.replaceChildren(createAlert('success', 'Черновата е запазена. Можете да добавите цена и да публикувате по-късно.'));
        markProductClean();
        setBusy(productForm, button, false, 'Запазване…');
        return;
      }
      if (hasPrice) {
        try {
          const { data, error } = await supabase.rpc('set_admin_product_retail_price', { p_product_id: product.id, p_retail_price: priceValue });
          if (error) throw error;
          price = Array.isArray(data) ? data[0] : data;
          if (!price) throw new Error('Цената не беше върната след запазване.');
          state.prices.set(String(product.id), price);
          setPrice(price);
        } catch (error) {
          renderList();
          formMessage.replaceChildren(createAlert('warning', `Данните за продукта са запазени като скрита чернова, но цената не беше запазена: ${messageOf(error, 'Опитайте отново.')}`));
          setBusy(productForm, button, false, 'Запазване…');
          return;
        }
      }
      if (wantsPublish) {
        const problem = publishingProblem(product, price);
        if (problem) {
          renderList();
          formMessage.replaceChildren(createAlert('warning', `Продуктът е запазен като скрита чернова. ${problem}`));
          markProductClean();
          setBusy(productForm, button, false, 'Запазване…');
          return;
        }
        try {
          const { data, error } = await supabase.from('products').update({ is_hidden: false }).eq('id', product.id).select(productFields).single();
          if (error) throw error;
          product = data;
          state.products[state.products.findIndex((item) => String(item.id) === String(product.id))] = product;
          formMessage.replaceChildren(createAlert('success', 'Продуктът, цената и публикуването са запазени.'));
        } catch (error) {
          renderList();
          formMessage.replaceChildren(createAlert('warning', `Данните${hasPrice ? ' и цената' : ''} са запазени, но публикуването не успя. Продуктът остава скрита чернова: ${messageOf(error, 'Опитайте отново.')}`));
          markProductClean();
          setBusy(productForm, button, false, 'Запазване…');
          return;
        }
      } else {
        formMessage.replaceChildren(createAlert('success', hasPrice ? 'Продуктът и цената са запазени като скрита чернова.' : 'Продуктът е запазен като скрита чернова.'));
      }
      renderList();
      editProduct(product.id, true);
      setBusy(productForm, button, false, 'Запазване…');
    }

    function showSaveError(text, retry) {
      const retryButton = el('button', 'btn btn-sm btn-outline-primary mt-2', 'Опитай отново');
      retryButton.type = 'button';
      retryButton.addEventListener('click', retry);
      formMessage.replaceChildren(createAlert('warning', text), retryButton);
    }

    async function saveProductWorkflow({ automatic = false, context = state.draftContext, draftOnly = false, publish = false } = {}) {
      if (automatic && (context !== state.draftContext || !state.isNewDraft)) return;
      const revision = productEditRevision;
      const markCurrentSaveClean = (keepUnsavedState = false) => {
        if (revision === productEditRevision) markProductClean(keepUnsavedState);
        else updateProductDirtyState();
      };
      const name = productForm.elements.name.value.trim();
      if (!name) {
        if (!automatic) formMessage.replaceChildren(createAlert('danger', 'Името е задължително и за скрита чернова.'));
        return;
      }

      const actionButton = productForm.querySelector('[type="submit"]');
      const rawPrice = productForm.elements.retail.value;
      const priceValue = draftOnly ? null : finitePositive(rawPrice);
      const hasPrice = !draftOnly && Boolean(rawPrice.trim());
      const invalidPrice = priceValue === undefined;
      const productId = productForm.elements.id.value;
      const forceHidden = state.isNewDraft || automatic || draftOnly || publish || !productId;
      const metadata = {
        name,
        brand_id: productForm.elements.brand.value || null,
        category_id: productForm.elements.category.value || null,
        article_code: optional(productForm.elements.code.value),
        series_name: optional(productForm.elements.series.value),
        description: productForm.elements.description.value.trim(),
        size_label: optional(productForm.elements.size.value),
        shade_number: optional(productForm.elements.shadeNumber.value),
        shade_name: optional(productForm.elements.shadeName.value),
        shade_color: optional(productForm.elements.shadeColor.value),
        developer_concentration: optional(productForm.elements.developer.value),
        image_path: optional(productForm.elements.image.value),
        is_recommended: productForm.elements.recommended.checked,
        is_hidden: forceHidden ? true : productForm.elements.hidden.checked,
      };

      if (automatic) formMessage.replaceChildren(createAlert('info', 'Запазване…'));
      else setBusy(productForm, actionButton, true, 'Запазване…');

      let product;
      try {
        const query = productId
          ? supabase.from('products').update(metadata).eq('id', productId)
          : supabase.from('products').insert(metadata);
        const { data, error } = await query.select(productFields).single();
        if (error) throw error;
        if (context !== state.draftContext) return;
        product = data;
        const index = state.products.findIndex((item) => String(item.id) === String(product.id));
        if (index >= 0) state.products[index] = product;
        else state.products.push(product);
        syncSavedProductState(product);
      } catch (error) {
        if (context !== state.draftContext) return;
        state.saveFailed = true;
        updateProductDirtyState();
        showSaveError(messageOf(error, 'Черновата не беше запазена.'), () => { void queueNewDraftSave({ automatic, draftOnly, publish, context }); });
        if (!automatic) setBusy(productForm, actionButton, false, 'Запазване…');
        return;
      }

      let price = state.prices.get(String(product.id));
      if (hasPrice && !invalidPrice) {
        try {
          const { data, error } = await supabase.rpc('set_admin_product_retail_price', {
            p_product_id: product.id,
            p_retail_price: priceValue,
          });
          if (error) throw error;
          if (context !== state.draftContext) return;
          price = Array.isArray(data) ? data[0] : data;
          if (!price) throw new Error('Цената не беше върната след запазване.');
          state.prices.set(String(product.id), price);
          setPrice(price);
        } catch (error) {
          if (context !== state.draftContext) return;
          state.saveFailed = true;
          updateProductDirtyState();
          renderList();
          showSaveError(`Черновата е запазена, но цената не беше запазена: ${messageOf(error, 'Опитайте отново.')}`, () => { void queueNewDraftSave({ automatic, draftOnly, publish, context }); });
          if (!automatic) setBusy(productForm, actionButton, false, 'Запазване…');
          return;
        }
      }

      if (publish) {
        const problem = invalidPrice
          ? 'Въведената цена не е валидна и не е запазена.'
          : publishingProblem(product, price);
        if (problem) {
          state.saveFailed = true;
          markCurrentSaveClean(true);
          renderList();
          formMessage.replaceChildren(createAlert('warning', `Продуктът е запазен като скрита чернова. ${problem}`));
          if (!automatic) setBusy(productForm, actionButton, false, 'Запазване…');
          return;
        }
        try {
          const { data, error } = await supabase
            .from('products')
            .update({ is_hidden: false })
            .eq('id', product.id)
            .select(productFields)
            .single();
          if (error) throw error;
          if (context !== state.draftContext) return;
          product = data;
          state.products[state.products.findIndex((item) => String(item.id) === String(product.id))] = product;
          window.clearTimeout(state.autosaveTimer);
          state.autosaveTimer = null;
          state.isNewDraft = false;
          syncSavedProductState(product);
          state.saveFailed = false;
          markCurrentSaveClean();
          renderList();
          formMessage.replaceChildren(createAlert('success', 'Публикувано. Продуктът и цената са запазени.'));
        } catch (error) {
          if (context !== state.draftContext) return;
          state.saveFailed = true;
          markCurrentSaveClean(true);
          renderList();
          showSaveError(`Данните${hasPrice ? ' и цената' : ''} са запазени, но публикуването не успя. Продуктът остава скрита чернова: ${messageOf(error, 'Опитайте отново.')}`, () => { queueNewDraftSave({ publish: true, context }); });
          if (!automatic) setBusy(productForm, actionButton, false, 'Запазване…');
          return;
        }
      } else if (invalidPrice) {
        state.saveFailed = true;
        markCurrentSaveClean(true);
        renderList();
        formMessage.replaceChildren(createAlert('warning', `${product.is_hidden ? 'Запазено като чернова.' : 'Промените са запазени.'} Въведената цена не е валидна и не е запазена. Коригирайте я, за да бъде записана.`));
      } else {
        state.saveFailed = false;
        markCurrentSaveClean();
        renderList();
        if (automatic) formMessage.replaceChildren(createAlert('success', 'Запазено'));
        else if (draftOnly) formMessage.replaceChildren(createAlert('success', 'Черновата е запазена. Можете да добавите цена и да публикувате по-късно.'));
        else formMessage.replaceChildren(createAlert('success', product.is_hidden ? 'Промените са запазени. Продуктът остава скрит.' : 'Промените по публикувания продукт са запазени.'));
      }
      if (!automatic) setBusy(productForm, actionButton, false, 'Запазване…');
    }

    function deletionFailureMessage(error) {
      const detail = error?.message || '';
      const blockerLabels = {
        'order lines': 'редове в поръчки, включително архивни редове',
        'stock levels': 'въведена наличност',
        'stock movements': 'движения на наличност',
        'stock reservations': 'резервации',
      };
      const match = detail.match(/references in (.+)\. Hide the product instead\./);
      if (match) {
        const blockers = match[1]
          .split(', ')
          .map((blocker) => blockerLabels[blocker] || blocker)
          .join(', ');
        return `Продуктът не може да бъде изтрит, защото има ${blockers}. Използвайте „Скрит продукт“ вместо това.`;
      }
      if (error?.code === '42501') {
        return 'Само одобрен администратор може да изтрие продукт.';
      }
      if (detail.includes('Product confirmation does not match')) {
        return 'Името на продукта е променено. Каталогът не е променен; обновете го и потвърдете отново.';
      }
      if (error?.code === '23503' && detail.includes('does not exist')) {
        return 'Продуктът вече не съществува. Обновете каталога.';
      }
      return 'Продуктът не беше изтрит. Данните в редактора са запазени; опитайте отново.';
    }

    async function refreshProductsAfterDeletion() {
      const [products, prices] = await Promise.all([
        supabase.from('products').select(productFields).order('name'),
        supabase.rpc('get_admin_product_prices'),
      ]);
      const failed = [products, prices].find((result) => result.error);
      if (failed) throw failed.error;
      state.products = products.data || [];
      state.prices = new Map((prices.data || []).map((price) => [String(price.product_id), price]));
      renderList();
    }

    function openDeleteProductConfirmation() {
      const productId = productForm.elements.id.value;
      const product = state.products.find((item) => String(item.id) === String(productId));
      if (!product || state.deletingProductId) return;

      productPendingDeletion = { id: product.id, name: product.name };
      deleteModalProductName.textContent = product.name;
      setDeleteConfirmationBusy(false);
      deleteModal.show();
    }

    function isStaleProductNameError(error) {
      return (error?.message || '').includes('Product confirmation does not match');
    }

    async function refreshStaleProductForDeletion(product) {
      try {
        await refreshProductsAfterDeletion();
        const refreshedProduct = state.products.find((item) => String(item.id) === String(product.id));
        if (!refreshedProduct) {
          resetProduct();
          formMessage.replaceChildren(createAlert('warning', 'Продуктът вече не съществува. Каталогът е обновен.'));
          return;
        }

        editProduct(refreshedProduct.id, true);
        formMessage.replaceChildren(createAlert('warning', 'Името на продукта е променено. Данните са обновени; потвърдете изтриването отново.'));
      } catch (_refreshError) {
        formMessage.replaceChildren(createAlert('warning', 'Името на продукта е променено, но каталогът не можа да се обнови. Обновете страницата и потвърдете изтриването отново.'));
      }
    }

    async function deleteProduct() {
      const product = productPendingDeletion;
      const deleteButton = root.querySelector('[data-delete-product]');
      if (!product || state.deletingProductId) return;

      state.deletingProductId = String(product.id);
      setBusy(productForm, deleteButton, true, 'Изтриване…');
      setDeleteConfirmationBusy(true);
      formMessage.replaceChildren(createAlert('info', 'Проверка на продукта и изтриване…'));
      try {
        const { error } = await supabase.rpc('delete_admin_product', {
          p_product_id: product.id,
          p_confirmed_product_name: product.name,
        });
        if (error) throw error;

        deleteModal.hide();
        state.products = state.products.filter((item) => String(item.id) !== String(product.id));
        state.prices.delete(String(product.id));
        window.clearTimeout(state.autosaveTimer);
        state.autosaveTimer = null;
        resetProduct();
        renderList();

        try {
          await refreshProductsAfterDeletion();
          formMessage.replaceChildren(createAlert('success', `Продуктът „${product.name}“ е изтрит окончателно и каталогът е обновен.`));
        } catch (_refreshError) {
          formMessage.replaceChildren(createAlert('warning', `Продуктът „${product.name}“ е изтрит окончателно. Редакторът е изчистен, но каталогът не можа да се обнови; обновете страницата.`));
        }
      } catch (error) {
        deleteModal.hide();
        if (isStaleProductNameError(error)) {
          await refreshStaleProductForDeletion(product);
        } else {
          formMessage.replaceChildren(createAlert('warning', deletionFailureMessage(error)));
        }
      } finally {
        state.deletingProductId = null;
        productPendingDeletion = null;
        setBusy(productForm, deleteButton, false, 'Изтриване…');
        setDeleteConfirmationBusy(false);
      }
    }

    function queueNewDraftSave(options = {}) {
      const context = options.context ?? state.draftContext;
      const run = () => saveProductWorkflow({ ...options, context });
      if (!state.isNewDraft) {
        void run();
        return;
      }
      state.saveQueue = state.saveQueue.catch(() => {}).then(run);
    }

    function scheduleNewDraftAutosave() {
      if (!state.isNewDraft || !productForm.elements.name.value.trim()) return;
      window.clearTimeout(state.autosaveTimer);
      const context = state.draftContext;
      state.autosaveTimer = window.setTimeout(() => {
        queueNewDraftSave({ automatic: true, context });
      }, 700);
    }

    root.querySelector('[data-new-product]').addEventListener('click', () => { if (confirmDiscardProductChanges()) { resetProduct(); showEditor(); } });
    root.querySelector('[data-reset-product]').addEventListener('click', () => { if (confirmDiscardProductChanges()) resetProduct(); });
    closeEditorButton.addEventListener('click', closeEditor);
    root.querySelector('[data-save-draft]').addEventListener('click', () => { queueNewDraftSave({ draftOnly: true }); });
    root.querySelector('[data-publish-product]').addEventListener('click', () => { queueNewDraftSave({ publish: true }); });
    root.querySelector('[data-delete-product]').addEventListener('click', openDeleteProductConfirmation);
    confirmDeleteButton.addEventListener('click', () => { void deleteProduct(); });
    productForm.addEventListener('submit', (event) => {
      event.preventDefault();
      queueNewDraftSave();
    });
    productForm.addEventListener('input', () => {
      productEditRevision += 1;
      updateProductDirtyState();
      scheduleNewDraftAutosave();
    });
    productForm.addEventListener('change', () => {
      productEditRevision += 1;
      updateProductDirtyState();
      scheduleNewDraftAutosave();
    });
    root.querySelector('[data-new-brand]').addEventListener('click', () => resetMeta(brandForm, '[data-brand-title]', 'Нова марка'));
    root.querySelector('[data-new-category]').addEventListener('click', () => resetMeta(categoryForm, '[data-category-title]', 'Нова категория'));
    search.addEventListener('input', renderList);
    visibility.addEventListener('change', renderList);
    brandFilter.addEventListener('change', renderList);
    categoryFilter.addEventListener('change', renderList);
    recommendedFilter.addEventListener('change', renderList);
    clearFiltersButton.addEventListener('click', () => {
      search.value = '';
      visibility.value = 'all';
      brandFilter.value = '';
      categoryFilter.value = '';
      recommendedFilter.checked = false;
      renderList();
    });
    renderMeta();
    resetProduct();
    renderList();
    priceListsSection = createAdminPriceListsSection();
    root.append(priceListsSection.element);
    void priceListsSection.load();
  }

  async function load(session) {
    const version = ++state.version;
    const canPreserveWorkspace = state.activeAdminUserId === session.user.id
      && Boolean(content.querySelector('.admin-products-shell'));
    if (!canPreserveWorkspace) {
      priceListsSection?.clear();
      priceListsSection = null;
      content.replaceChildren(createAlert('info', 'Проверка на администраторския достъп…'));
    }
    try {
      const profile = await getApprovedAdminProfile(session.user.id);
      if (version !== state.version) return;
      if (!profile) {
        clearProtected('Тази страница е достъпна само за одобрени администратори.');
        return;
      }
      if (canPreserveWorkspace) return;
      content.replaceChildren(createAlert('info', 'Зареждане на каталога…'));
      const [products, brands, categories, prices] = await Promise.all([
        supabase.from('products').select(productFields).order('name'),
        supabase.from('brands').select('id, name, is_hidden, sort_order').order('name'),
        supabase.from('product_categories').select('id, name, product_group, sort_order').order('name'),
        supabase.rpc('get_admin_product_prices'),
      ]);
      const failed = [products, brands, categories, prices].find((result) => result.error);
      if (failed) throw failed.error;
      if (version !== state.version) return;
      state.products = products.data || [];
      state.brands = brands.data || [];
      state.categories = categories.data || [];
      state.prices = new Map((prices.data || []).map((price) => [String(price.product_id), price]));
      state.activeAdminUserId = session.user.id;
      renderWorkspace();
    } catch (error) {
      if (version === state.version) clearProtected(messageOf(error, 'Каталогът не можа да бъде зареден. Опитайте отново по-късно.'), 'danger');
    }
  }

  async function refresh() {
    if (!isSupabaseConfigured) {
      clearProtected('За управление на каталога е нужна активна връзка със Supabase.', 'info');
      return;
    }
    const { session, error } = await getSession();
    if (error || !session?.user) {
      clearProtected('Влезте с одобрен администраторски профил, за да управлявате каталога.');
      return;
    }
    await load(session);
  }

  const unsubscribe = subscribeToSessionChanges((_event, session) => {
    if (!session?.user) clearProtected('Сесията е прекратена. Влезте отново, за да управлявате каталога.');
    else void load(session);
  });
  window.addEventListener('salon-auth-signed-out', () => { unsubscribe(); clearProtected('Сесията е прекратена. Влезте отново, за да управлявате каталога.'); }, { once: true });
  window.addEventListener('focus', () => { void refresh(); });
  await refresh();
  return main;
}
