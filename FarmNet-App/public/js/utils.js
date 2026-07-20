/**
 * Shared UI and date/time helper utilities.
 */

/**
 * @typedef {'loading'|'empty'|'error'} ListStateKind
 */

/**
 * Show an inline error or validation message.
 * @param {HTMLElement} element Target element for the message.
 * @param {string} message Message to display.
 */
export function showError(element, message) {
  element.textContent = message;
}

/**
 * Render a standard list state block (loading/empty/error).
 * @param {HTMLElement} container List container element.
 * @param {{ kind: ListStateKind, message: string }} state State payload.
 */
export function renderListState(container, state) {
  const { kind, message } = state;
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = `list-state list-state-${kind}`;

  const text = document.createElement('p');
  text.textContent = message;

  wrapper.appendChild(text);
  container.appendChild(wrapper);
}

/**
 * Format a duration in hours into a user-friendly label.
 * @param {number|string} duration Duration value in hours.
 * @returns {string} Human-readable duration string.
 */
export function formatDuration(duration) {
  const value = Number(duration);
  if (!Number.isFinite(value)) return `${duration}h`;
  const minutes = Math.round(value * 60);
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes} min`;
}

/**
 * Return today's date as YYYY-MM-DD.
 * @returns {string}
 */
export function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compute the next quarter-hour time in HH:MM.
 * @returns {string}
 */
export function getNextQuarterTime() {
  const now = new Date();
  const nextQuarter = Math.ceil(now.getMinutes() / 15) * 15;
  let hours = now.getHours();
  let minutes = nextQuarter;

  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }

  if (hours >= 24) {
    return '23:45';
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
