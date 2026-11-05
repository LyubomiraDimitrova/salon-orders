export const orderStatusLabels = {
  NEW: 'Нова',
  APPROVED: 'Одобрена',
  IN_PROGRESS: 'В обработка',
  DONE: 'Изпълнена',
  DENIED: 'Отказана',
};

export function formatOrderStatus(status) {
  return orderStatusLabels[status] || status;
}

export function formatDate(value) {
  if (!value) {
    return 'Не е посочена';
  }

  return new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`));
}

export function formatDateTime(value) {
  if (!value) {
    return 'Не е посочено';
  }

  return new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function formatTimeInterval(from, to) {
  return from && to ? `${from.slice(0, 5)} – ${to.slice(0, 5)} ч.` : 'Не е посочен';
}

export function createStatusBadge(status) {
  const badge = document.createElement('span');
  const tone = {
    NEW: 'text-bg-secondary',
    APPROVED: 'text-bg-primary',
    IN_PROGRESS: 'text-bg-warning',
    DONE: 'text-bg-success',
    DENIED: 'text-bg-danger',
  }[status] || 'text-bg-secondary';
  badge.className = `badge ${tone}`;
  badge.textContent = formatOrderStatus(status);
  return badge;
}
