/**
 * User management page module.
 * Renders users, bookings, loans, and audit data for admin actions.
 */

import { renderListState } from './utils.js';

/**
 * @typedef {{ id: number, email: string, role: 'user' | 'admin' }} User
 */

/**
 * @typedef {{ id: number, userEmail: string, roomName: string, date: string, startTime: string, durationHours: number|string, status: string }} AdminBooking
 */

/**
 * @typedef {{ id: number, userEmail: string, equipmentName: string, equipmentCode?: string, borrowDate: string, returnDate: string, status: string, returnCondition?: string, returnConditionPhotoPath?: string }} AdminLoan
 */

/**
 * @typedef {{ id: number, description: string, timestamp: string }} AuditLogEntry
 */

/**
 * @typedef {{
 *   users?: User[],
 *   error?: string
 * }} UsersResponse
 */

/**
 * @typedef {{
 *   bookings?: AdminBooking[],
 *   error?: string
 * }} AdminBookingsResponse
 */

/**
 * @typedef {{
 *   loans?: AdminLoan[],
 *   error?: string
 * }} AdminLoansResponse
 */

/**
 * @typedef {{
 *   entries?: AuditLogEntry[],
 *   error?: string
 * }} AuditLogResponse
 */

/**
 * @typedef {{
 *   usersList: HTMLElement,
 *   adminBookingsList: HTMLElement,
 *   adminLoansList: HTMLElement,
 *   auditLogList: HTMLElement,
 *   requestJson: (url: string, options?: RequestInit) => Promise<any>
 * }} AdminPageDeps
 */

/**
 * @typedef {{
 *   load: () => Promise<void>
 * }} AdminPageApi
 */

/**
 * Create user management page renderer and actions.
 * @param {AdminPageDeps} deps
 * @returns {AdminPageApi} Admin page API.
 */
export function createAdminPage(deps) {
  const { usersList, adminBookingsList, adminLoansList, auditLogList, requestJson } = deps;

  /**
   * Change role for one user and refresh data.
   * @param {number} userId
   * @param {'user'|'admin'} role
   * @param {HTMLSelectElement} select
    * @returns {Promise<void>}
   */
  async function updateRole(userId, role, select) {
    const result = await requestJson(`/api/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role })
    });

    if (result.error) {
      alert(result.error);
      await load();
      return;
    }

    select.dataset.currentRole = role;
  }

  /**
   * Render users table.
    * @param {User[]} users
    * @returns {void}
   */
  function render(users) {
    if (!users || users.length === 0) {
      renderListState(usersList, { kind: 'empty', message: 'No users found.' });
      return;
    }

    usersList.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'admin-users-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Email</th>
          <th>Current role</th>
          <th>Change role</th>
          <th>Delete account</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    users.forEach((user) => {
      const row = document.createElement('tr');

      const emailCell = document.createElement('td');
      emailCell.textContent = user.email;

      const roleCell = document.createElement('td');
      roleCell.textContent = user.role;

      const actionCell = document.createElement('td');
      const select = document.createElement('select');
      select.className = 'admin-role-select';
      select.dataset.currentRole = user.role;
      select.innerHTML = `
        <option value="user">user</option>
        <option value="admin">admin</option>
      `;
      select.value = user.role;

      select.addEventListener('change', async () => {
        const nextRole = select.value;
        const previousRole = select.dataset.currentRole || user.role;

        select.disabled = true;
        await updateRole(user.id, /** @type {'user'|'admin'} */ (nextRole), select);
        select.disabled = false;

        if (select.dataset.currentRole !== nextRole) {
          select.value = previousRole;
          return;
        }

        roleCell.textContent = nextRole;
      });

      actionCell.appendChild(select);

      const deleteCell = document.createElement('td');
      const deleteButton = document.createElement('button');
      deleteButton.className = 'cancel-button';
      deleteButton.textContent = 'Delete';
      deleteButton.dataset.action = 'admin-delete-user';
      deleteButton.dataset.userId = String(user.id);
      deleteButton.dataset.userEmail = user.email;
      deleteCell.appendChild(deleteButton);

      row.appendChild(emailCell);
      row.appendChild(roleCell);
      row.appendChild(actionCell);
      row.appendChild(deleteCell);
      tbody.appendChild(row);
    });

    usersList.appendChild(table);
  }

  /**
   * Render booking management table.
    * @param {AdminBooking[]} bookings
    * @returns {void}
   */
  function renderBookings(bookings) {
    if (!bookings || bookings.length === 0) {
      renderListState(adminBookingsList, { kind: 'empty', message: 'No bookings found.' });
      return;
    }

    adminBookingsList.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'admin-users-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>User</th>
          <th>Room</th>
          <th>When</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    bookings.forEach((booking) => {
      const row = document.createElement('tr');

      const userCell = document.createElement('td');
      userCell.textContent = booking.userEmail;

      const roomCell = document.createElement('td');
      roomCell.textContent = booking.roomName;

      const whenCell = document.createElement('td');
      whenCell.textContent = `${booking.date} ${booking.startTime} (${formatHours(booking.durationHours)})`;

      const statusCell = document.createElement('td');
      statusCell.textContent = booking.status;

      const actionsCell = document.createElement('td');
      const isPending = booking.status === 'pending';
      const isActionable = (booking.status === 'active' || isPending) && new Date(`${booking.date}T${booking.startTime}:00`) > new Date();

      if (isActionable) {
        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'request-actions';

        if (isPending) {
          const approveButton = document.createElement('button');
          approveButton.className = 'action-button';
          approveButton.textContent = 'Approve';
          approveButton.dataset.action = 'admin-approve-booking';
          approveButton.dataset.bookingId = String(booking.id);

          const denyButton = document.createElement('button');
          denyButton.className = 'cancel-button';
          denyButton.textContent = 'Deny';
          denyButton.dataset.action = 'admin-deny-booking';
          denyButton.dataset.bookingId = String(booking.id);

          actionsWrap.appendChild(approveButton);
          actionsWrap.appendChild(denyButton);
        }

        const editButton = document.createElement('button');
        editButton.className = 'secondary action-button';
        editButton.textContent = 'Edit';
        editButton.dataset.action = 'admin-edit-booking';
        editButton.dataset.bookingId = String(booking.id);
        editButton.dataset.bookingDate = booking.date;
        editButton.dataset.bookingStartTime = booking.startTime;
        editButton.dataset.bookingDurationHours = String(booking.durationHours);

        const cancelButton = document.createElement('button');
        cancelButton.className = 'cancel-button';
        cancelButton.textContent = 'Cancel';
        cancelButton.dataset.action = 'admin-cancel-booking';
        cancelButton.dataset.bookingId = String(booking.id);

        actionsWrap.appendChild(editButton);
        actionsWrap.appendChild(cancelButton);
        actionsCell.appendChild(actionsWrap);
      } else {
        actionsCell.textContent = '-';
      }

      row.appendChild(userCell);
      row.appendChild(roomCell);
      row.appendChild(whenCell);
      row.appendChild(statusCell);
      row.appendChild(actionsCell);
      tbody.appendChild(row);
    });

    adminBookingsList.appendChild(table);
  }

  /**
   * Render loan management table.
    * @param {AdminLoan[]} loans
    * @returns {void}
   */
  function renderLoans(loans) {
    if (!loans || loans.length === 0) {
      renderListState(adminLoansList, { kind: 'empty', message: 'No loans found.' });
      return;
    }

    adminLoansList.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'admin-users-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>User</th>
          <th>Equipment</th>
          <th>Loan Window</th>
          <th>Return Condition / Photo</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    loans.forEach((loan) => {
      const row = document.createElement('tr');

      const userCell = document.createElement('td');
      userCell.textContent = loan.userEmail;

      const equipmentCell = document.createElement('td');
      equipmentCell.textContent = loan.equipmentCode
        ? `${loan.equipmentName} (${loan.equipmentCode})`
        : loan.equipmentName;

      const windowCell = document.createElement('td');
      windowCell.textContent = `${loan.borrowDate} to ${loan.returnDate}`;

      const returnStateCell = document.createElement('td');
      const conditionText = typeof loan.returnCondition === 'string' ? loan.returnCondition.trim() : '';
      const photoPath = typeof loan.returnConditionPhotoPath === 'string' ? loan.returnConditionPhotoPath.trim() : '';

      if (loan.status === 'returned') {
        const conditionLine = document.createElement('p');
        conditionLine.textContent = conditionText
          ? `Condition: ${conditionText}`
          : 'Condition: Not provided';

        const photoLine = document.createElement('p');
        if (photoPath) {
          photoLine.textContent = 'Photo: ';
          const link = document.createElement('a');
          link.href = `/api/admin/loans/${loan.id}/photo`;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'View photo';
          photoLine.appendChild(link);
        } else {
          photoLine.textContent = 'Photo: None';
        }

        returnStateCell.appendChild(conditionLine);
        returnStateCell.appendChild(photoLine);
      } else {
        returnStateCell.textContent = '-';
      }

      const statusCell = document.createElement('td');
      statusCell.textContent = loan.status;

      const actionsCell = document.createElement('td');
      const today = new Date().toISOString().slice(0, 10);
      const isEditable = loan.status === 'active' && loan.returnDate >= today;

      if (isEditable) {
        const editButton = document.createElement('button');
        editButton.className = 'secondary action-button';
        editButton.textContent = 'Edit';
        editButton.dataset.action = 'admin-edit-loan';
        editButton.dataset.loanId = String(loan.id);
        editButton.dataset.loanReturnDate = loan.returnDate;

        const cancelButton = document.createElement('button');
        cancelButton.className = 'cancel-button';
        cancelButton.textContent = 'Cancel';
        cancelButton.dataset.action = 'admin-cancel-loan';
        cancelButton.dataset.loanId = String(loan.id);

        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'request-actions';
        actionsWrap.appendChild(editButton);
        actionsWrap.appendChild(cancelButton);
        actionsCell.appendChild(actionsWrap);
      } else {
        actionsCell.textContent = '-';
      }

      row.appendChild(userCell);
      row.appendChild(equipmentCell);
      row.appendChild(windowCell);
      row.appendChild(returnStateCell);
      row.appendChild(statusCell);
      row.appendChild(actionsCell);
      tbody.appendChild(row);
    });

    adminLoansList.appendChild(table);
  }

  /**
   * Format duration to a compact hour label.
   * @param {number|string} hours
    * @returns {string}
   */
  function formatHours(hours) {
    const value = Number(hours);
    if (!Number.isFinite(value)) return 'unknown';
    return value === 1 ? '1 hour' : `${value} hours`;
  }

  /**
   * Render audit log entries.
    * @param {AuditLogEntry[]} entries
    * @returns {void}
   */
  function renderAuditLog(entries) {
    if (!entries || entries.length === 0) {
      renderListState(auditLogList, { kind: 'empty', message: 'No audit log entries yet.' });
      return;
    }

    const container = document.createElement('div');
    container.className = 'audit-log-list';

    entries.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'audit-log-item';

      const description = document.createElement('p');
      description.textContent = entry.description;

      const meta = document.createElement('p');
      meta.className = 'audit-log-meta';
      const when = new Date(entry.timestamp).toLocaleString();
      meta.textContent = `Logged: ${when}`;

      item.appendChild(description);
      item.appendChild(meta);
      container.appendChild(item);
    });

    auditLogList.innerHTML = '';
    auditLogList.appendChild(container);
  }

  /**
   * Handle clicks in the users table.
   * Uses event delegation to process delete actions from dynamic rows.
   * @param {MouseEvent} event
    * @returns {Promise<void>}
   */
  async function handleUsersListClick(event) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;

    const deleteButton = target.closest('[data-action="admin-delete-user"]');
    if (!deleteButton) return;

    const userId = Number(deleteButton.dataset.userId);
    const userEmail = deleteButton.dataset.userEmail || 'this user';

    if (!confirm(`Delete account for ${userEmail}? This also removes their bookings, loans, and activity history.`)) {
      return;
    }

    const result = await requestJson(`/api/admin/users/${userId}`, {
      method: 'DELETE'
    });

    if (result.error) {
      alert(result.error);
    } else {
      alert(result.message || 'User account deleted.');
    }

    await load();
  }

  usersList.addEventListener('click', handleUsersListClick);

  /**
   * Handle clicks in the bookings table.
   * Uses event delegation for edit and cancel operations.
   * @param {MouseEvent} event
    * @returns {Promise<void>}
   */
  async function handleAdminBookingsListClick(event) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;

    const approveButton = target.closest('[data-action="admin-approve-booking"]');
    if (approveButton) {
      const bookingId = Number(approveButton.dataset.bookingId);
      const result = await requestJson(`/api/admin/bookings/${bookingId}/approve`, {
        method: 'POST'
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Booking approved.');
      }

      await load();
      return;
    }

    const denyButton = target.closest('[data-action="admin-deny-booking"]');
    if (denyButton) {
      const bookingId = Number(denyButton.dataset.bookingId);
      const reason = prompt('Optional reason for denying this booking:', '');
      if (reason === null) return;

      const result = await requestJson(`/api/admin/bookings/${bookingId}/deny`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Booking denied.');
      }

      await load();
      return;
    }

    const editButton = target.closest('[data-action="admin-edit-booking"]');
    if (editButton) {
      const bookingId = Number(editButton.dataset.bookingId);
      const date = editButton.dataset.bookingDate || '';
      const startTime = editButton.dataset.bookingStartTime || '';
      const durationHours = editButton.dataset.bookingDurationHours || '';

      const nextDate = prompt('Enter a new booking date (YYYY-MM-DD):', date);
      if (nextDate === null) return;

      const nextStartTime = prompt('Enter a new booking start time (HH:MM):', startTime);
      if (nextStartTime === null) return;

      const nextDuration = prompt('Enter a new duration in hours (15-minute increments):', String(durationHours));
      if (nextDuration === null) return;

      const result = await requestJson(`/api/admin/bookings/${bookingId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          date: nextDate.trim(),
          startTime: nextStartTime.trim(),
          durationHours: Number(nextDuration)
        })
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Booking updated.');
      }

      await load();
      return;
    }

    const cancelButton = target.closest('[data-action="admin-cancel-booking"]');
    if (!cancelButton) return;

    const bookingId = Number(cancelButton.dataset.bookingId);
    if (!confirm('Cancel this booking?')) {
      return;
    }

    const result = await requestJson(`/api/admin/bookings/${bookingId}/cancel`, {
      method: 'POST'
    });

    if (result.error) {
      alert(result.error);
    } else {
      alert(result.message || 'Booking cancelled.');
    }

    await load();
  }

  adminBookingsList.addEventListener('click', handleAdminBookingsListClick);

  /**
   * Handle clicks in the loans table.
   * Uses event delegation for edit and cancel operations.
   * @param {MouseEvent} event
    * @returns {Promise<void>}
   */
  async function handleAdminLoansListClick(event) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;

    const editButton = target.closest('[data-action="admin-edit-loan"]');
    if (editButton) {
      const loanId = Number(editButton.dataset.loanId);
      const returnDate = editButton.dataset.loanReturnDate || '';

      const nextReturnDate = prompt('Enter a new return date (YYYY-MM-DD):', returnDate);
      if (nextReturnDate === null) return;

      const result = await requestJson(`/api/admin/loans/${loanId}`, {
        method: 'PATCH',
        body: JSON.stringify({ returnDate: nextReturnDate.trim() })
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Loan updated.');
      }

      await load();
      return;
    }

    const cancelButton = target.closest('[data-action="admin-cancel-loan"]');
    if (!cancelButton) return;

    const loanId = Number(cancelButton.dataset.loanId);
    if (!confirm('Cancel this loan?')) {
      return;
    }

    const result = await requestJson(`/api/admin/loans/${loanId}/cancel`, {
      method: 'POST'
    });

    if (result.error) {
      alert(result.error);
    } else {
      alert(result.message || 'Loan cancelled.');
    }

    await load();
  }

  adminLoansList.addEventListener('click', handleAdminLoansListClick);

  /**
   * Fetch all admin datasets in parallel and update each section.
   * This keeps sections resilient: one failed endpoint does not block
   * rendering of successful sections.
   * @returns {Promise<void>}
   */
  async function load() {
    renderListState(usersList, { kind: 'loading', message: 'Loading users...' });
    renderListState(adminBookingsList, { kind: 'loading', message: 'Loading bookings...' });
    renderListState(adminLoansList, { kind: 'loading', message: 'Loading loans...' });
    renderListState(auditLogList, { kind: 'loading', message: 'Loading audit log...' });

    /** @type {UsersResponse} */
    let usersResult;
    /** @type {AdminBookingsResponse} */
    let bookingsResult;
    /** @type {AdminLoansResponse} */
    let loansResult;
    /** @type {AuditLogResponse} */
    let auditResult;
    try {
      [usersResult, bookingsResult, loansResult, auditResult] = await Promise.all([
        requestJson('/api/admin/users'),
        requestJson('/api/admin/bookings?status=all'),
        requestJson('/api/admin/loans?status=all'),
        requestJson('/api/admin/audit-log')
      ]);
    } catch (err) {
      renderListState(usersList, { kind: 'error', message: 'Unable to load users.' });
      renderListState(adminBookingsList, { kind: 'error', message: 'Unable to load bookings.' });
      renderListState(adminLoansList, { kind: 'error', message: 'Unable to load loans.' });
      renderListState(auditLogList, { kind: 'error', message: 'Audit log unavailable.' });
      return;
    }

    if (usersResult.error) {
      renderListState(usersList, { kind: 'error', message: usersResult.error });
    } else {
      render(usersResult.users || []);
    }

    if (bookingsResult.error) {
      renderListState(adminBookingsList, { kind: 'error', message: bookingsResult.error });
    } else {
      renderBookings(bookingsResult.bookings || []);
    }

    if (loansResult.error) {
      renderListState(adminLoansList, { kind: 'error', message: loansResult.error });
    } else {
      renderLoans(loansResult.loans || []);
    }

    if (auditResult.error) {
      renderListState(auditLogList, { kind: 'error', message: auditResult.error });
      return;
    }

    renderAuditLog(auditResult.entries || []);
  }

  return {
    load
  };
}
