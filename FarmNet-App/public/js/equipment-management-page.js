/**
 * Admin equipment management page module.
 * Renders equipment list and supports add/remove/update operations.
 */

import { renderListState } from './utils.js';

/**
 * @typedef {{ id: number, code: string, condition: 'working' | 'damaged', status: 'available'|'pending'|'reserved'|'checked-out'|'overdue'|'in-maintenance' }} EquipmentUnit
 */

/**
 * @typedef {{ available: number, pending: number, reserved: number, checkedOut: number, overdue: number, inMaintenance: number }} StatusCounts
 */

/**
 * @typedef {{ id: number, name: string, quantity: number, requiresApproval?: 0|1, codes?: EquipmentUnit[], statusCounts?: StatusCounts }} EquipmentItem
 */

/**
 * @typedef {{ id: number, equipmentName: string, equipmentCode?: string, borrowerEmail: string, borrowDate: string, returnDate: string, status: 'checked-out'|'overdue', daysOverdue: number }} BookedOutLoan
 */

/**
 * @typedef {{ id: number, kitId: number, equipmentId: number, equipmentName: string, quantity: number }} KitItem
 */

/**
 * @typedef {{ id: number, name: string, items: KitItem[] }} Kit
 */

const STATUS_LABELS = {
  available: 'Available',
  pending: 'Pending approval',
  reserved: 'Reserved',
  'checked-out': 'Checked out',
  overdue: 'Overdue',
  'in-maintenance': 'In maintenance'
};

/**
 * @typedef {{ equipment?: EquipmentItem[], error?: string }} EquipmentListResponse
 */

/**
 * @typedef {{ loans?: BookedOutLoan[], error?: string }} BookedOutLoansResponse
 */

/**
 * @typedef {{ kits?: Kit[], error?: string }} KitsResponse
 */

/**
 * @typedef {{
 *   equipmentManagementList: HTMLElement,
 *   bookedOutEquipmentList: HTMLElement,
 *   equipmentManagementForm: HTMLFormElement,
 *   equipmentNameInput: HTMLInputElement,
 *   equipmentQuantityInput: HTMLInputElement,
 *   equipmentManagementError: HTMLElement,
 *   kitManagementList: HTMLElement,
 *   kitManagementForm: HTMLFormElement,
 *   kitNameInput: HTMLInputElement,
 *   kitItemsEditor: HTMLElement,
 *   kitAddItemRowButton: HTMLButtonElement,
 *   kitFormSubmitButton: HTMLButtonElement,
 *   kitFormCancelEditButton: HTMLButtonElement,
 *   kitEditingIdInput: HTMLInputElement,
 *   kitManagementError: HTMLElement,
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
    kitManagementList,
    kitManagementForm,
    kitNameInput,
    kitItemsEditor,
    kitAddItemRowButton,
    kitFormSubmitButton,
    kitFormCancelEditButton,
    kitEditingIdInput,
    kitManagementError,
    requestJson,
    onEquipmentChanged
  } = deps;

  /** @type {EquipmentItem[]} */
  let equipment = [];
  /** @type {BookedOutLoan[]} */
  let bookedOutLoans = [];
  /** @type {Kit[]} */
  let kits = [];

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
      const counts = item.statusCounts || { available: 0, pending: 0, reserved: 0, checkedOut: 0, overdue: 0, inMaintenance: 0 };
      const statusSummary = [
        `Available: ${counts.available}`,
        `Pending: ${counts.pending}`,
        `Checked out: ${counts.checkedOut}`,
        `Reserved: ${counts.reserved}`,
        `Overdue: ${counts.overdue}`,
        `In maintenance: ${counts.inMaintenance}`
      ].join(' · ');

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
            <p class="status-summary">${statusSummary}</p>
            <p>
              <label class="room-policy-checkbox">
                <input type="checkbox" data-policy-field="requiresApproval" data-equipment-id="${item.id}" ${item.requiresApproval ? 'checked' : ''} />
                Requires admin approval
              </label>
              <button type="button" data-action="save-equipment-policy" data-equipment-id="${item.id}">Save policy</button>
            </p>
            <details class="equipment-codes-panel">
              <summary>Item codes (${Array.isArray(item.codes) ? item.codes.length : 0})</summary>
              <div class="equipment-codes-list">
                ${Array.isArray(item.codes) && item.codes.length > 0
                  ? item.codes.map((unit) => `
                      <span class="equipment-code-chip equipment-code-chip--${unit.status}">
                        ${unit.code} · ${STATUS_LABELS[unit.status] || unit.status}
                        <button
                          type="button"
                          data-action="toggle-unit-condition"
                          data-unit-id="${unit.id}"
                          data-current-condition="${unit.condition}"
                        >Mark as ${unit.condition === 'damaged' ? 'working' : 'damaged'}</button>
                      </span>
                    `).join('')
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
            <span class="equipment-code-chip equipment-code-chip--${loan.status}">${STATUS_LABELS[loan.status] || loan.status}</span>
            ${loan.equipmentCode ? `<p>Assigned item: ${loan.equipmentCode}</p>` : ''}
            <p>Borrowed by: ${loan.borrowerEmail}</p>
            <p>Borrowed: ${loan.borrowDate} · Return by: ${loan.returnDate}</p>
            ${loan.status === 'overdue' ? `<p class="overdue-days">Overdue by ${loan.daysOverdue} day${loan.daysOverdue === 1 ? '' : 's'}</p>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Render the kit inventory list, each showing its component items and quantities.
   * @returns {void}
   */
  function renderKits() {
    if (!kits || kits.length === 0) {
      renderListState(kitManagementList, { kind: 'empty', message: 'No kits found.' });
      return;
    }

    kitManagementList.innerHTML = kits.map((kit) => {
      const itemsSummary = kit.items.map((item) => `${item.equipmentName} × ${item.quantity}`).join(', ');
      return `
        <div class="item-row">
          <div>
            <strong>${kit.name}</strong>
            <p>${itemsSummary || 'No items configured'}</p>
          </div>
          <div class="item-actions">
            <button type="button" data-action="edit-kit" data-kit-id="${kit.id}">Edit</button>
            <button class="danger" data-action="remove-kit" data-kit-id="${kit.id}">Remove</button>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Build one editable equipment/quantity row for the kit item editor.
   * @param {number|string} [selectedEquipmentId]
   * @param {number} [quantity]
   * @returns {string}
   */
  function renderKitItemRow(selectedEquipmentId = '', quantity = 1) {
    const options = equipment.map((item) => (
      `<option value="${item.id}" ${String(item.id) === String(selectedEquipmentId) ? 'selected' : ''}>${item.name}</option>`
    )).join('');

    return `
      <div class="kit-item-row">
        <select class="kit-item-equipment">
          <option value="">— Select equipment —</option>
          ${options}
        </select>
        <input type="number" class="kit-item-quantity" min="1" step="1" value="${quantity}" />
        <button type="button" class="danger" data-action="remove-kit-item-row">Remove</button>
      </div>
    `;
  }

  /**
   * Reset the kit form back to "create" mode with a single empty item row.
   * @returns {void}
   */
  function resetKitForm() {
    kitEditingIdInput.value = '';
    kitNameInput.value = '';
    kitItemsEditor.innerHTML = renderKitItemRow();
    kitFormSubmitButton.textContent = 'Create kit';
    kitFormCancelEditButton.classList.add('hidden');
    kitManagementError.textContent = '';
  }

  /**
   * Load inventory, booked-out equipment, and kit data in parallel, then render each
   * section independently so one failed request does not block the others.
   * @returns {Promise<void>}
   */
  async function load() {
    equipmentManagementError.textContent = '';
    renderListState(equipmentManagementList, { kind: 'loading', message: 'Loading equipment...' });
    renderListState(bookedOutEquipmentList, { kind: 'loading', message: 'Loading booked-out equipment...' });
    renderListState(kitManagementList, { kind: 'loading', message: 'Loading kits...' });

    /** @type {[EquipmentListResponse, BookedOutLoansResponse, KitsResponse]} */
    let equipmentResult;
    let bookedOutResult;
    let kitsResult;
    try {
      [equipmentResult, bookedOutResult, kitsResult] = await Promise.all([
        requestJson('/api/admin/equipment'),
        requestJson('/api/admin/equipment/booked-out'),
        requestJson('/api/admin/kits')
      ]);
    } catch (error) {
      renderListState(equipmentManagementList, { kind: 'error', message: 'Unable to load equipment.' });
      renderListState(bookedOutEquipmentList, { kind: 'error', message: 'Unable to load booked-out equipment.' });
      renderListState(kitManagementList, { kind: 'error', message: 'Unable to load kits.' });
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
    } else {
      bookedOutLoans = Array.isArray(bookedOutResult.loans) ? bookedOutResult.loans : [];
      renderBookedOutLoans();
    }

    if (kitsResult.error) {
      renderListState(kitManagementList, { kind: 'error', message: kitsResult.error });
      return;
    }

    kits = Array.isArray(kitsResult.kits) ? kitsResult.kits : [];
    renderKits();

    // Refresh the equipment picker options in the (currently empty, not-being-edited)
    // item editor rows now that the equipment list may have changed.
    if (!kitEditingIdInput.value && kitItemsEditor.children.length === 0) {
      kitItemsEditor.innerHTML = renderKitItemRow();
    }
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

    const conditionButton = target.closest('[data-action="toggle-unit-condition"]');
    if (conditionButton) {
      const unitId = Number(conditionButton.dataset.unitId);
      if (!Number.isFinite(unitId)) return;

      const nextCondition = conditionButton.dataset.currentCondition === 'damaged' ? 'working' : 'damaged';

      const result = await requestJson(`/api/admin/equipment/units/${unitId}/condition`, {
        method: 'PATCH',
        body: JSON.stringify({ condition: nextCondition })
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

    const policyButton = target.closest('[data-action="save-equipment-policy"]');
    if (policyButton) {
      const equipmentId = Number(policyButton.dataset.equipmentId);
      if (!Number.isFinite(equipmentId)) return;

      const checkbox = equipmentManagementList.querySelector(`[data-policy-field="requiresApproval"][data-equipment-id="${equipmentId}"]`);

      const result = await requestJson(`/api/admin/equipment/${equipmentId}/policy`, {
        method: 'PATCH',
        body: JSON.stringify({ requiresApproval: Boolean(checkbox?.checked) })
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

  kitAddItemRowButton.addEventListener('click', () => {
    kitItemsEditor.insertAdjacentHTML('beforeend', renderKitItemRow());
  });

  kitItemsEditor.addEventListener('click', (event) => {
    const removeButton = event.target instanceof HTMLElement ? event.target.closest('[data-action="remove-kit-item-row"]') : null;
    if (!removeButton) return;
    removeButton.closest('.kit-item-row')?.remove();
  });

  kitFormCancelEditButton.addEventListener('click', () => {
    resetKitForm();
  });

  /**
   * Read the current kit item rows into a validated payload for the create/update request.
   * @returns {{ error: string }|{ items: Array<{ equipmentId: number, quantity: number }> }}
   */
  function collectKitItemsFromForm() {
    const rows = Array.from(kitItemsEditor.querySelectorAll('.kit-item-row'));
    const items = [];
    for (const row of rows) {
      const equipmentSelect = row.querySelector('.kit-item-equipment');
      const quantityInput = row.querySelector('.kit-item-quantity');
      const equipmentId = Number(equipmentSelect?.value);
      const quantity = Number(quantityInput?.value);

      if (!equipmentSelect?.value) continue; // skip rows the admin left blank

      if (!Number.isFinite(equipmentId) || equipmentId <= 0) {
        return { error: 'Each kit item must reference a valid equipment selection.' };
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return { error: 'Each kit item quantity must be a whole number greater than 0.' };
      }
      items.push({ equipmentId, quantity });
    }

    if (items.length === 0) {
      return { error: 'A kit must contain at least one equipment item.' };
    }

    return { items };
  }

  /**
   * Handle kit create/update submissions, switching request method based on
   * whether an existing kit is currently being edited.
   * @param {SubmitEvent} event
   * @returns {Promise<void>}
   */
  async function handleKitManagementFormSubmit(event) {
    event.preventDefault();
    kitManagementError.textContent = '';

    const name = kitNameInput.value.trim();
    if (!name) {
      kitManagementError.textContent = 'Kit name is required.';
      return;
    }

    const parsed = collectKitItemsFromForm();
    if (parsed.error) {
      kitManagementError.textContent = parsed.error;
      return;
    }

    const editingId = kitEditingIdInput.value;
    const result = await requestJson(editingId ? `/api/admin/kits/${editingId}` : '/api/admin/kits', {
      method: editingId ? 'PATCH' : 'POST',
      body: JSON.stringify({ name, items: parsed.items })
    });

    if (result.error) {
      kitManagementError.textContent = result.error;
      return;
    }

    resetKitForm();
    await load();
  }

  kitManagementForm.addEventListener('submit', handleKitManagementFormSubmit);

  /**
   * Handle edit and removal actions from the rendered kit list.
   * @param {MouseEvent} event
   * @returns {Promise<void>}
   */
  async function handleKitManagementListClick(event) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;

    const editButton = target.closest('[data-action="edit-kit"]');
    if (editButton) {
      const kitId = Number(editButton.dataset.kitId);
      const kit = kits.find((entry) => entry.id === kitId);
      if (!kit) return;

      kitEditingIdInput.value = String(kit.id);
      kitNameInput.value = kit.name;
      kitItemsEditor.innerHTML = kit.items.length > 0
        ? kit.items.map((item) => renderKitItemRow(item.equipmentId, item.quantity)).join('')
        : renderKitItemRow();
      kitFormSubmitButton.textContent = 'Update kit';
      kitFormCancelEditButton.classList.remove('hidden');
      kitManagementError.textContent = '';
      kitManagementForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    const removeButton = target.closest('[data-action="remove-kit"]');
    if (!removeButton) return;

    const kitId = Number(removeButton.dataset.kitId);
    if (!Number.isFinite(kitId)) return;

    const kit = kits.find((entry) => entry.id === kitId);
    const kitName = kit?.name || 'this kit';

    if (!confirm(`Are you sure you want to remove ${kitName}? Existing loans created from it are unaffected.`)) {
      return;
    }

    const result = await requestJson(`/api/admin/kits/${kitId}`, { method: 'DELETE' });
    if (result.error) {
      kitManagementError.textContent = result.error;
      return;
    }

    if (kitEditingIdInput.value === String(kitId)) {
      resetKitForm();
    }
    kitManagementError.textContent = '';
    await load();
  }

  kitManagementList.addEventListener('click', handleKitManagementListClick);

  resetKitForm();

  return {
    load
  };
}
