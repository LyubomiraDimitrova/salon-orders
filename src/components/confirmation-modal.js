import { Modal } from 'bootstrap';

export function createConfirmationModal(idPrefix) {
  const element = document.createElement('div');
  element.className = 'modal fade';
  element.tabIndex = -1;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'true');
  element.setAttribute('aria-labelledby', `${idPrefix}-title`);
  element.setAttribute('aria-describedby', `${idPrefix}-description`);
  element.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h2 class="modal-title fs-5" id="${idPrefix}-title"></h2></div><div class="modal-body"><p class="mb-0" id="${idPrefix}-description"></p></div><div class="modal-footer"><button class="btn btn-outline-secondary" type="button" data-confirmation-cancel>Назад</button><button class="btn btn-primary" type="button" data-confirmation-accept>Потвърди</button></div></div></div>`;
  document.body.append(element);

  const modal = Modal.getOrCreateInstance(element, { backdrop: 'static', focus: true, keyboard: false });
  const title = element.querySelector(`#${idPrefix}-title`);
  const description = element.querySelector(`#${idPrefix}-description`);
  const cancel = element.querySelector('[data-confirmation-cancel]');
  const accept = element.querySelector('[data-confirmation-accept]');
  const state = { active: true, cleanupRequested: false, pending: null, returnFocus: null };

  const finish = (result) => {
    const pending = state.pending;
    state.pending = null;
    if (pending) pending.resolve(result);
  };
  const dispose = () => { modal.dispose(); element.remove(); };
  const close = (result) => {
    if (!state.pending) return;
    state.pending.result = result;
    modal.hide();
  };

  cancel.addEventListener('click', () => close(false));
  accept.addEventListener('click', () => close(true));
  element.addEventListener('shown.bs.modal', () => cancel.focus());
  element.addEventListener('hidden.bs.modal', () => {
    const pending = state.pending;
    const result = pending?.result === true;
    const focusTarget = state.returnFocus;
    state.returnFocus = null;
    finish(result);
    if (state.cleanupRequested) { dispose(); return; }
    if (state.active && focusTarget?.isConnected) focusTarget.focus();
  });

  const controller = {
    confirm({ title: titleText, description: descriptionText, confirmLabel = 'Потвърди', cancelLabel = 'Назад', danger = false, returnFocus } = {}) {
      if (!state.active || state.pending) return Promise.resolve(false);
      title.textContent = titleText || 'Потвърждение';
      description.textContent = descriptionText || '';
      accept.textContent = confirmLabel;
      cancel.textContent = cancelLabel;
      accept.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
      state.returnFocus = returnFocus || document.activeElement;
      return new Promise((resolve) => {
        state.pending = { resolve, result: false };
        modal.show();
      });
    },
    clear() {
      if (!state.active) return;
      state.active = false;
      state.cleanupRequested = true;
      if (element.classList.contains('show')) { modal.hide(); return; }
      finish(false);
      dispose();
    },
  };

  window.addEventListener('pagehide', () => controller.clear(), { once: true });
  return controller;
}
