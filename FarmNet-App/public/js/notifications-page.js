import { renderListState } from './utils.js';

/**
 * @typedef {{
 *   notificationsList: HTMLElement,
 *   requestJson: (url: string, options?: RequestInit) => Promise<any>
 * }} NotificationsPageDeps
 */

/**
 * Create notifications page module.
 * @param {NotificationsPageDeps} deps
 */
export function createNotificationsPage(deps) {
  const { notificationsList, requestJson } = deps;

  function renderNotifications(notifications) {
    if (!notificationsList) return;
    if (!notifications || notifications.length === 0) {
      renderListState(notificationsList, { kind: 'empty', message: 'No notifications at this time.' });
      return;
    }

    notificationsList.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'admin-users-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Type</th>
          <th>When</th>
          <th>Subject</th>
          <th>Body</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    notifications.forEach((n) => {
      const row = document.createElement('tr');
      const typeCell = document.createElement('td');
      typeCell.textContent = n.equipmentName ? `Equipment: ${n.equipmentName}` : 'Notification';

      const whenCell = document.createElement('td');
      whenCell.textContent = n.returnDate || '-';

      const subjectCell = document.createElement('td');
      subjectCell.textContent = n.subject || '-';

      const bodyCell = document.createElement('td');
      bodyCell.textContent = n.body || '-';

      const actionsCell = document.createElement('td');
      const requestExt = document.createElement('button');
      requestExt.className = 'action-button';
      requestExt.textContent = 'Request extension';
      requestExt.addEventListener('click', async () => {
        const daysInput = prompt('How many extra days do you need? (integer)');
        if (daysInput === null) return;
        const extraDays = Number(daysInput);
        if (!Number.isFinite(extraDays) || !Number.isInteger(extraDays) || extraDays <= 0) {
          alert('Please enter a positive integer number of days.');
          return;
        }

        // compute new return date client-side
        const current = new Date(n.returnDate + 'T00:00:00');
        current.setDate(current.getDate() + extraDays);
        const newReturnDate = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;

        const result = await requestJson('/api/edit-loan', {
          method: 'POST',
          body: JSON.stringify({ loanId: n.loanId, returnDate: newReturnDate })
        });
        if (result?.error) alert(result.error);
        else {
          alert(result.message || 'Loan return date updated.');
          // reload notifications
          load();
        }
      });

      actionsCell.appendChild(requestExt);

      row.appendChild(typeCell);
      row.appendChild(whenCell);
      row.appendChild(subjectCell);
      row.appendChild(bodyCell);
      row.appendChild(actionsCell);
      tbody.appendChild(row);
    });

    notificationsList.appendChild(table);
  }

  async function load() {
    if (!notificationsList) return;
    renderListState(notificationsList, { kind: 'loading', message: 'Loading notifications...' });
    try {
      const result = await requestJson('/api/notifications/mine');
      if (result?.error) {
        renderListState(notificationsList, { kind: 'error', message: result.error });
      } else {
        renderNotifications(result.notifications || result);
      }
    } catch (err) {
      renderListState(notificationsList, { kind: 'error', message: 'Unable to load notifications.' });
    }
  }

  return { load };
}
