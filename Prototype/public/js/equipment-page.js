/**
 * Equipment loans page module.
 * Renders equipment availability and handles borrow actions.
 */

/**
 * Build the equipment page controller.
 * @param {Object} deps Dependency bag.
 * @param {HTMLElement} deps.equipmentList Equipment list container.
 * @param {(equipmentId: number, equipmentName: string) => Promise<void>} deps.onBorrow Borrow callback.
 * @returns {{ render: (equipment: any[]) => void }} Equipment page API.
 */
export function createEquipmentPage({ equipmentList, onBorrow }) {
  equipmentList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="borrow-equipment"]');
    if (!button) return;

    const equipmentId = Number(button.dataset.equipmentId);
    const equipmentName = button.dataset.equipmentName || 'equipment';
    if (!Number.isFinite(equipmentId)) return;

    await onBorrow(equipmentId, equipmentName);
  });

  /**
   * Render available equipment cards.
   * @param {Array<{id: number, name: string, quantity: number, available: number}>} equipment Equipment list.
   */
  function render(equipment) {
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
