import { createAlert } from '../auth/auth-helpers.js';
import { Modal } from 'bootstrap';
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

function isUncertainStorageError(error) {
  const statusCode = Number(error?.statusCode || error?.status);
  return !Number.isFinite(statusCode) || statusCode >= 500;
}

export function createAdminPriceListsSection() {
  const root = document.createElement('section');
  root.className = 'admin-price-lists mt-4';
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
    </div>
    <div class="modal fade" tabindex="-1" aria-labelledby="price-list-delete-title" aria-describedby="price-list-delete-description" data-price-list-delete-modal>
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header"><h2 class="modal-title fs-5" id="price-list-delete-title">Изтриване на ценови лист</h2></div>
          <div class="modal-body">
            <p id="price-list-delete-description" class="mb-2">Сигурни ли сте, че искате да изтриете този файл?</p>
            <p class="fw-semibold text-break mb-2" data-delete-price-list-name></p>
            <p class="mb-0">Изтриването е окончателно.</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" data-cancel-price-list-delete>Отказ</button>
            <button class="btn btn-danger" type="button" data-confirm-price-list-delete>Изтрий</button>
          </div>
        </div>
      </div>
    </div>`;

  const form = root.querySelector('[data-price-list-upload]');
  const fileInput = form.elements.priceList;
  const uploadButton = root.querySelector('[data-upload-price-list]');
  const feedback = root.querySelector('[data-price-list-feedback]');
  const filesContainer = root.querySelector('[data-price-list-files]');
  const selectedFile = root.querySelector('[data-selected-price-list]');
  const deleteModalElement = root.querySelector('[data-price-list-delete-modal]');
  const deleteModal = new Modal(deleteModalElement, { backdrop: 'static', keyboard: false });
  const deleteName = root.querySelector('[data-delete-price-list-name]');
  const confirmDeleteButton = root.querySelector('[data-confirm-price-list-delete]');
  const cancelDeleteButton = root.querySelector('[data-cancel-price-list-delete]');
  const state = {
    active: true,
    cleanupRequested: false,
    deleting: new Set(),
    deleteTarget: null,
    deleteFocusPath: null,
    downloading: new Set(),
    files: [],
    listVersion: 0,
    modalPhase: 'closed',
    operationEpoch: 0,
    pendingDeletion: null,
    pendingUpload: null,
    uploading: false,
  };

  function isListCurrent(version) {
    return state.active && root.isConnected && version === state.listVersion;
  }

  function isOperationCurrent(epoch) {
    return state.active && root.isConnected && epoch === state.operationEpoch;
  }

  function hasDeletionOperation() {
    return Boolean(state.deleteTarget) || state.deleting.size > 0 || Boolean(state.pendingDeletion);
  }

  function hasUploadOperation() {
    return state.uploading || Boolean(state.pendingUpload);
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

  function syncUploadControls() {
    const isBlockedByDeletion = hasDeletionOperation();
    fileInput.disabled = !state.active || hasUploadOperation() || isBlockedByDeletion;
    uploadButton.disabled = !state.active || hasUploadOperation() || isBlockedByDeletion;
    uploadButton.textContent = state.uploading ? 'Качване…' : 'Качи ценови лист';
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
      const path = file.object_path;
      const isDeleting = state.deleting.has(path);
      const isDownloading = state.downloading.has(path);
      const awaitsDeletionCheck = state.pendingDeletion?.object_path === path;
      const isDeleteTarget = state.deleteTarget?.object_path === path;
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
      downloadButton.className = 'btn btn-outline-primary';
      downloadButton.type = 'button';
      downloadButton.textContent = isDownloading ? 'Изтегляне…' : 'Изтегли PDF';
      downloadButton.disabled = isDownloading || isDeleting || isDeleteTarget || awaitsDeletionCheck;
      downloadButton.addEventListener('click', () => { void downloadFile(file); });
      const deleteButton = document.createElement('button');
      deleteButton.className = 'btn btn-outline-danger';
      deleteButton.type = 'button';
      deleteButton.dataset.priceListDeletePath = path;
      deleteButton.textContent = isDeleting ? 'Изтриване…' : 'Изтрий';
      deleteButton.disabled = isDownloading || isDeleting || isDeleteTarget || awaitsDeletionCheck || hasDeletionOperation() || hasUploadOperation();
      deleteButton.addEventListener('click', () => openDeleteConfirmation(file));
      const actions = document.createElement('div');
      actions.className = 'admin-price-list-actions';
      actions.append(downloadButton, deleteButton);
      details.append(name, meta);
      item.append(details, actions);
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
      if (!isListCurrent(version)) return null;
      if (error) throw error;
      records.push(...(data || []));
      if (!data || data.length < pageSize) return records;
    }
  }

  async function load() {
    const version = ++state.listVersion;
    filesContainer.replaceChildren(createAlert('info', 'Зареждане на ценовите листи…'));
    try {
      const files = await listFiles(version);
      if (!files || !isListCurrent(version)) return;
      state.files = files;
      renderFiles();
    } catch (error) {
      if (isListCurrent(version)) {
        filesContainer.replaceChildren(createAlert('danger', storageErrorMessage(error, 'Ценовите листи не могат да бъдат заредени. Опитайте отново по-късно.')));
      }
    }
  }

  async function downloadFile(file) {
    const path = file.object_path;
    if (state.downloading.has(path)
      || state.deleting.has(path)
      || state.deleteTarget?.object_path === path
      || state.pendingDeletion?.object_path === path
      || !state.active) return;
    const epoch = state.operationEpoch;
    state.downloading.add(path);
    renderFiles();

    try {
      const { data, error } = await supabase.storage.from(BUCKET_NAME).download(path);
      if (error) throw error;
      if (!isOperationCurrent(epoch)) return;
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
      if (isOperationCurrent(epoch)) showFeedback('danger', storageErrorMessage(error, 'Файлът не можа да бъде изтеглен. Опитайте отново.'));
    } finally {
      state.downloading.delete(path);
      if (isOperationCurrent(epoch)) renderFiles();
    }
  }

  function openDeleteConfirmation(file) {
    const path = file.object_path;
    if (!state.active
      || hasUploadOperation()
      || state.downloading.has(path)
      || hasDeletionOperation()) return;

    state.deleteTarget = file;
    state.deleteFocusPath = path;
    state.modalPhase = 'opening';
    deleteName.textContent = filenameFromRecord(file);
    confirmDeleteButton.disabled = false;
    cancelDeleteButton.disabled = false;
    confirmDeleteButton.textContent = 'Изтрий';
    syncUploadControls();
    renderFiles();
    deleteModal.show();
  }

  function closeDeleteConfirmation({ restoreFocus = false } = {}) {
    const focusPath = state.deleteFocusPath;
    state.deleteTarget = null;
    state.deleteFocusPath = null;
    if (state.active && root.isConnected) {
      syncUploadControls();
      renderFiles();
      if (restoreFocus && focusPath) {
        window.requestAnimationFrame(() => {
          const button = [...filesContainer.querySelectorAll('[data-price-list-delete-path]')]
            .find((item) => item.dataset.priceListDeletePath === focusPath);
          button?.focus();
        });
      }
    }
  }

  function hideDeleteConfirmation() {
    if (state.modalPhase !== 'closed') {
      state.modalPhase = 'closing';
      deleteModal.hide();
    }
  }

  function finalizeModalCleanup() {
    if (!state.cleanupRequested) return;
    deleteModal.dispose();
    deleteModalElement.remove();
    root.replaceChildren();
  }

  async function findExactObject(path, epoch) {
    const { data, error } = await supabase.rpc('list_admin_price_lists', {
      p_limit: 1,
      p_offset: 0,
      p_object_path: path,
    });
    if (error) throw error;
    if (!isOperationCurrent(epoch)) return null;
    return (data || []).length > 0;
  }

  async function finishConfirmedDeletion(file) {
    state.pendingDeletion = null;
    state.deleteTarget = null;
    state.deleteFocusPath = null;
    state.files = state.files.filter((item) => item.object_path !== file.object_path);
    syncUploadControls();
    hideDeleteConfirmation();
    renderFiles();
    showFeedback('success', `Ценовият лист „${filenameFromRecord(file)}“ е изтрит окончателно.`);
    await load();
  }

  function showUncertainDeletion(file, message) {
    state.pendingDeletion = file;
    state.deleteTarget = null;
    state.deleteFocusPath = null;
    syncUploadControls();
    hideDeleteConfirmation();
    renderFiles();
    showFeedbackAction('warning', message, 'Провери изтриването', () => { void reconcilePendingDeletion(); });
  }

  async function reconcilePendingDeletion() {
    const file = state.pendingDeletion;
    if (!file || state.deleting.size > 0 || !state.active) return;

    const epoch = state.operationEpoch;
    state.deleting.add(file.object_path);
    syncUploadControls();
    renderFiles();
    showFeedback('info', 'Проверка на изтриването на ценовия лист…');
    try {
      const exists = await findExactObject(file.object_path, epoch);
      if (exists === null) return;
      if (!exists) {
        await finishConfirmedDeletion(file);
        return;
      }
      state.pendingDeletion = null;
      syncUploadControls();
      renderFiles();
      showFeedback('warning', 'Файлът все още е наличен. Потвърдете изтриването отново, ако желаете да го премахнете.');
    } catch (error) {
      if (isOperationCurrent(epoch)) {
        showFeedbackAction(
          'danger',
          storageErrorMessage(error, 'Изтриването не може да бъде потвърдено. Не е изпратено ново изтриване.'),
          'Провери отново',
          () => { void reconcilePendingDeletion(); },
        );
      }
    } finally {
      state.deleting.delete(file.object_path);
      if (state.active && root.isConnected) {
        syncUploadControls();
        renderFiles();
      }
    }
  }

  async function confirmDeletion() {
    const file = state.deleteTarget;
    if (!file || state.deleting.size > 0 || !state.active) return;

    const path = file.object_path;
    const epoch = state.operationEpoch;
    state.deleting.add(path);
    syncUploadControls();
    confirmDeleteButton.disabled = true;
    cancelDeleteButton.disabled = true;
    confirmDeleteButton.textContent = 'Изтриване…';
    renderFiles();

    try {
      const { error } = await supabase.storage.from(BUCKET_NAME).remove([path]);
      if (error) throw error;
      const exists = await findExactObject(path, epoch);
      if (exists === null) return;
      if (!exists) {
        await finishConfirmedDeletion(file);
        return;
      }
      showUncertainDeletion(file, 'Изтриването не е потвърдено: файлът все още е наличен. Не е обявен за изтрит.');
    } catch (error) {
      if (!isOperationCurrent(epoch)) return;
      if (isUncertainStorageError(error)) {
        showUncertainDeletion(file, 'Резултатът от изтриването не е потвърден. Първо проверете дали този файл все още е наличен.');
      } else {
        state.deleteTarget = null;
        state.deleteFocusPath = null;
        syncUploadControls();
        hideDeleteConfirmation();
        renderFiles();
        showFeedback('danger', storageErrorMessage(error, 'Ценовият лист не можа да бъде изтрит. Опитайте отново.'));
      }
    } finally {
      state.deleting.delete(path);
      if (state.active && root.isConnected) {
        confirmDeleteButton.disabled = false;
        cancelDeleteButton.disabled = false;
        confirmDeleteButton.textContent = 'Изтрий';
        syncUploadControls();
        renderFiles();
      }
    }
  }

  async function uploadPriceList(pendingUpload) {
    if (!state.active
      || state.uploading
      || hasDeletionOperation()
      || (state.pendingUpload && state.pendingUpload.objectPath !== pendingUpload.objectPath)) return;

    const epoch = state.operationEpoch;
    state.uploading = true;
    syncUploadControls();
    renderFiles();
    showFeedback('info', 'Качване на ценовия лист…');

    try {
      const { error } = await supabase.storage.from(BUCKET_NAME).upload(pendingUpload.objectPath, pendingUpload.file, {
        cacheControl: '3600',
        contentType: 'application/pdf',
        metadata: { originalFilename: pendingUpload.originalFilename },
        upsert: false,
      });
      if (error) throw error;
      if (!isOperationCurrent(epoch)) return;
      state.pendingUpload = null;
      form.reset();
      renderSelectedFile();
      showFeedback('success', `Ценовият лист „${pendingUpload.originalFilename}“ е качен.`);
      await load();
    } catch (error) {
      if (!isOperationCurrent(epoch)) return;
      if (isUncertainStorageError(error)) {
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
      if (isOperationCurrent(epoch)) {
        state.uploading = false;
        syncUploadControls();
        renderFiles();
      }
    }
  }

  async function reconcilePendingUpload() {
    const pendingUpload = state.pendingUpload;
    if (!pendingUpload || state.uploading || !state.active || hasDeletionOperation()) return;

    const epoch = state.operationEpoch;
    state.uploading = true;
    syncUploadControls();
    renderFiles();
    showFeedback('info', 'Проверка на предишното качване…');
    try {
      const { data, error } = await supabase.rpc('list_admin_price_lists', {
        p_limit: 1,
        p_offset: 0,
        p_object_path: pendingUpload.objectPath,
      });
      if (error) throw error;
      if (!isOperationCurrent(epoch)) return;
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
      if (isOperationCurrent(epoch)) {
        showFeedbackAction(
          'danger',
          storageErrorMessage(error, 'Предишното качване не можа да бъде проверено. Не е изпратен нов файл.'),
          'Провери отново',
          () => { void reconcilePendingUpload(); },
        );
      }
    } finally {
      if (isOperationCurrent(epoch)) {
        state.uploading = false;
        syncUploadControls();
        renderFiles();
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.active || hasUploadOperation()) return;
    if (hasDeletionOperation()) {
      showFeedback('warning', 'Първо завършете или отменете изтриването на ценовия лист.');
      return;
    }

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
  cancelDeleteButton.addEventListener('click', hideDeleteConfirmation);
  confirmDeleteButton.addEventListener('click', () => { void confirmDeletion(); });
  deleteModalElement.addEventListener('shown.bs.modal', () => {
    state.modalPhase = 'open';
    if (state.cleanupRequested) {
      hideDeleteConfirmation();
      return;
    }
    cancelDeleteButton.focus();
  });
  deleteModalElement.addEventListener('hidden.bs.modal', () => {
    state.modalPhase = 'closed';
    if (state.cleanupRequested) {
      finalizeModalCleanup();
      return;
    }
    if (state.deleting.size === 0 && state.deleteTarget) closeDeleteConfirmation({ restoreFocus: true });
  });

  return {
    clear() {
      state.active = false;
      state.operationEpoch += 1;
      state.listVersion += 1;
      state.files = [];
      state.deleting.clear();
      state.deleteTarget = null;
      state.deleteFocusPath = null;
      state.downloading.clear();
      state.pendingDeletion = null;
      state.pendingUpload = null;
      state.uploading = false;
      state.cleanupRequested = true;
      deleteName.textContent = '';

      if (state.modalPhase === 'closed') {
        finalizeModalCleanup();
        return;
      }

      document.body.append(deleteModalElement);
      root.replaceChildren();
      hideDeleteConfirmation();
    },
    element: root,
    load,
  };
}
