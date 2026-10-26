import { describe, expect, it, vi } from 'vitest';
import { attachInventoryReceipt, MAX_RECEIPT_BYTES, saveInventoryWithReceipt, validateReceiptFile } from './receiptUpload';

describe('receipt upload helpers', () => {
  it('rejects files the receipt API cannot accept', () => {
    expect(() => validateReceiptFile({ type: 'image/svg+xml', size: 100 }))
      .toThrow('Use a JPEG, PNG, WebP, GIF, or PDF receipt.');
    expect(() => validateReceiptFile({ type: 'image/png', size: MAX_RECEIPT_BYTES + 1 }))
      .toThrow('Receipt exceeds the 5 MB size limit.');
  });

  it('posts an owned inventory receipt only after an inventory ID exists', async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await expect(attachInventoryReceipt(apiFetch, 'inventory-id', 'data:image/png;base64,YWJj', 'receipt.png'))
      .resolves.toEqual({ success: true });
    expect(apiFetch).toHaveBeenCalledWith('/api/receipts/attach', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ itemType: 'inventory', itemId: 'inventory-id', fileData: 'data:image/png;base64,YWJj', fileName: 'receipt.png' }),
    }));
  });

  it('does not treat an upload error as successful', async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Upload unavailable' }), { status: 503 }));

    await expect(attachInventoryReceipt(apiFetch, 'inventory-id', 'data:image/png;base64,YWJj', 'receipt.png'))
      .rejects.toThrow('Upload unavailable');
  });

  it('does not create a duplicate transaction when retrying a failed attachment', async () => {
    const receipt = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-inventory' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Cloud storage unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await expect(saveInventoryWithReceipt({ apiFetch, formData: { product_name: 'Test item' }, receipt }))
      .rejects.toMatchObject({ inventoryId: 'new-inventory', transactionSaved: true });
    await expect(saveInventoryWithReceipt({ apiFetch, formData: { product_name: 'Test item' }, existingInventoryId: 'new-inventory', receipt }))
      .resolves.toEqual({ inventoryId: 'new-inventory', attachedReceipt: true });

    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/inventory')).toHaveLength(1);
    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/receipts/attach')).toHaveLength(2);
  });
});
