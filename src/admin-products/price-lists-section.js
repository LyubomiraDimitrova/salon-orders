import { createAlert } from '../auth/auth-helpers.js';
import { supabase } from '../services/supabase-client.js';

const BUCKET_NAME = 'admin-price-lists';
const FOLDER_NAME = 'price-lists';
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function safeOriginalFilename(name) {
  const normalized = String(name || '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .trim();

  return normalized.slice(0, 220) || 'ценова-листа.pdf';
}

function filenameFromRecord(record) {
  return safeOriginalFilename(record.original_filename || record.object_path);
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return 'Неизвестен размер';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Неизвестна дата'
    : new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function storageErrorMessage(error, fallback) {
  const detail = error?.message?.toLowerCase() || '';
  if (detail.includes('not authorized') || detail.includes('permission')) {
    return 'Нямате права за ценовите листи. Влезте с одобрен администраторски профил.';
  }
  if (detail.includes('already exists') || detail.includes('duplicate')) {
    return 'Файлът не беше качен, защото пътят вече съществува. Опитайте отново.';
  }
  return fallback;
}

function isUncertainUploadError(error) {
  const statusCode = Number(error?.statusCode || error?.status);
  return !Number.isFinite(statusCode) || statusCode >= 500;
}

export function createAdminPriceListsSection() {
  const root = document.createElement('section');
  root.className = 'admin-products-panel admin-price-lists mt-4';
  root.setAttribute('aria-labelledby', 'price-lists-title');
  root.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between gap-2 mb-3">
      <div>
        <p class="eyebrow mb-1">ДОКУМЕНТИ</p>
        <h2 class="h4 mb-1" id="price-lists-title">Ценови листи</h2>
        <p class="text-body-secondary mb-0">Само PDF до 10 MB. Видими са единствено за одобрени администратори.</p>
      </div>
    </div>
    <form data-price-list-upload novalidate>
      <label class="form-label fw-semibold" for="price-list-file">PDF ценови лист</label>
      <input class="form-control" id="price-list-file" name="priceList" type="file" accept="application/pdf,.pdf" aria-describedby="price-list-help" required />
      <div class="form-text" id="price-list-help">Изберете един PDF файл с размер до 10 MB.</div>
      <div class="form-text fw-semibold mt-2" data-selected-price-list aria-live="polite">Няма избран файл.</div>
      <div class="d-grid mt-3"><button class="btn btn-primary" type="submit" data-upload-price-list>Качи ценови лист</button></div>
      <div class="mt-3" data-price-list-feedback aria-live="polite"></div>
    </form>
    <div class="mt-4">
      <h3 class="h5 mb-3">Качени файлове</h3>
      <div data-price-list-files aria-live="polite"></div>
    </div>`;

  const form = root.querySelector('[data-price-list-upload]');
  const fileInput = form.elements.priceList;
  const uploadButton = root.querySelector('[data-upload-price-list]');
  const feedback = root.querySelector('[data-price-list-feedback]');
  const filesContainer = root.querySelector('[data-price-list-files]');
  const selectedFile = root.querySelector('[data-selected-price-list]');
  const state = {
    active: true,
    downloading: new Set(),
    files: [],
    pendingUpload: null,
    uploading: false,
    version: 0,
  };

  function isCurrent(version) {
    return state.active && root.isConnected && version === state.version;
  }

  function showFeedback(type, text) {
    feedback.replaceChildren(createAlert(type, text));
  }

  function showFeedbackAction(type, text, label, handler) {
    const alert = createAlert(type, text);
    const action = document.createElement('button');
    action.className = 'btn btn-sm btn-outline-primary mt-2';
    action.type = 'button';
    action.textContent = label;
    action.addEventListener('click', handler, { once: true });
    alert.append(document.createElement('br'), action);
    feedback.replaceChildren(alert);
  }

  function setUploadBusy(isBusy) {
    state.uploading = isBusy;
    fileInput.disabled = isBusy || Boolean(state.pendingUpload);
    uploadButton.disabled = isBusy || Boolean(state.pendingUpload);
    uploadButton.textContent = isBusy ? 'Качване…' : 'Качи ценови лист';
  }

  function renderSelectedFile() {
    const file = fileInput.files?.[0];
    selectedFile.textContent = file
      ? 'Избран файл: ' + safeOriginalFilename(file.name) + ' (' + formatFileSize(file.size) + ')'
      : 'Няма избран файл.';
  }

  function renderFiles() {
    if (state.files.length === 0) {
      filesContainer.replaceChildren(createAlert('secondary', 'Все още няма качени ценови листи.'));
      return;
    }

    const list = document.createElement('div');
    list.className = 'admin-price-list-files';
    state.files.forEach((file) => {
      const item = document.createElement('article');
      item.className = 'admin-price-list-file';
      const details = document.createElement('div');
      const name = document.createElement('h4');
      name.className = 'h6 mb-2';
      name.textContent = filenameFromRecord(file);
      const meta = document.createElement('p');
      meta.className = 'text-body-secondary small mb-0';
      meta.textContent = `${formatUploadDate(file.created_at)} · ${formatFileSize(file.size)}`;
      const downloadButton = document.createElement('button');
      downloadButton.className = 'btn btn-outline-primary w-100';
      downloadButton.type = 'button';
      downloadButton.textContent = 'Изтегли PDF';
      downloadButton.addEventListener('click', () => { void downloadFile(file, downloadButton); });
      details.append(name, meta);
      item.append(details, downloadButton);
      list.append(item);
    });
    filesContainer.replaceChildren(list);
  }

  async function listFiles(version) {
    const records = [];
    const pageSize = 100;

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.rpc('list_admin_price_lists', {
        p_limit: pageSize,
        p_offset: offset,
        p_object_path: null,
      });
      if (!isCurrent(version)) return null;
      if (error) throw error;
      records.push(...(data || []));
      if (!data || data.length < pageSize) return records;
    }
  }

  async function load() {
    const version = ++state.version;
    filesContainer.replaceChildren(createAlert('info', 'Зареждане на ценовите листи…'));
    try {
      const files = await listFiles(version);
      if (!files || !isCurrent(version)) return;
      state.files = files;
      renderFiles();
    } catch (error) {
      if (isCurrent(version)) {
        filesContainer.replaceChildren(createAlert('danger', storageErrorMessage(error, 'Ценовите листи не могат да бъдат заредени. Опитайте отново по-късно.')));
      }
    }
  }

  async function downloadFile(file, button) {
    const path = file.object_path;
    if (state.downloading.has(path) || !state.active) return;
    const version = state.version;
    state.downloading.add(path);
    button.disabled = true;
    button.textContent = 'Изтегляне…';

    try {
      const { data, error } = await supabase.storage.from(BUCKET_NAME).download(path);
      if (error) throw error;
      if (!isCurrent(version)) return;
      const objectUrl = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filenameFromRecord(file);
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      if (isCurrent(version)) showFeedback('danger', storageErrorMessage(error, 'Файлът не можа да бъде изтеглен. Опитайте отново.'));
    } finally {
      state.downloading.delete(path);
      if (isCurrent(version) && button.isConnected) {
        button.disabled = false;
        button.textContent = 'Изтегли PDF';
      }
    }
  }

  async function uploadPriceList(pendingUpload) {
    const version = state.version;
    setUploadBusy(true);
    showFeedback('info', 'Качване на ценовия лист…');

    try {
      const { error } = await supabase.storage.from(BUCKET_NAME).upload(pendingUpload.objectPath, pendingUpload.file, {
        cacheControl: '3600',
        contentType: 'application/pdf',
        metadata: { originalFilename: pendingUpload.originalFilename },
        upsert: false,
      });
      if (error) throw error;
      if (!isCurrent(version)) return;
      state.pendingUpload = null;
      form.reset();
      renderSelectedFile();
      showFeedback('success', `Ценовият лист „${pendingUpload.originalFilename}“ е качен.`);
      await load();
    } catch (error) {
      if (!isCurrent(version)) return;
      if (isUncertainUploadError(error)) {
        state.pendingUpload = pendingUpload;
        showFeedbackAction(
          'warning',
          'Резултатът от качването не е потвърден. Първо проверете дали този файл вече е записан.',
          'Провери качването',
          () => { void reconcilePendingUpload(); },
        );
      } else {
        state.pendingUpload = null;
        showFeedback('danger', storageErrorMessage(error, 'Ценовият лист не можа да бъде качен. Опитайте отново.'));
      }
    } finally {
      if (state.active && root.isConnected) setUploadBusy(false);
    }
  }

  async function reconcilePendingUpload() {
    const pendingUpload = state.pendingUpload;
    if (!pendingUpload || state.uploading || !state.active) return;

    const version = state.version;
    setUploadBusy(true);
    showFeedback('info', 'Проверка на предишното качване…');
    try {
      const { data, error } = await supabase.rpc('list_admin_price_lists', {
        p_limit: 1,
        p_offset: 0,
        p_object_path: pendingUpload.objectPath,
      });
      if (error) throw error;
      if (!isCurrent(version)) return;
      if ((data || []).length > 0) {
        state.pendingUpload = null;
        form.reset();
        renderSelectedFile();
        showFeedback('success', `Ценовият лист „${pendingUpload.originalFilename}“ е качен.`);
        await load();
        return;
      }

      showFeedbackAction(
        'info',
        'Файлът не е записан. Можете да повторите качването със същия защитен път.',
        'Повтори качването',
        () => { void uploadPriceList(pendingUpload); },
      );
    } catch (error) {
      if (isCurrent(version)) {
        showFeedbackAction(
          'danger',
          storageErrorMessage(error, 'Предишното качване не можа да бъде проверено. Не е изпратен нов файл.'),
          'Провери отново',
          () => { void reconcilePendingUpload(); },
        );
      }
    } finally {
      if (state.active && root.isConnected) setUploadBusy(false);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.uploading || !state.active || state.pendingUpload) return;

    const file = fileInput.files?.[0];
    if (!file) {
      showFeedback('warning', 'Изберете PDF файл за качване.');
      return;
    }
    if (file.type !== 'application/pdf') {
      showFeedback('warning', 'Може да качвате само PDF файлове.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showFeedback('warning', 'PDF файлът трябва да е най-много 10 MB.');
      return;
    }

    void uploadPriceList({
      file,
      objectPath: `${FOLDER_NAME}/${crypto.randomUUID()}.pdf`,
      originalFilename: safeOriginalFilename(file.name),
    });
  });
  fileInput.addEventListener('change', renderSelectedFile);

  return {
    clear() {
      state.active = false;
      state.version += 1;
      state.files = [];
      state.downloading.clear();
      state.pendingUpload = null;
      root.replaceChildren();
    },
    element: root,
    load,
  };
}
