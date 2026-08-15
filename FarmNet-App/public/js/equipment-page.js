/**
 * Equipment loans page module.
 * Renders equipment availability and handles borrow actions.
 */

import { renderListState } from './utils.js';

/**
 * @typedef {{
 *   id: number,
 *   name: string,
 *   quantity: number,
 *   available: number,
 *   statusCounts?: { inMaintenance: number }
 * }} EquipmentAvailability
 */

/**
 * @typedef {{
 *   equipmentList: HTMLElement,
 *   onBorrow: (equipmentId: number, equipmentName: string) => Promise<void>,
 *   onReserve?: (equipmentId: number, equipmentName: string) => Promise<void>
 * }} EquipmentPageDeps
 */

/**
 * @typedef {{
 *   render: (equipment: EquipmentAvailability[]) => void
 * }} EquipmentPageApi
 */

/**
 * Build the equipment page controller.
 * @param {EquipmentPageDeps} deps Dependency bag.
 * @returns {EquipmentPageApi} Equipment page API.
 */
export function createEquipmentPage({ equipmentList, onBorrow, onReserve }) {
  /**
   * Handle delegated clicks for borrow buttons in the equipment list.
   * @param {MouseEvent} event
   * @returns {Promise<void>}
   */
  async function handleEquipmentListClick(event) {
    const borrowButton = event.target.closest('[data-action="borrow-equipment"]');
    if (borrowButton) {
      const equipmentId = Number(borrowButton.dataset.equipmentId);
      const equipmentName = borrowButton.dataset.equipmentName || 'equipment';
      if (!Number.isFinite(equipmentId)) return;

      await onBorrow(equipmentId, equipmentName);
      return;
    }

    const reserveButton = event.target.closest('[data-action="reserve-equipment"]');
    if (reserveButton) {
      const equipmentId = Number(reserveButton.dataset.equipmentId);
      const equipmentName = reserveButton.dataset.equipmentName || 'equipment';
      if (!Number.isFinite(equipmentId) || typeof onReserve !== 'function') return;

      await onReserve(equipmentId, equipmentName);
      return;
    }
  }

  equipmentList.addEventListener('click', handleEquipmentListClick);

  /**
   * Render available equipment cards.
   * @param {EquipmentAvailability[]} equipment Equipment list with current availability.
   * @returns {void}
   */
  function render(equipment) {
    // Equipment whose entire stock is damaged has nothing to offer and no path
    // back to availability without admin intervention, so it's dropped from the
    // borrowing list entirely rather than shown with permanently disabled buttons.
    const borrowable = Array.isArray(equipment)
      ? equipment.filter((item) => (item.statusCounts?.inMaintenance || 0) < item.quantity)
      : [];

    if (borrowable.length === 0) {
      renderListState(equipmentList, { kind: 'empty', message: 'No equipment available.' });
      return;
    }

    equipmentList.innerHTML = borrowable.map((item) => {
      return `
        <div class="item-row">
          <div>
            <strong>${item.name}</strong>
            <p>Available: ${item.available} / ${item.quantity}</p>
          </div>
          <div class="item-actions">
            <button ${item.available === 0 ? 'disabled' : ''} data-action="borrow-equipment" data-equipment-id="${item.id}" data-equipment-name="${item.name}">Borrow</button>
            <button ${item.available === 0 ? 'disabled' : ''} data-action="reserve-equipment" data-equipment-id="${item.id}" data-equipment-name="${item.name}">Reserve</button>
          </div>
        </div>
      `;
    }).join('');
  }

  return { render };
}
