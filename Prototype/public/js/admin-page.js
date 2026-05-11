/**
 * User management page module.
 * Renders users and allows admins to change roles.
 */

/**
 * @typedef {{ id: number, email: string, role: 'user' | 'admin' }} User
 */

/**
 * Create user management page renderer and actions.
 * @param {{
 *   usersList: HTMLElement,
 *   adminBookingsList: HTMLElement,
 *   adminLoansList: HTMLElement,
 *   auditLogList: HTMLElement,
 *   requestJson: (url: string, options?: RequestInit) => Promise<any>
 * }} deps
 */
export function createAdminPage(deps) {
  const { usersList, adminBookingsList, adminLoansList, auditLogList, requestJson } = deps;

  /**
   * Change role for one user and refresh data.
   * @param {number} userId
   * @param {'user'|'admin'} role
   * @param {HTMLSelectElement} select
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
   */
  function render(users) {
    if (!users || users.length === 0) {
      usersList.innerHTML = '<p>No users found.</p>';
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
   * @param {Array<{ id: number, userEmail: string, roomName: string, date: string, startTime: string, durationHours: number|string, status: string }>} bookings
   */
  function renderBookings(bookings) {
    if (!bookings || bookings.length === 0) {
      adminBookingsList.innerHTML = '<p>No bookings found.</p>';
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
      const isEditable = booking.status === 'active' && new Date(`${booking.date}T${booking.startTime}:00`) > new Date();

      if (isEditable) {
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

        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'request-actions';
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
    * @param {Array<{ id: number, userEmail: string, equipmentName: string, equipmentCode?: string, borrowDate: string, returnDate: string, status: string, returnCondition?: string, returnConditionPhotoPath?: string }>} loans
   */
  function renderLoans(loans) {
    if (!loans || loans.length === 0) {
      adminLoansList.innerHTML = '<p>No loans found.</p>';
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
   */
  function formatHours(hours) {
    const value = Number(hours);
    if (!Number.isFinite(value)) return 'unknown';
    return value === 1 ? '1 hour' : `${value} hours`;
  }

  /**
   * Render audit log entries.
   * @param {Array<{ id: number, description: string, timestamp: string }>} entries
   */
  function renderAuditLog(entries) {
    if (!entries || entries.length === 0) {
      auditLogList.innerHTML = '<p>No audit log entries yet.</p>';
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

  usersList.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-action="admin-delete-user"]');
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
  });

  adminBookingsList.addEventListener('click', async (event) => {
    const editButton = event.target.closest('[data-action="admin-edit-booking"]');
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

    const cancelButton = event.target.closest('[data-action="admin-cancel-booking"]');
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
  });

  adminLoansList.addEventListener('click', async (event) => {
    const editButton = event.target.closest('[data-action="admin-edit-loan"]');
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

    const cancelButton = event.target.closest('[data-action="admin-cancel-loan"]');
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
  });

  /**
   * Fetch users and render table.
   */
  async function load() {
    usersList.innerHTML = '<p>Loading users...</p>';
    adminBookingsList.innerHTML = '<p>Loading bookings...</p>';
    adminLoansList.innerHTML = '<p>Loading loans...</p>';
    auditLogList.innerHTML = '<p>Loading audit log...</p>';

    let usersResult;
    let bookingsResult;
    let loansResult;
    let auditResult;
    try {
      [usersResult, bookingsResult, loansResult, auditResult] = await Promise.all([
        requestJson('/api/admin/users'),
        requestJson('/api/admin/bookings?status=all'),
        requestJson('/api/admin/loans?status=all'),
        requestJson('/api/admin/audit-log')
      ]);
    } catch (err) {
      usersList.innerHTML = '<p class="form-error">Failed to load users.</p>';
      adminBookingsList.innerHTML = '<p class="form-error">Failed to load bookings.</p>';
      adminLoansList.innerHTML = '<p class="form-error">Failed to load loans.</p>';
      auditLogList.innerHTML = '<p class="form-error">Audit log unavailable.</p>';
      return;
    }

    if (usersResult.error) {
      usersList.innerHTML = `<p class="form-error">${usersResult.error}</p>`;
    } else {
      render(usersResult.users || []);
    }

    if (bookingsResult.error) {
      adminBookingsList.innerHTML = `<p class="form-error">${bookingsResult.error}</p>`;
    } else {
      renderBookings(bookingsResult.bookings || []);
    }

    if (loansResult.error) {
      adminLoansList.innerHTML = `<p class="form-error">${loansResult.error}</p>`;
    } else {
      renderLoans(loansResult.loans || []);
    }

    if (auditResult.error) {
      auditLogList.innerHTML = `<p class="form-error">${auditResult.error}</p>`;
      return;
    }

    renderAuditLog(auditResult.entries || []);
  }

  return {
    load
  };
}
