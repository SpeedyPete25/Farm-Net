export function createEquipmentPage({ equipmentList, onBorrow }) {
  equipmentList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="borrow-equipment"]');
    if (!button) return;

    const equipmentId = Number(button.dataset.equipmentId);
    const equipmentName = button.dataset.equipmentName || 'equipment';
    if (!Number.isFinite(equipmentId)) return;

    await onBorrow(equipmentId, equipmentName);
  });

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
