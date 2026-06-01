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
 *   available: number
 * }} EquipmentAvailability
 */

/**
 * @typedef {{
 *   equipmentList: HTMLElement,
 *   onBorrow: (equipmentId: number, equipmentName: string) => Promise<void>
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
export function createEquipmentPage({ equipmentList, onBorrow }) {
  /**
   * Handle delegated clicks for borrow buttons in the equipment list.
   * @param {MouseEvent} event
   * @returns {Promise<void>}
   */
  async function handleEquipmentListClick(event) {
    const button = event.target.closest('[data-action="borrow-equipment"]');
    if (!button) return;

    const equipmentId = Number(button.dataset.equipmentId);
    const equipmentName = button.dataset.equipmentName || 'equipment';
    if (!Number.isFinite(equipmentId)) return;

    await onBorrow(equipmentId, equipmentName);
  }

  equipmentList.addEventListener('click', handleEquipmentListClick);

  /**
   * Render available equipment cards.
   * @param {EquipmentAvailability[]} equipment Equipment list with current availability.
   * @returns {void}
   */
  function render(equipment) {
    if (!Array.isArray(equipment) || equipment.length === 0) {
      renderListState(equipmentList, { kind: 'empty', message: 'No equipment available.' });
      return;
    }

    equipmentList.innerHTML = equipment.map((item) => {
      return `
        <div class="item-row">
          <div>
            <strong>${item.name}</strong>
            <p>Available: ${item.available} / ${item.quantity}</p>
          </div>
          <button ${item.available === 0 ? 'disabled' : ''} data-action="borrow-equipment" data-equipment-id="${item.id}" data-equipment-name="${item.name}">Borrow</button>
        </div>
      `;
    }).join('');
  }

  return { render };
}
