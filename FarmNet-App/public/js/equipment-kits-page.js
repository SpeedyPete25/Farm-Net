/**
 * Equipment kits page module.
 * Renders kit availability (bundles of equipment items) and handles borrow/reserve actions.
 */

import { renderListState } from './utils.js';

/**
 * @typedef {{ equipmentId: number, equipmentName: string, quantity: number, available: number }} KitItemAvailability
 */

/**
 * @typedef {{
 *   id: number,
 *   name: string,
 *   available: number,
 *   requiresApproval?: 0|1,
 *   items: KitItemAvailability[]
 * }} KitAvailability
 */

/**
 * @typedef {{
 *   equipmentKitsList: HTMLElement,
 *   onBorrowKit: (kitId: number, kitName: string) => Promise<void>,
 *   onReserveKit?: (kitId: number, kitName: string) => Promise<void>
 * }} EquipmentKitsPageDeps
 */

/**
 * @typedef {{
 *   render: (kits: KitAvailability[]) => void
 * }} EquipmentKitsPageApi
 */

/**
 * Build the equipment kits page controller.
 * @param {EquipmentKitsPageDeps} deps Dependency bag.
 * @returns {EquipmentKitsPageApi} Equipment kits page API.
 */
export function createEquipmentKitsPage({ equipmentKitsList, onBorrowKit, onReserveKit }) {
  /**
   * Handle delegated clicks for borrow/reserve buttons in the kits list.
   * @param {MouseEvent} event
   * @returns {Promise<void>}
   */
  async function handleEquipmentKitsListClick(event) {
    const borrowButton = event.target.closest('[data-action="borrow-kit"]');
    if (borrowButton) {
      const kitId = Number(borrowButton.dataset.kitId);
      const kitName = borrowButton.dataset.kitName || 'kit';
      if (!Number.isFinite(kitId)) return;

      await onBorrowKit(kitId, kitName);
      return;
    }

    const reserveButton = event.target.closest('[data-action="reserve-kit"]');
    if (reserveButton) {
      const kitId = Number(reserveButton.dataset.kitId);
      const kitName = reserveButton.dataset.kitName || 'kit';
      if (!Number.isFinite(kitId) || typeof onReserveKit !== 'function') return;

      await onReserveKit(kitId, kitName);
      return;
    }
  }

  equipmentKitsList.addEventListener('click', handleEquipmentKitsListClick);

  /**
   * Render available kit cards, each showing their component items.
   * @param {KitAvailability[]} kits Kit list with current availability.
   * @returns {void}
   */
  function render(kits) {
    if (!Array.isArray(kits) || kits.length === 0) {
      renderListState(equipmentKitsList, { kind: 'empty', message: 'No kits available.' });
      return;
    }

    equipmentKitsList.innerHTML = kits.map((kit) => {
      const itemsSummary = kit.items.map((item) => `${item.equipmentName} × ${item.quantity}`).join(', ');
      return `
        <div class="item-row">
          <div>
            <strong>${kit.name}</strong>
            <p>Available: ${kit.available} complete kit(s)</p>
            <p class="status-summary">${itemsSummary}</p>
            ${kit.requiresApproval ? '<span class="status-label pending">Requires admin approval</span>' : ''}
          </div>
          <div class="item-actions">
            <button ${kit.available === 0 ? 'disabled' : ''} data-action="borrow-kit" data-kit-id="${kit.id}" data-kit-name="${kit.name}">Borrow</button>
            <button ${kit.available === 0 ? 'disabled' : ''} data-action="reserve-kit" data-kit-id="${kit.id}" data-kit-name="${kit.name}">Reserve</button>
          </div>
        </div>
      `;
    }).join('');
  }

  return { render };
}
