export async function requireSuccessfulResponse(response, fallback = 'Request failed') {
  if (response.ok) return response;

  let message = fallback;
  try {
    const body = await response.json();
    message = body?.error || body?.message || fallback;
  } catch {
    // Some API failures intentionally have no JSON response body.
  }

  throw new Error(message);
}
