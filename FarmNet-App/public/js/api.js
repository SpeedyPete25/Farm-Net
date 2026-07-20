/**
 * Shared API helper for JSON-based requests to the backend.
 */

/**
 * Send a JSON request to the backend and return the parsed JSON response.
 * Always sends JSON content-type headers and includes browser credentials so
 * session-backed endpoints can read the current user context.
 * @param {string} url API endpoint URL.
 * @param {RequestInit} [options={}] Fetch options.
 * @returns {Promise<any>} Parsed JSON response payload.
 */
export async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    credentials: 'include'
  });

  // Callers handle application-level errors in the JSON body.
  return response.json();
}
