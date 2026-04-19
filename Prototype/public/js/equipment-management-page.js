/**
 * Admin equipment management page module.
 * Renders equipment list and supports add/remove/update operations.
 */

/**
 * Create equipment management controller.
 * @param {{
 *   equipmentManagementList: HTMLElement,
 *   equipmentManagementForm: HTMLFormElement,
 *   equipmentNameInput: HTMLInputElement,
 *   equipmentQuantityInput: HTMLInputElement,
 *   equipmentManagementError: HTMLElement,
 *   requestJson: (url: string, options?: RequestInit) => Promise<any>,
 *   onEquipmentChanged: () => Promise<void>
 * }} deps
 */
export function createEquipmentManagementPage(deps) {
  const {
    equipmentManagementList,
    equipmentManagementForm,
    equipmentNameInput,
    equipmentQuantityInput,
    equipmentManagementError,
    requestJson,
    onEquipmentChanged
  } = deps;

  /** @type {Array<{ id: number, name: string, quantity: number }>} */
  let equipment = [];

  function render() {
    if (!equipment || equipment.length === 0) {
      equipmentManagementList.innerHTML = '<p>No equipment found.</p>';
      return;
    }

    equipmentManagementList.innerHTML = equipment.map((item) => {
      return `
        <div class="item-row">
          <div>
            <strong>${item.name}</strong>
            <p>
              Quantity:
              <input
                type="number"
                min="1"
                step="1"
                value="${item.quantity}"
                data-equipment-quantity-id="${item.id}"
                style="width: 90px; margin: 0 8px;"
              />
              <button data-action="update-equipment" data-equipment-id="${item.id}">Update</button>
            </p>
          </div>
          <button class="danger" data-action="remove-equipment" data-equipment-id="${item.id}">Remove</button>
        </div>
      `;
    }).join('');
  }

  async function load() {
    equipmentManagementError.textContent = '';
    equipmentManagementList.innerHTML = '<p>Loading equipment...</p>';

    const result = await requestJson('/api/admin/equipment');
    if (result.error) {
      equipmentManagementList.innerHTML = `<p class="form-error">${result.error}</p>`;
      return;
    }

    equipment = Array.isArray(result.equipment) ? result.equipment : [];
    render();
  }

  equipmentManagementForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    equipmentManagementError.textContent = '';

    const name = equipmentNameInput.value.trim();
    const quantity = Number(equipmentQuantityInput.value);

    if (!name || !Number.isInteger(quantity) || quantity <= 0) {
      equipmentManagementError.textContent = 'Equipment name and a quantity greater than 0 are required.';
      return;
    }

    const result = await requestJson('/api/admin/equipment', {
      method: 'POST',
      body: JSON.stringify({ name, quantity })
    });

    if (result.error) {
      equipmentManagementError.textContent = result.error;
      return;
    }

    equipmentNameInput.value = '';
    equipmentQuantityInput.value = '';
    await load();
    await onEquipmentChanged();
  });

  equipmentManagementList.addEventListener('click', async (event) => {
    const updateButton = event.target.closest('[data-action="update-equipment"]');
    if (updateButton) {
      const equipmentId = Number(updateButton.dataset.equipmentId);
      if (!Number.isFinite(equipmentId)) return;

      const quantityInput = equipmentManagementList.querySelector(`[data-equipment-quantity-id="${equipmentId}"]`);
      const quantity = Number(quantityInput?.value);

      if (!Number.isInteger(quantity) || quantity <= 0) {
        equipmentManagementError.textContent = 'Quantity must be a whole number greater than 0.';
        return;
      }

      const result = await requestJson(`/api/admin/equipment/${equipmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity })
      });

      if (result.error) {
        equipmentManagementError.textContent = result.error;
        return;
      }

      equipmentManagementError.textContent = '';
      await load();
      await onEquipmentChanged();
      return;
    }

    const button = event.target.closest('[data-action="remove-equipment"]');
    if (!button) return;

    const equipmentId = Number(button.dataset.equipmentId);
    if (!Number.isFinite(equipmentId)) return;

    const item = equipment.find((entry) => entry.id === equipmentId);
    const equipmentName = item?.name || 'this equipment item';

    if (!confirm(`Are you sure you want to remove ${equipmentName}?`)) {
      return;
    }

    const result = await requestJson(`/api/admin/equipment/${equipmentId}`, {
      method: 'DELETE'
    });

    if (result.error) {
      equipmentManagementError.textContent = result.error;
      return;
    }

    equipmentManagementError.textContent = '';
    await load();
    await onEquipmentChanged();
  });

  return {
    load
  };
}
