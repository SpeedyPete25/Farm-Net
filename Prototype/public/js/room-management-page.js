/**
 * Admin room management page module.
 * Renders room list and supports add/remove operations.
 */

/**
 * @typedef {{ id: number, name: string, location: string }} ManagedRoom
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
   * Render the current room inventory table.
   * @returns {void}
   */
  function render() {
    if (!rooms || rooms.length === 0) {
      roomManagementList.innerHTML = '<p>No rooms found.</p>';
      return;
    }

    roomManagementList.innerHTML = rooms.map((room) => {
      return `
        <div class="item-row">
          <div>
            <strong>${room.name}</strong>
            <p>${room.location}</p>
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
    roomManagementList.innerHTML = '<p>Loading rooms...</p>';

    const result = await requestJson('/api/admin/rooms');
    if (result.error) {
      roomManagementList.innerHTML = `<p class="form-error">${result.error}</p>`;
      return;
    }

    rooms = Array.isArray(result.rooms) ? result.rooms : [];
    render();
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
   * Handle delegated click actions for room removal buttons.
   * @param {MouseEvent} event
   * @returns {Promise<void>}
   */
  async function handleRoomManagementListClick(event) {
    const button = event.target.closest('[data-action="remove-room"]');
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

  return {
    load
  };
}
