/**
 * User management page module.
 * Renders users, bookings, loans, and audit data for admin actions.
 */

import { renderListState } from './utils.js';

/**
 * @typedef {{ id: number, email: string, role: 'user' | 'admin' }} User
 */

/**
 * @typedef {{ id: number, userEmail: string, roomName: string, date: string, startTime: string, durationHours: number|string, status: string, seriesId?: number|null, seriesPosition?: number|null, seriesTotal?: number|null }} AdminBooking
 */

/**
 * @typedef {{ id: number, userEmail: string, equipmentName: string, equipmentCode?: string, borrowDate: string, returnDate: string, status: string, returnCondition?: string, returnConditionPhotoPath?: string }} AdminLoan
 */

/**
 * @typedef {{ id: number, description: string, timestamp: string }} AuditLogEntry
 */

/**
 * @typedef {{
 *   id: number,
 *   loanId: number,
 *   description: string,
 *   photoPath?: string,
 *   createdAt: string,
 *   reportedByEmail: string,
 *   borrowerEmail: string,
 *   equipmentName: string,
 *   equipmentCode?: string,
 *   borrowDate: string,
 *   returnDate: string
 * }} DamageReport
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
 *   reports?: DamageReport[],
 *   error?: string
 * }} DamageReportsResponse
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
 *   damageReportsList: HTMLElement,
 *   auditLogList: HTMLElement,
 *   adminNotificationsList: HTMLElement,
 *   adminNotificationsDays: HTMLInputElement,
 *   adminNotificationsRefresh: HTMLElement,
 *   adminNotificationsEscalation: HTMLInputElement,
 *   adminNotificationsLevels: HTMLInputElement,
 *   requestJson: (url: string, options?: RequestInit) => Promise<any>,
 *   onReturnLoan: (loanId: number) => void
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
  const { usersList, adminBookingsList, adminLoansList, damageReportsList, auditLogList, adminNotificationsList, adminNotificationsDays, adminNotificationsRefresh, adminNotificationsEscalation, adminNotificationsLevels, requestJson, onReturnLoan } = deps;

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
      if (booking.seriesId != null) {
        const recurringBadge = document.createElement('span');
        recurringBadge.className = 'status-label recurring';
        recurringBadge.style.marginLeft = '6px';
        recurringBadge.textContent = (booking.seriesPosition != null && booking.seriesTotal != null)
          ? `Recurring · ${booking.seriesPosition} of ${booking.seriesTotal}`
          : 'Recurring';
        statusCell.appendChild(recurringBadge);
      }

      const actionsCell = document.createElement('td');
      const isPending = booking.status === 'pending';
      const isRecurring = booking.seriesId != null;
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

          if (isRecurring) {
            const approveSeriesButton = document.createElement('button');
            approveSeriesButton.className = 'action-button';
            approveSeriesButton.textContent = 'Approve series';
            approveSeriesButton.dataset.action = 'admin-approve-booking-series';
            approveSeriesButton.dataset.seriesId = String(booking.seriesId);

            const denySeriesButton = document.createElement('button');
            denySeriesButton.className = 'cancel-button';
            denySeriesButton.textContent = 'Deny series';
            denySeriesButton.dataset.action = 'admin-deny-booking-series';
            denySeriesButton.dataset.seriesId = String(booking.seriesId);

            actionsWrap.appendChild(approveSeriesButton);
            actionsWrap.appendChild(denySeriesButton);
          }
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

        if (isRecurring) {
          const cancelSeriesButton = document.createElement('button');
          cancelSeriesButton.className = 'cancel-button';
          cancelSeriesButton.textContent = 'Cancel series';
          cancelSeriesButton.dataset.action = 'admin-cancel-booking-series';
          cancelSeriesButton.dataset.seriesId = String(booking.seriesId);
          actionsWrap.appendChild(cancelSeriesButton);
        }

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
      if (loan.kitName) {
        const kitBadge = document.createElement('span');
        kitBadge.className = 'status-label recurring';
        kitBadge.style.marginLeft = '6px';
        kitBadge.textContent = `Kit: ${loan.kitName}`;
        equipmentCell.appendChild(kitBadge);
      }

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
      const isPending = loan.status === 'pending';
      const isEditable = loan.status === 'active' && loan.returnDate >= today;

      if (isPending) {
        const approveButton = document.createElement('button');
        approveButton.className = 'action-button';
        approveButton.textContent = 'Approve';
        approveButton.dataset.action = 'admin-approve-loan';
        approveButton.dataset.loanId = String(loan.id);

        const denyButton = document.createElement('button');
        denyButton.className = 'cancel-button';
        denyButton.textContent = 'Deny';
        denyButton.dataset.action = 'admin-deny-loan';
        denyButton.dataset.loanId = String(loan.id);

        const cancelButton = document.createElement('button');
        cancelButton.className = 'cancel-button';
        cancelButton.textContent = 'Cancel';
        cancelButton.dataset.action = 'admin-cancel-loan';
        cancelButton.dataset.loanId = String(loan.id);

        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'request-actions';
        actionsWrap.appendChild(approveButton);
        actionsWrap.appendChild(denyButton);
        actionsWrap.appendChild(cancelButton);

        if (loan.kitLoanGroupId != null) {
          const approveKitButton = document.createElement('button');
          approveKitButton.className = 'action-button';
          approveKitButton.textContent = 'Approve kit';
          approveKitButton.dataset.action = 'admin-approve-kit-loan';
          approveKitButton.dataset.kitLoanGroupId = String(loan.kitLoanGroupId);

          const denyKitButton = document.createElement('button');
          denyKitButton.className = 'cancel-button';
          denyKitButton.textContent = 'Deny kit';
          denyKitButton.dataset.action = 'admin-deny-kit-loan';
          denyKitButton.dataset.kitLoanGroupId = String(loan.kitLoanGroupId);

          actionsWrap.appendChild(approveKitButton);
          actionsWrap.appendChild(denyKitButton);
        }

        actionsCell.appendChild(actionsWrap);
      } else if (isEditable) {
        const returnButton = document.createElement('button');
        returnButton.className = 'action-button';
        returnButton.textContent = 'Return';
        returnButton.dataset.action = 'admin-return-loan';
        returnButton.dataset.loanId = String(loan.id);

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
        actionsWrap.appendChild(returnButton);
        actionsWrap.appendChild(editButton);
        actionsWrap.appendChild(cancelButton);

        if (loan.kitLoanGroupId != null) {
          const cancelKitButton = document.createElement('button');
          cancelKitButton.className = 'cancel-button';
          cancelKitButton.textContent = 'Cancel kit';
          cancelKitButton.dataset.action = 'admin-cancel-kit-loan';
          cancelKitButton.dataset.kitLoanGroupId = String(loan.kitLoanGroupId);
          actionsWrap.appendChild(cancelKitButton);
        }

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
   * Render the damage reports table. Each row links back to the loan it was filed against.
    * @param {DamageReport[]} reports
    * @returns {void}
   */
  function renderDamageReports(reports) {
    if (!reports || reports.length === 0) {
      renderListState(damageReportsList, { kind: 'empty', message: 'No damage reports filed yet.' });
      return;
    }

    damageReportsList.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'admin-users-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Loan</th>
          <th>Equipment</th>
          <th>Borrower</th>
          <th>Reported By</th>
          <th>Description</th>
          <th>Photo</th>
          <th>Reported</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    reports.forEach((report) => {
      const row = document.createElement('tr');

      const loanCell = document.createElement('td');
      loanCell.textContent = `#${report.loanId} (${report.borrowDate} to ${report.returnDate})`;

      const equipmentCell = document.createElement('td');
      equipmentCell.textContent = report.equipmentCode
        ? `${report.equipmentName} (${report.equipmentCode})`
        : report.equipmentName;

      const borrowerCell = document.createElement('td');
      borrowerCell.textContent = report.borrowerEmail;

      const reporterCell = document.createElement('td');
      reporterCell.textContent = report.reportedByEmail;

      const descriptionCell = document.createElement('td');
      descriptionCell.textContent = report.description;

      const photoCell = document.createElement('td');
      if (report.photoPath) {
        const link = document.createElement('a');
        link.href = `/api/admin/damage-reports/${report.id}/photo`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'View photo';
        photoCell.appendChild(link);
      } else {
        photoCell.textContent = 'None';
      }

      const reportedCell = document.createElement('td');
      reportedCell.textContent = new Date(report.createdAt).toLocaleString();

      row.appendChild(loanCell);
      row.appendChild(equipmentCell);
      row.appendChild(borrowerCell);
      row.appendChild(reporterCell);
      row.appendChild(descriptionCell);
      row.appendChild(photoCell);
      row.appendChild(reportedCell);
      tbody.appendChild(row);
    });

    damageReportsList.appendChild(table);
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
   * Render generated notification previews.
   * @param {Array<any>} notifications
   */
  function renderNotifications(notifications) {
    if (!adminNotificationsList) return;
    if (!notifications || notifications.length === 0) {
      renderListState(adminNotificationsList, { kind: 'empty', message: 'No notifications generated for the selected window.' });
      return;
    }

    adminNotificationsList.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'admin-users-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Recipient</th>
          <th>Equipment</th>
          <th>Return Date</th>
          <th>Days Left</th>
          <th>Subject</th>
          <th>Body</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    notifications.forEach((n) => {
      const row = document.createElement('tr');
      const recipient = document.createElement('td'); recipient.textContent = n.recipientEmail || '-';
      const equipment = document.createElement('td'); equipment.textContent = n.unitCode ? `${n.equipmentName} (${n.unitCode})` : (n.equipmentName || '-');
      const returnDate = document.createElement('td'); returnDate.textContent = n.returnDate || '-';
      const daysLeft = document.createElement('td'); daysLeft.textContent = String(n.daysRemaining ?? '-');
      const subject = document.createElement('td'); subject.textContent = n.subject || '-';
      const body = document.createElement('td'); body.textContent = n.body || '-';

      row.appendChild(recipient);
      row.appendChild(equipment);
      row.appendChild(returnDate);
      row.appendChild(daysLeft);
      row.appendChild(subject);
      row.appendChild(body);
      tbody.appendChild(row);
    });

    adminNotificationsList.appendChild(table);
  }

  async function loadNotifications() {
    if (!adminNotificationsList) return;
    renderListState(adminNotificationsList, { kind: 'loading', message: 'Loading notifications...' });
    try {
      if (adminNotificationsEscalation && adminNotificationsEscalation.checked) {
        const levelsRaw = String(adminNotificationsLevels?.value || '3,7,14');
        const levels = levelsRaw.split(',').map((s) => s.trim()).filter(Boolean).join(',');
        const result = await requestJson(`/api/notifications/overdue-escalations?levels=${encodeURIComponent(levels)}`);
        if (result?.error) {
          renderListState(adminNotificationsList, { kind: 'error', message: result.error });
        } else {
          renderNotifications(result.notifications || result);
        }
        return;
      }

      const days = Number(adminNotificationsDays?.value) || 3;
      const result = await requestJson(`/api/notifications/equipment-due?days=${encodeURIComponent(days)}`);
      if (result?.error) {
        renderListState(adminNotificationsList, { kind: 'error', message: result.error });
      } else {
        renderNotifications(result.notifications || result); // support both shapes
      }
    } catch (err) {
      renderListState(adminNotificationsList, { kind: 'error', message: 'Unable to load notifications.' });
    }
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

    const approveSeriesButton = target.closest('[data-action="admin-approve-booking-series"]');
    if (approveSeriesButton) {
      const seriesId = Number(approveSeriesButton.dataset.seriesId);
      if (!confirm('Approve every pending occurrence in this series?')) return;

      const result = await requestJson(`/api/admin/bookings/series/${seriesId}/approve`, {
        method: 'POST'
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Series approved.');
      }

      await load();
      return;
    }

    const denySeriesButton = target.closest('[data-action="admin-deny-booking-series"]');
    if (denySeriesButton) {
      const seriesId = Number(denySeriesButton.dataset.seriesId);
      const reason = prompt('Optional reason for denying every pending occurrence in this series:', '');
      if (reason === null) return;

      const result = await requestJson(`/api/admin/bookings/series/${seriesId}/deny`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Series denied.');
      }

      await load();
      return;
    }

    const cancelSeriesButton = target.closest('[data-action="admin-cancel-booking-series"]');
    if (cancelSeriesButton) {
      const seriesId = Number(cancelSeriesButton.dataset.seriesId);
      if (!confirm('Cancel every upcoming occurrence in this series?')) return;

      const result = await requestJson(`/api/admin/bookings/series/${seriesId}/cancel`, {
        method: 'POST'
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Series cancelled.');
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

    const returnButton = target.closest('[data-action="admin-return-loan"]');
    if (returnButton) {
      const loanId = Number(returnButton.dataset.loanId);
      onReturnLoan(loanId);
      return;
    }

    const approveButton = target.closest('[data-action="admin-approve-loan"]');
    if (approveButton) {
      const loanId = Number(approveButton.dataset.loanId);
      const result = await requestJson(`/api/admin/loans/${loanId}/approve`, {
        method: 'POST'
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Equipment request approved.');
      }

      await load();
      return;
    }

    const denyButton = target.closest('[data-action="admin-deny-loan"]');
    if (denyButton) {
      const loanId = Number(denyButton.dataset.loanId);
      const reason = prompt('Optional reason for denying this equipment request:', '');
      if (reason === null) return;

      const result = await requestJson(`/api/admin/loans/${loanId}/deny`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Equipment request denied.');
      }

      await load();
      return;
    }

    const approveKitButton = target.closest('[data-action="admin-approve-kit-loan"]');
    if (approveKitButton) {
      const groupId = Number(approveKitButton.dataset.kitLoanGroupId);
      const result = await requestJson(`/api/admin/kit-loans/${groupId}/approve`, {
        method: 'POST'
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Kit request approved.');
      }

      await load();
      return;
    }

    const denyKitButton = target.closest('[data-action="admin-deny-kit-loan"]');
    if (denyKitButton) {
      const groupId = Number(denyKitButton.dataset.kitLoanGroupId);
      const reason = prompt('Optional reason for denying this kit request:', '');
      if (reason === null) return;

      const result = await requestJson(`/api/admin/kit-loans/${groupId}/deny`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Kit request denied.');
      }

      await load();
      return;
    }

    const cancelKitButton = target.closest('[data-action="admin-cancel-kit-loan"]');
    if (cancelKitButton) {
      const groupId = Number(cancelKitButton.dataset.kitLoanGroupId);
      if (!confirm('Cancel every item in this kit request?')) return;

      const result = await requestJson(`/api/admin/kit-loans/${groupId}/cancel`, {
        method: 'POST'
      });

      if (result.error) {
        alert(result.error);
      } else {
        alert(result.message || 'Kit request cancelled.');
      }

      await load();
      return;
    }

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
    renderListState(damageReportsList, { kind: 'loading', message: 'Loading damage reports...' });
    renderListState(auditLogList, { kind: 'loading', message: 'Loading audit log...' });

    /** @type {UsersResponse} */
    let usersResult;
    /** @type {AdminBookingsResponse} */
    let bookingsResult;
    /** @type {AdminLoansResponse} */
    let loansResult;
    /** @type {DamageReportsResponse} */
    let damageReportsResult;
    /** @type {AuditLogResponse} */
    let auditResult;
    try {
      [usersResult, bookingsResult, loansResult, damageReportsResult, auditResult] = await Promise.all([
        requestJson('/api/admin/users'),
        requestJson('/api/admin/bookings?status=all'),
        requestJson('/api/admin/loans?status=all'),
        requestJson('/api/admin/damage-reports'),
        requestJson('/api/admin/audit-log')
      ]);
    } catch (err) {
      renderListState(usersList, { kind: 'error', message: 'Unable to load users.' });
      renderListState(adminBookingsList, { kind: 'error', message: 'Unable to load bookings.' });
      renderListState(adminLoansList, { kind: 'error', message: 'Unable to load loans.' });
      renderListState(damageReportsList, { kind: 'error', message: 'Unable to load damage reports.' });
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

    if (damageReportsResult.error) {
      renderListState(damageReportsList, { kind: 'error', message: damageReportsResult.error });
    } else {
      renderDamageReports(damageReportsResult.reports || []);
    }

    if (auditResult.error) {
      renderListState(auditLogList, { kind: 'error', message: auditResult.error });
      return;
    }

    renderAuditLog(auditResult.entries || []);

    // Load notifications preview last (independent of other sections)
    loadNotifications();
  }

  // Wire up refresh control for notifications preview
  if (adminNotificationsRefresh) {
    adminNotificationsRefresh.addEventListener('click', (e) => {
      e.preventDefault();
      loadNotifications();
    });
  }

  return {
    load
  };
}
