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
 *   auditLogList: HTMLElement,
 *   requestJson: (url: string, options?: RequestInit) => Promise<any>
 * }} deps
 */
export function createUserManagementPage(deps) {
  const { usersList, auditLogList, requestJson } = deps;

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
      row.appendChild(emailCell);
      row.appendChild(roleCell);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });

    usersList.appendChild(table);
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

  /**
   * Fetch users and render table.
   */
  async function load() {
    usersList.innerHTML = '<p>Loading users...</p>';
    auditLogList.innerHTML = '<p>Loading audit log...</p>';

    let usersResult;
    try {
      usersResult = await requestJson('/api/admin/users');
    } catch (err) {
      usersList.innerHTML = '<p class="form-error">Failed to load users.</p>';
      auditLogList.innerHTML = '<p class="form-error">Audit log unavailable.</p>';
      return;
    }

    if (usersResult.error) {
      usersList.innerHTML = `<p class="form-error">${usersResult.error}</p>`;
      auditLogList.innerHTML = '';
      return;
    }

    render(usersResult.users || []);

    try {
      const auditResult = await requestJson('/api/admin/audit-log');
      if (auditResult.error) {
        auditLogList.innerHTML = `<p class="form-error">${auditResult.error}</p>`;
      } else {
        renderAuditLog(auditResult.entries || []);
      }
    } catch (err) {
      auditLogList.innerHTML = '<p class="form-error">Audit log unavailable.</p>';
    }
  }

  return {
    load
  };
}
