import { requestJson } from './js/api.js';
import { showError, formatDuration, getTodayDateString, getNextQuarterTime } from './js/utils.js';
import { createDashboardPage } from './js/dashboard-page.js';
import { createRoomsPage } from './js/rooms-page.js';
import { createEquipmentPage } from './js/equipment-page.js';
import { createAdminPage } from './js/admin-page.js';

/**
 * Main frontend entrypoint.
 * Coordinates auth flow, page navigation, API orchestration, and page module rendering.
 */

const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const pageDashboard = document.getElementById('page-dashboard');
const pageRooms = document.getElementById('page-rooms');
const pageEquipment = document.getElementById('page-equipment');
const pageAdmin = document.getElementById('page-admin');
const navDashboard = document.getElementById('nav-dashboard');
const navRooms = document.getElementById('nav-rooms');
const navEquipment = document.getElementById('nav-equipment');
const navAdmin = document.getElementById('nav-admin');
const userStatus = document.getElementById('user-status');
const roomsList = document.getElementById('rooms-list');
const equipmentList = document.getElementById('equipment-list');
const usersList = document.getElementById('users-list');
const auditLogList = document.getElementById('audit-log-list');
const requestsList = document.getElementById('requests-list');
const bookingFilter = document.getElementById('booking-filter');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const logoutButton = document.getElementById('logout-button');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');
const bookingPanel = document.getElementById('booking-panel');
const bookingForm = document.getElementById('booking-form');
const bookingRoomName = document.getElementById('booking-room-name');
const bookingDateInput = document.getElementById('booking-date');
const bookingStartTimeInput = document.getElementById('booking-start-time');
const bookingDurationInput = document.getElementById('booking-duration');
const bookingError = document.getElementById('booking-error');
const bookingCancel = document.getElementById('booking-cancel');
const scheduleGrid = document.getElementById('schedule-grid');

const allPages = ['dashboard', 'rooms', 'equipment', 'admin'];

let isAdminUser = false;

/**
 * Resolve the active page from URL hash.
 * @returns {'dashboard'|'rooms'|'equipment'}
 */
function getPageFromHash() {
  const hashPage = window.location.hash.replace('#', '').trim();
  if (!allPages.includes(hashPage)) {
    return 'dashboard';
  }
  if (hashPage === 'admin' && !isAdminUser) {
    return 'dashboard';
  }
  return hashPage;
}

let activePage = getPageFromHash();

const tabs = document.querySelectorAll('.tab-button');
const panels = document.querySelectorAll('.tab-panel');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((button) => button.classList.remove('active'));
    panels.forEach((panel) => panel.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

/**
 * Clear authentication form error messages.
 */
function resetErrors() {
  showError(loginError, '');
  showError(registerError, '');
}

/**
 * Switch the visible dashboard sub-page and optionally sync URL hash.
 * @param {'dashboard'|'rooms'|'equipment'} page Target page.
 * @param {{ updateHash?: boolean }} [options={}] Options for hash behavior.
 */
function setActivePage(page, options = {}) {
  const updateHash = options.updateHash !== false;
  const requestedPage = allPages.includes(page) ? page : 'dashboard';
  const nextPage = requestedPage === 'admin' && !isAdminUser ? 'dashboard' : requestedPage;
  activePage = nextPage;

  pageDashboard.classList.toggle('hidden', nextPage !== 'dashboard');
  pageRooms.classList.toggle('hidden', nextPage !== 'rooms');
  pageEquipment.classList.toggle('hidden', nextPage !== 'equipment');
  pageAdmin.classList.toggle('hidden', nextPage !== 'admin');

  navDashboard.classList.toggle('active', nextPage === 'dashboard');
  navRooms.classList.toggle('active', nextPage === 'rooms');
  navEquipment.classList.toggle('active', nextPage === 'equipment');
  navAdmin.classList.toggle('active', nextPage === 'admin');

  if (nextPage !== 'rooms') {
    roomsPage.hideBookingPanel();
  }

  if (nextPage === 'admin' && isAdminUser) {
    adminPage.load();
  }

  if (updateHash) {
    const targetHash = `#${nextPage}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
  }
}

/**
 * Cancel an existing booking for the current user.
 * @param {number} bookingId Booking identifier.
 */
async function cancelBooking(bookingId) {
  if (!confirm('Are you sure you want to cancel this booking?')) return;

  const result = await requestJson('/api/cancel-booking', {
    method: 'POST',
    body: JSON.stringify({ bookingId })
  });

  if (result.error) {
    alert(result.error);
    return;
  }

  alert(result.message);
  await refreshDashboard(bookingFilter.value);
}

/**
 * Cancel an existing equipment loan for the current user.
 * @param {number} loanId Loan identifier.
 */
async function cancelLoan(loanId) {
  if (!confirm('Are you sure you want to cancel this loan?')) return;

  const result = await requestJson('/api/cancel-loan', {
    method: 'POST',
    body: JSON.stringify({ loanId })
  });

  if (result.error) {
    alert(result.error);
    return;
  }

  alert(result.message);
  await refreshDashboard(bookingFilter.value);
}

/**
 * Trigger an equipment borrow request for the selected item.
 * @param {number} equipmentId Equipment identifier.
 * @param {string} equipmentName Equipment display name.
 */
async function borrowEquipment(equipmentId, equipmentName) {
  const days = prompt(`How many days do you need ${equipmentName}?`);
  if (!days) return;

  const result = await requestJson('/api/borrow-equipment', {
    method: 'POST',
    body: JSON.stringify({ equipmentId, days: Number(days) })
  });

  if (result.error) {
    alert(result.error);
    return;
  }

  alert(result.message);
  await refreshDashboard(bookingFilter.value);
}

const dashboardPage = createDashboardPage({
  requestsList,
  formatDuration,
  onCancelBooking: cancelBooking,
  onCancelLoan: cancelLoan
});

const roomsPage = createRoomsPage({
  roomsList,
  bookingPanel,
  bookingForm,
  bookingRoomName,
  bookingDateInput,
  bookingStartTimeInput,
  bookingDurationInput,
  bookingError,
  bookingCancel,
  scheduleGrid,
  requestJson,
  getTodayDateString,
  getNextQuarterTime,
  formatDuration,
  onBookingCreated: async () => refreshDashboard(bookingFilter.value)
});

const equipmentPage = createEquipmentPage({
  equipmentList,
  onBorrow: borrowEquipment
});

const adminPage = createAdminPage({
  usersList,
  auditLogList,
  requestJson
});

/**
 * Refresh profile-dependent page state and render all page modules.
 * @param {'active'|'all'} [statusFilter='active'] Request filter for dashboard cards.
 */
async function refreshDashboard(statusFilter = 'active') {
  const profile = await requestJson('/api/profile');
  if (!profile.authenticated) {
    isAdminUser = false;
    navAdmin.classList.add('hidden');
    authSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
    userStatus.textContent = '';
    setActivePage('dashboard', { updateHash: false });
    return;
  }

  authSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  isAdminUser = profile.role === 'admin';
  navAdmin.classList.toggle('hidden', !isAdminUser);

  userStatus.textContent = isAdminUser
    ? `Signed in as ${profile.email} (admin)`
    : `Signed in as ${profile.email}`;

  if (!isAdminUser && activePage === 'admin') {
    activePage = 'dashboard';
  }

  setActivePage(activePage);

  const resources = await requestJson('/api/resources');
  const requests = await requestJson(`/api/my-requests?status=${statusFilter}`);

  roomsPage.render(resources.rooms);
  equipmentPage.render(resources.equipment);
  dashboardPage.render(requests);
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  resetErrors();

  const formData = new FormData(loginForm);
  const email = formData.get('email').trim();
  const password = formData.get('password').trim();

  const result = await requestJson('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (result.error) {
    showError(loginError, result.error);
    return;
  }

  setActivePage('dashboard');
  await refreshDashboard(bookingFilter.value);
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  resetErrors();

  const formData = new FormData(registerForm);
  const email = formData.get('email').trim();
  const password = formData.get('password').trim();

  const result = await requestJson('/api/register', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (result.error) {
    showError(registerError, result.error);
    return;
  }

  alert(result.message);
  tabs[0].click();
});

bookingFilter.addEventListener('change', async () => {
  await refreshDashboard(bookingFilter.value);
});

logoutButton.addEventListener('click', async () => {
  await requestJson('/api/logout', { method: 'POST' });
  isAdminUser = false;
  navAdmin.classList.add('hidden');
  await refreshDashboard(bookingFilter.value);
});

navDashboard.addEventListener('click', () => {
  setActivePage('dashboard');
});

navRooms.addEventListener('click', () => {
  setActivePage('rooms');
});

navEquipment.addEventListener('click', () => {
  setActivePage('equipment');
});

navAdmin.addEventListener('click', () => {
  if (!isAdminUser) {
    setActivePage('dashboard');
    return;
  }
  setActivePage('admin');
});

window.addEventListener('hashchange', () => {
  const hashPage = getPageFromHash();
  if (hashPage !== activePage) {
    setActivePage(hashPage, { updateHash: false });
  }
});

refreshDashboard(bookingFilter.value);
