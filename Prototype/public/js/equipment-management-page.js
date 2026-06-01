/**
 * Admin equipment management page module.
 * Renders equipment list and supports add/remove/update operations.
 */

import { renderListState } from './utils.js';

/**
 * @typedef {{ id: number, name: string, quantity: number, codes?: string[] }} EquipmentItem
 */

/**
 * @typedef {{ id: number, equipmentName: string, equipmentCode?: string, borrowerEmail: string, borrowDate: string, returnDate: string }} BookedOutLoan
 */

/**
 * @typedef {{ equipment?: EquipmentItem[], error?: string }} EquipmentListResponse
 */

/**
 * @typedef {{ loans?: BookedOutLoan[], error?: string }} BookedOutLoansResponse
 */

/**
 * @typedef {{
 *   equipmentManagementList: HTMLElement,
 *   bookedOutEquipmentList: HTMLElement,
 *   equipmentManagementForm: HTMLFormElement,
 *   equipmentNameInput: HTMLInputElement,
 *   equipmentQuantityInput: HTMLInputElement,
 *   equipmentManagementError: HTMLElement,
 *   requestJson: (url: string, options?: RequestInit) => Promise<any>,
 *   onEquipmentChanged: () => Promise<void>
 * }} EquipmentManagementPageDeps
 */

/**
 * @typedef {{
 *   load: () => Promise<void>
 * }} EquipmentManagementPageApi
 */

/**
 * Create equipment management controller.
 * @param {EquipmentManagementPageDeps} deps
 * @returns {EquipmentManagementPageApi} Equipment management API.
 */
export function createEquipmentManagementPage(deps) {
  const {
    equipmentManagementList,
    bookedOutEquipmentList,
    equipmentManagementForm,
    equipmentNameInput,
    equipmentQuantityInput,
    equipmentManagementError,
    requestJson,
    onEquipmentChanged
  } = deps;

  /** @type {EquipmentItem[]} */
  let equipment = [];
  /** @type {BookedOutLoan[]} */
  let bookedOutLoans = [];

  /**
   * Render the editable equipment inventory list.
   * Each row exposes quantity updates, removal, and a collapsible list of
   * generated per-item equipment codes.
   * @returns {void}
   */
  function render() {
    if (!equipment || equipment.length === 0) {
      renderListState(equipmentManagementList, { kind: 'empty', message: 'No equipment found.' });
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
            <details class="equipment-codes-panel">
              <summary>Item codes (${Array.isArray(item.codes) ? item.codes.length : 0})</summary>
              <div class="equipment-codes-list">
                ${Array.isArray(item.codes) && item.codes.length > 0
                  ? item.codes.map((code) => `<span class="equipment-code-chip">${code}</span>`).join('')
                  : '<span class="equipment-code-empty">No item codes found.</span>'}
              </div>
            </details>
          </div>
          <button class="danger" data-action="remove-equipment" data-equipment-id="${item.id}">Remove</button>
        </div>
      `;
    }).join('');
  }

  /**
   * Render the list of equipment currently assigned to active loans.
   * @returns {void}
   */
  function renderBookedOutLoans() {
    if (!bookedOutLoans || bookedOutLoans.length === 0) {
      renderListState(bookedOutEquipmentList, { kind: 'empty', message: 'No equipment is currently booked out.' });
      return;
    }

    bookedOutEquipmentList.innerHTML = bookedOutLoans.map((loan) => {
      return `
        <div class="item-row">
          <div>
            <strong>${loan.equipmentName}</strong>
            ${loan.equipmentCode ? `<p>Assigned item: ${loan.equipmentCode}</p>` : ''}
            <p>Borrowed by: ${loan.borrowerEmail}</p>
            <p>Borrowed: ${loan.borrowDate} · Return by: ${loan.returnDate}</p>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Load inventory and booked-out equipment data in parallel, then render both
   * sections independently so one failed request does not block the other.
   * @returns {Promise<void>}
   */
  async function load() {
    equipmentManagementError.textContent = '';
    renderListState(equipmentManagementList, { kind: 'loading', message: 'Loading equipment...' });
    renderListState(bookedOutEquipmentList, { kind: 'loading', message: 'Loading booked-out equipment...' });

    /** @type {[EquipmentListResponse, BookedOutLoansResponse]} */
    let equipmentResult;
    let bookedOutResult;
    try {
      [equipmentResult, bookedOutResult] = await Promise.all([
        requestJson('/api/admin/equipment'),
        requestJson('/api/admin/equipment/booked-out')
      ]);
    } catch (error) {
      renderListState(equipmentManagementList, { kind: 'error', message: 'Failed to load equipment.' });
      renderListState(bookedOutEquipmentList, { kind: 'error', message: 'Failed to load booked-out equipment.' });
      return;
    }

    if (equipmentResult.error) {
      renderListState(equipmentManagementList, { kind: 'error', message: equipmentResult.error });
    } else {
      equipment = Array.isArray(equipmentResult.equipment) ? equipmentResult.equipment : [];
      render();
    }

    if (bookedOutResult.error) {
      renderListState(bookedOutEquipmentList, { kind: 'error', message: bookedOutResult.error });
      return;
    }

    bookedOutLoans = Array.isArray(bookedOutResult.loans) ? bookedOutResult.loans : [];
    renderBookedOutLoans();
  }

  /**
   * Handle new equipment submissions from the admin form.
   * Validates basic input client-side before creating inventory records.
   * @param {SubmitEvent} event
   * @returns {Promise<void>}
   */
  async function handleEquipmentManagementFormSubmit(event) {
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
  }

  equipmentManagementForm.addEventListener('submit', handleEquipmentManagementFormSubmit);

  /**
   * Handle update and removal actions from the rendered equipment list.
   * Uses event delegation because rows are rebuilt on each render.
   * @param {MouseEvent} event
   * @returns {Promise<void>}
   */
  async function handleEquipmentManagementListClick(event) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;

    const updateButton = target.closest('[data-action="update-equipment"]');
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

    const button = target.closest('[data-action="remove-equipment"]');
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
  }

  equipmentManagementList.addEventListener('click', handleEquipmentManagementListClick);

  return {
    load
  };
}
