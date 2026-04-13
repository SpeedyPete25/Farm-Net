/**
 * Shared API helper for JSON-based requests to the backend.
 */

/**
 * Send a JSON request to the backend and return the parsed JSON response.
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
  return response.json();
}
