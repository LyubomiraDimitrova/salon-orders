const CART_KEY_PREFIX = 'salon-orders:client-cart:';
const SUBMISSION_KEY_PREFIX = 'salon-orders:client-order-submission:';
const MAX_QUANTITY = 2147483647;

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStoredJson(key, fallback) {
  const storage = getStorage();

  if (!storage) {
    return fallback;
  }

  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  const storage = getStorage();

  if (!storage) {
    return false;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeStoredValue(key) {
  getStorage()?.removeItem(key);
}

function cartKey(accountId) {
  return `${CART_KEY_PREFIX}${accountId}`;
}

function submissionKey(accountId) {
  return `${SUBMISSION_KEY_PREFIX}${accountId}`;
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= MAX_QUANTITY
    ? quantity
    : null;
}

function normalizeCartItem(item) {
  const productId = Number(item?.productId);
  const quantity = normalizeQuantity(item?.quantity);

  if (!Number.isSafeInteger(productId) || productId <= 0 || !quantity || !item?.name) {
    return null;
  }

  return {
    productId,
    quantity,
    name: String(item.name),
    sizeLabel: item.sizeLabel ? String(item.sizeLabel) : null,
    articleCode: item.articleCode ? String(item.articleCode) : null,
    brandName: item.brandName ? String(item.brandName) : null,
  };
}

function notifyCartChange(accountId) {
  window.dispatchEvent(new CustomEvent('salon-cart-updated', { detail: { accountId } }));
}

export function getClientCart(accountId) {
  if (!accountId) {
    return [];
  }

  const storedCart = readStoredJson(cartKey(accountId), []);
  return Array.isArray(storedCart)
    ? storedCart.map(normalizeCartItem).filter(Boolean)
    : [];
}

export function getCartItemCount(accountId) {
  return getClientCart(accountId).reduce((total, item) => total + item.quantity, 0);
}

export function saveClientCart(accountId, items) {
  if (!accountId) {
    return [];
  }

  const normalizedItems = Array.isArray(items)
    ? items.map(normalizeCartItem).filter(Boolean)
    : [];
  writeStoredJson(cartKey(accountId), normalizedItems);
  notifyCartChange(accountId);
  return normalizedItems;
}

export function addProductToClientCart(accountId, product) {
  const item = normalizeCartItem({
    productId: product.id,
    quantity: 1,
    name: product.name,
    sizeLabel: product.size_label,
    articleCode: product.article_code,
    brandName: product.brandName,
  });

  if (!accountId || !item) {
    return getClientCart(accountId);
  }

  const cart = getClientCart(accountId);
  const currentItem = cart.find((cartItem) => cartItem.productId === item.productId);

  if (currentItem) {
    currentItem.quantity = Math.min(MAX_QUANTITY, currentItem.quantity + 1);
  } else {
    cart.push(item);
  }

  return saveClientCart(accountId, cart);
}

export function clearClientOrderStorage(accountId) {
  if (!accountId) {
    return;
  }

  removeStoredValue(cartKey(accountId));
  removeStoredValue(submissionKey(accountId));
  notifyCartChange(accountId);
}

function normalizeNullableText(value) {
  const text = String(value || '').trim();
  return text || null;
}

export function buildWebsiteOrderPayload(cart, formValues) {
  const lines = cart
    .map(normalizeCartItem)
    .filter(Boolean)
    .map(({ productId, quantity }) => ({ product_id: productId, quantity }))
    .sort((first, second) => first.product_id - second.product_id);

  return {
    p_requested_delivery_date: formValues.requestedDeliveryDate || null,
    p_requested_delivery_time_from: null,
    p_requested_delivery_time_to: null,
    p_delivery_instructions: normalizeNullableText(formValues.deliveryInstructions),
    p_customer_note: null,
    p_lines: lines,
  };
}

export function getPayloadSignature(payload) {
  return JSON.stringify({
    p_requested_delivery_date: payload.p_requested_delivery_date || null,
    p_requested_delivery_time_from: payload.p_requested_delivery_time_from || null,
    p_requested_delivery_time_to: payload.p_requested_delivery_time_to || null,
    p_delivery_instructions: payload.p_delivery_instructions || null,
    p_customer_note: payload.p_customer_note || null,
    p_lines: [...(payload.p_lines || [])]
      .map((line) => ({ product_id: Number(line.product_id), quantity: Number(line.quantity) }))
      .sort((first, second) => first.product_id - second.product_id),
  });
}

export function getPendingWebsiteSubmission(accountId) {
  if (!accountId) {
    return null;
  }

  const submission = readStoredJson(submissionKey(accountId), null);
  if (!submission || typeof submission.requestId !== 'string' || typeof submission.signature !== 'string') {
    return null;
  }

  return submission;
}

export function savePendingWebsiteSubmission(accountId, submission) {
  if (!accountId || !submission?.requestId || !submission?.payload) {
    return false;
  }

  return writeStoredJson(submissionKey(accountId), submission);
}

export function clearPendingWebsiteSubmission(accountId) {
  if (accountId) {
    removeStoredValue(submissionKey(accountId));
  }
}

export function discardSubmissionIfPayloadChanged(accountId, payload) {
  const pendingSubmission = getPendingWebsiteSubmission(accountId);

  if (pendingSubmission && pendingSubmission.signature !== getPayloadSignature(payload)) {
    clearPendingWebsiteSubmission(accountId);
    return true;
  }

  return false;
}

export function getOrCreateWebsiteSubmission(accountId, payload) {
  const signature = getPayloadSignature(payload);
  const pendingSubmission = getPendingWebsiteSubmission(accountId);

  if (pendingSubmission?.signature === signature && pendingSubmission.payload) {
    return pendingSubmission;
  }

  const requestId = window.crypto?.randomUUID?.();
  if (!requestId) {
    throw new Error('Secure request ID generation is unavailable in this browser.');
  }

  const submission = { requestId, signature, payload };
  if (!savePendingWebsiteSubmission(accountId, submission)) {
    throw new Error('The submission cannot be persisted for a safe retry.');
  }
  return submission;
}
