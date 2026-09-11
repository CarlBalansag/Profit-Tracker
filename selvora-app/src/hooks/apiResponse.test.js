import { describe, expect, it } from 'vitest';
import { requireSuccessfulResponse } from './apiResponse';

describe('requireSuccessfulResponse', () => {
  it('returns successful responses unchanged', async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });

    await expect(requireSuccessfulResponse(response)).resolves.toBe(response);
  });

  it('uses the API error message for failed responses', async () => {
    const response = new Response(JSON.stringify({ error: 'Expense is in use' }), { status: 409 });

    await expect(requireSuccessfulResponse(response, 'Could not delete expense'))
      .rejects.toThrow('Expense is in use');
  });

  it('keeps the caller fallback when an error response has no JSON body', async () => {
    const response = new Response('', { status: 500 });

    await expect(requireSuccessfulResponse(response, 'Could not delete expense'))
      .rejects.toThrow('Could not delete expense');
  });
});
