import { requireSuccessfulResponse } from './apiResponse';

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.pdf';
const ALLOWED_RECEIPT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

export function validateReceiptFile(file) {
  if (!file) throw new Error('Select a receipt to upload.');
  if (!ALLOWED_RECEIPT_TYPES.has(file.type)) {
    throw new Error('Use a JPEG, PNG, WebP, GIF, or PDF receipt.');
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new Error('Receipt exceeds the 5 MB size limit.');
  }
}

export function readReceiptFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the receipt file.'));
    reader.readAsDataURL(file);
  });
}

export async function attachInventoryReceipt(apiFetch, inventoryId, fileData, fileName) {
  const response = await apiFetch('/api/receipts/attach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ itemType: 'inventory', itemId: inventoryId, fileData, fileName }),
  });
  await requireSuccessfulResponse(response, 'Could not attach receipt');
  return response.json();
}

export async function saveInventoryWithReceipt({ apiFetch, formData, existingInventoryId = null, receipt = null }) {
  const fileData = receipt ? await readReceiptFile(receipt) : null;
  let inventoryId = existingInventoryId;

  if (!inventoryId) {
    const response = await apiFetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(formData),
    });
    await requireSuccessfulResponse(response, 'Could not save transaction');
    const inventory = await response.json();
    inventoryId = inventory.id;
    if (!inventoryId) throw new Error('Transaction was saved without an inventory ID.');
  }

  if (!receipt) {
    if (existingInventoryId) throw new Error('Select a receipt to finish attaching it to the saved transaction.');
    return { inventoryId, attachedReceipt: false };
  }

  try {
    await attachInventoryReceipt(apiFetch, inventoryId, fileData, receipt.name);
  } catch (error) {
    error.inventoryId = inventoryId;
    error.transactionSaved = true;
    throw error;
  }

  return { inventoryId, attachedReceipt: true };
}
