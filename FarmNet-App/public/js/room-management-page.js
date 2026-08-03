/**
 * Admin room management page module.
 * Renders room list and supports add/remove operations plus per-room
 * booking policy (length limits, weekly frequency cap, admin approval)
 * and blackout window management.
 */

import { renderListState } from './utils.js';

/**
 * @typedef {{
 *   id: number,
 *   name: string,
 *   location: string,
 *   minDurationMinutes: number|null,
 *   maxDurationMinutes: number|null,
 *   maxBookingsPerUserPerWeek: number|null,
 *   requiresApproval: 0|1
 * }} ManagedRoom
 */

/**
 * @typedef {{ id: number, roomId: number, date: string, startTime: string, endTime: string, reason?: string }} RoomBlackout
 */

/**
 * @typedef {{
 *   roomManagementList: HTMLElement,
 *   roomManagementForm: HTMLFormElement,
 *   roomNameInput: HTMLInputElement,
 *   roomLocationInput: HTMLInputElement,
 *   roomManagementError: HTMLElement,
 *   requestJson: (url: string, options?: RequestInit) => Promise<any>,
 *   onRoomsChanged: () => Promise<void>
 * }} RoomManagementPageDeps
 */

/**
 * @typedef {{
 *   load: () => Promise<void>
 * }} RoomManagementPageApi
 */

/**
 * Create room management controller.
 * @param {RoomManagementPageDeps} deps
 * @returns {RoomManagementPageApi}
 */
export function createRoomManagementPage(deps) {
  const {
    roomManagementList,
    roomManagementForm,
    roomNameInput,
    roomLocationInput,
    roomManagementError,
    requestJson,
    onRoomsChanged
  } = deps;

  /** @type {ManagedRoom[]} */
  let rooms = [];

  /**
   * Build a short human-readable summary of a room's configured policy.
   * @param {ManagedRoom} room
   * @returns {string}
   */
  function describePolicy(room) {
    const parts = [];
    if (room.minDurationMinutes != null) parts.push(`Min ${room.minDurationMinutes} min`);
    if (room.maxDurationMinutes != null) parts.push(`Max ${room.maxDurationMinutes} min`);
    if (room.maxBookingsPerUserPerWeek != null) parts.push(`Max ${room.maxBookingsPerUserPerWeek}/week per user`);
    parts.push(room.requiresApproval ? 'Admin approval required' : 'Auto-approved');
    return parts.join(' · ');
  }

  /**
   * Render the current room inventory table, including inline policy editors.
   * @returns {void}
   */
  function render() {
    if (!rooms || rooms.length === 0) {
      renderListState(roomManagementList, { kind: 'empty', message: 'No rooms found.' });
      return;
    }

    roomManagementList.innerHTML = rooms.map((room) => {
      return `
        <div class="item-row">
          <div>
            <strong>${room.name}</strong>
            <p>${room.location}</p>
            <p class="room-policy-summary">${describePolicy(room)}</p>
            <details class="room-policy-panel" data-room-id="${room.id}">
              <summary>Booking policy &amp; blackout windows</summary>
              <div class="room-policy-form">
                <label>Min length (minutes)
                  <input type="number" min="1" step="1" data-policy-field="minDurationMinutes" data-room-id="${room.id}" value="${room.minDurationMinutes ?? ''}" placeholder="No minimum" />
                </label>
                <label>Max length (minutes)
                  <input type="number" min="1" step="1" data-policy-field="maxDurationMinutes" data-room-id="${room.id}" value="${room.maxDurationMinutes ?? ''}" placeholder="No maximum" />
                </label>
                <label>Max bookings per user per week
                  <input type="number" min="1" step="1" data-policy-field="maxBookingsPerUserPerWeek" data-room-id="${room.id}" value="${room.maxBookingsPerUserPerWeek ?? ''}" placeholder="No limit" />
                </label>
                <label class="room-policy-checkbox">
                  <input type="checkbox" data-policy-field="requiresApproval" data-room-id="${room.id}" ${room.requiresApproval ? 'checked' : ''} />
                  Requires admin approval
                </label>
                <button type="button" data-action="save-room-policy" data-room-id="${room.id}">Save policy</button>
                <div class="form-error" data-policy-error="${room.id}"></div>
              </div>

              <h4>Blackout windows</h4>
              <div class="room-blackout-list" data-room-id="${room.id}">Loading…</div>
              <form class="room-blackout-form" data-action="add-blackout" data-room-id="${room.id}">
                <label>Date<input type="date" data-blackout-field="date" required /></label>
                <label>Start<input type="time" data-blackout-field="startTime" required /></label>
                <label>End<input type="time" data-blackout-field="endTime" required /></label>
                <label>Reason<input type="text" data-blackout-field="reason" placeholder="Optional" /></label>
                <button type="submit">Add blackout</button>
              </form>
            </details>
          </div>
          <button class="danger" data-action="remove-room" data-room-id="${room.id}">Remove</button>
        </div>
      `;
    }).join('');
  }

  /**
   * Load room data from the admin API and refresh the rendered list.
   * @returns {Promise<void>}
   */
  async function load() {
    roomManagementError.textContent = '';
    renderListState(roomManagementList, { kind: 'loading', message: 'Loading rooms...' });

    let result;
    try {
      result = await requestJson('/api/admin/rooms');
    } catch (error) {
      renderListState(roomManagementList, { kind: 'error', message: 'Unable to load rooms.' });
      return;
    }

    if (result.error) {
      renderListState(roomManagementList, { kind: 'error', message: result.error });
      return;
    }

    rooms = Array.isArray(result.rooms) ? result.rooms : [];
    render();
  }

  /**
   * Fetch and render the blackout windows for a single room.
   * @param {number} roomId
   * @returns {Promise<void>}
   */
  async function loadBlackouts(roomId) {
    const container = roomManagementList.querySelector(`.room-blackout-list[data-room-id="${roomId}"]`);
    if (!container) return;

    container.textContent = 'Loading…';

    const result = await requestJson(`/api/admin/rooms/${roomId}/blackouts`);
    if (result.error) {
      container.textContent = result.error;
      return;
    }

    const blackouts = Array.isArray(result.blackouts) ? result.blackouts : [];
    if (blackouts.length === 0) {
      container.innerHTML = '<p class="equipment-code-empty">No blackout windows.</p>';
      return;
    }

    container.innerHTML = blackouts.map((blackout) => `
      <div class="blackout-row">
        <span>${blackout.date} · ${blackout.startTime}–${blackout.endTime}${blackout.reason ? ` · ${blackout.reason}` : ''}</span>
        <button type="button" class="cancel-button" data-action="remove-blackout" data-room-id="${roomId}" data-blackout-id="${blackout.id}">Remove</button>
      </div>
    `).join('');
  }

  /**
   * Handle add-room submissions from the management form.
   * @param {SubmitEvent} event
   * @returns {Promise<void>}
   */
  async function handleRoomManagementFormSubmit(event) {
    event.preventDefault();
    roomManagementError.textContent = '';

    const name = roomNameInput.value.trim();
    const location = roomLocationInput.value.trim();

    if (!name || !location) {
      roomManagementError.textContent = 'Room name and location are required.';
      return;
    }

    const result = await requestJson('/api/admin/rooms', {
      method: 'POST',
      body: JSON.stringify({ name, location })
    });

    if (result.error) {
      roomManagementError.textContent = result.error;
      return;
    }

    roomNameInput.value = '';
    roomLocationInput.value = '';
    await load();
    await onRoomsChanged();
  }

  roomManagementForm.addEventListener('submit', handleRoomManagementFormSubmit);

  /**
   * Persist policy field edits for one room.
   * @param {number} roomId
   * @returns {Promise<void>}
   */
  async function saveRoomPolicy(roomId) {
    const getField = (field) => roomManagementList.querySelector(`[data-policy-field="${field}"][data-room-id="${roomId}"]`);
    const errorEl = roomManagementList.querySelector(`[data-policy-error="${roomId}"]`);

    const minInput = getField('minDurationMinutes');
    const maxInput = getField('maxDurationMinutes');
    const weeklyInput = getField('maxBookingsPerUserPerWeek');
    const approvalInput = getField('requiresApproval');

    const result = await requestJson(`/api/admin/rooms/${roomId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        minDurationMinutes: minInput.value.trim(),
        maxDurationMinutes: maxInput.value.trim(),
        maxBookingsPerUserPerWeek: weeklyInput.value.trim(),
        requiresApproval: approvalInput.checked
      })
    });

    if (result.error) {
      errorEl.textContent = result.error;
      return;
    }

    errorEl.textContent = '';
    await load();
    await onRoomsChanged();
  }

  /**
   * Remove a blackout window after confirmation.
   * @param {number} roomId
   * @param {number} blackoutId
   * @returns {Promise<void>}
   */
  async function removeBlackout(roomId, blackoutId) {
    if (!confirm('Remove this blackout window?')) return;

    const result = await requestJson(`/api/admin/rooms/${roomId}/blackouts/${blackoutId}`, {
      method: 'DELETE'
    });

    if (result.error) {
      alert(result.error);
      return;
    }

    await loadBlackouts(roomId);
  }

  /**
   * Handle delegated click actions for room removal, policy save, and blackout removal.
   * @param {MouseEvent} event
   * @returns {Promise<void>}
   */
  async function handleRoomManagementListClick(event) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;

    const savePolicyButton = target.closest('[data-action="save-room-policy"]');
    if (savePolicyButton) {
      const roomId = Number(savePolicyButton.dataset.roomId);
      if (Number.isFinite(roomId)) {
        await saveRoomPolicy(roomId);
      }
      return;
    }

    const removeBlackoutButton = target.closest('[data-action="remove-blackout"]');
    if (removeBlackoutButton) {
      const roomId = Number(removeBlackoutButton.dataset.roomId);
      const blackoutId = Number(removeBlackoutButton.dataset.blackoutId);
      if (Number.isFinite(roomId) && Number.isFinite(blackoutId)) {
        await removeBlackout(roomId, blackoutId);
      }
      return;
    }

    const button = target.closest('[data-action="remove-room"]');
    if (!button) return;

    const roomId = Number(button.dataset.roomId);
    if (!Number.isFinite(roomId)) return;

    const room = rooms.find((item) => item.id === roomId);
    const roomName = room?.name || 'this room';

    if (!confirm(`Are you sure you want to remove ${roomName}?`)) {
      return;
    }

    const result = await requestJson(`/api/admin/rooms/${roomId}`, {
      method: 'DELETE'
    });

    if (result.error) {
      roomManagementError.textContent = result.error;
      return;
    }

    roomManagementError.textContent = '';
    await load();
    await onRoomsChanged();
  }

  roomManagementList.addEventListener('click', handleRoomManagementListClick);

  /**
   * Handle blackout-add form submissions via delegation (forms are rebuilt on each render).
   * @param {SubmitEvent} event
   * @returns {Promise<void>}
   */
  async function handleBlackoutFormSubmit(event) {
    const form = event.target instanceof HTMLElement ? event.target.closest('[data-action="add-blackout"]') : null;
    if (!form) return;
    event.preventDefault();

    const roomId = Number(form.dataset.roomId);
    if (!Number.isFinite(roomId)) return;

    const date = form.querySelector('[data-blackout-field="date"]').value;
    const startTime = form.querySelector('[data-blackout-field="startTime"]').value;
    const endTime = form.querySelector('[data-blackout-field="endTime"]').value;
    const reason = form.querySelector('[data-blackout-field="reason"]').value.trim();

    const result = await requestJson(`/api/admin/rooms/${roomId}/blackouts`, {
      method: 'POST',
      body: JSON.stringify({ date, startTime, endTime, reason })
    });

    if (result.error) {
      alert(result.error);
      return;
    }

    form.reset();
    await loadBlackouts(roomId);
  }

  roomManagementList.addEventListener('submit', handleBlackoutFormSubmit);

  /**
   * Lazily load a room's blackout windows the first time its policy panel is opened.
   * Uses the capture phase since the native `toggle` event does not bubble.
   * @param {Event} event
   * @returns {void}
   */
  function handleDetailsToggle(event) {
    const details = event.target instanceof HTMLElement ? event.target.closest('.room-policy-panel') : null;
    if (!details || !details.open) return;

    const roomId = Number(details.dataset.roomId);
    if (!Number.isFinite(roomId)) return;

    loadBlackouts(roomId);
  }

  roomManagementList.addEventListener('toggle', handleDetailsToggle, true);

  return {
    load
  };
}
