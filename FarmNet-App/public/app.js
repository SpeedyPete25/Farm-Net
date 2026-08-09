import { requestJson } from './js/api.js';
import { showError, formatDuration, getTodayDateString, getNextQuarterTime, renderListState } from './js/utils.js';
import { createDashboardPage } from './js/dashboard-page.js';
import { createRoomsPage } from './js/rooms-page.js';
import { createEquipmentPage } from './js/equipment-page.js';
import { createAdminPage } from './js/admin-page.js';
import { createRoomManagementPage } from './js/room-management-page.js';
import { createEquipmentManagementPage } from './js/equipment-management-page.js';
import { createSettingsPage } from './js/settings-page.js';

/**
 * Main frontend entrypoint.
 * Coordinates auth flow, page navigation, API orchestration, and page module rendering.
 *
 * Module responsibilities:
 * - Cache all static DOM nodes used across page modules.
 * - Keep global UI state (active page, admin visibility) in sync.
 * - Initialize feature pages and wire cross-page callbacks.
 * - Handle auth lifecycle (login/register/logout/profile bootstrap).
 * - Handle global navigation and URL hash routing.
 */

// Root layout sections.
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');

// Content containers for each dashboard sub-page.
const pageDashboard = document.getElementById('page-dashboard');
const pageRooms = document.getElementById('page-rooms');
const pageEquipment = document.getElementById('page-equipment');
const pageSettings = document.getElementById('page-settings');
const pageAdmin = document.getElementById('page-admin');
const pageRoomManagement = document.getElementById('page-room-management');
const pageEquipmentManagement = document.getElementById('page-equipment-management');

// Top-level navigation buttons.
const navDashboard = document.getElementById('nav-dashboard');
const navRooms = document.getElementById('nav-rooms');
const navEquipment = document.getElementById('nav-equipment');
const navSettings = document.getElementById('nav-settings');
const navAdmin = document.getElementById('nav-admin');
const navRoomManagement = document.getElementById('nav-room-management');
const navEquipmentManagement = document.getElementById('nav-equipment-management');

// Shared status/read-only display elements.
const userStatus = document.getElementById('user-status');
const roomsList = document.getElementById('rooms-list');
const equipmentList = document.getElementById('equipment-list');
const usersList = document.getElementById('users-list');
const adminBookingsList = document.getElementById('admin-bookings-list');
const adminLoansList = document.getElementById('admin-loans-list');
const auditLogList = document.getElementById('audit-log-list');

// Room management controls.
const roomManagementList = document.getElementById('room-management-list');
const roomManagementForm = document.getElementById('room-management-form');
const roomNameInput = document.getElementById('room-name');
const roomLocationInput = document.getElementById('room-location');
const roomManagementError = document.getElementById('room-management-error');

// Equipment management controls.
const equipmentManagementList = document.getElementById('equipment-management-list');
const bookedOutEquipmentList = document.getElementById('booked-out-equipment-list');
const equipmentManagementForm = document.getElementById('equipment-management-form');
const equipmentNameInput = document.getElementById('equipment-name');
const equipmentQuantityInput = document.getElementById('equipment-quantity');
const equipmentManagementError = document.getElementById('equipment-management-error');

// Dashboard requests and filters.
const requestsList = document.getElementById('requests-list');
const bookingFilter = document.getElementById('booking-filter');

// Authentication controls.
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const logoutButton = document.getElementById('logout-button');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');

// Room booking panel controls.
const bookingPanel = document.getElementById('booking-panel');
const bookingForm = document.getElementById('booking-form');
const bookingRoomName = document.getElementById('booking-room-name');
const bookingPolicyNote = document.getElementById('booking-policy-note');
const bookingDateInput = document.getElementById('booking-date');
const bookingStartTimeInput = document.getElementById('booking-start-time');
const bookingDurationInput = document.getElementById('booking-duration');
const bookingRecurringInput = document.getElementById('booking-recurring');
const bookingRecurrenceFrequencyLabel = document.getElementById('booking-recurrence-frequency-label');
const bookingRecurrenceFrequencyInput = document.getElementById('booking-recurrence-frequency');
const bookingRecurrenceCountLabel = document.getElementById('booking-recurrence-count-label');
const bookingRecurrenceCountInput = document.getElementById('booking-recurrence-count');
const bookingError = document.getElementById('booking-error');
const bookingCancel = document.getElementById('booking-cancel');

// Settings controls.
const changePasswordForm = document.getElementById('change-password-form');
const currentPasswordInput = document.getElementById('current-password');
const newPasswordInput = document.getElementById('new-password');
const confirmNewPasswordInput = document.getElementById('confirm-new-password');
const changePasswordError = document.getElementById('change-password-error');
const changePasswordSuccess = document.getElementById('change-password-success');
const themeDarkToggle = document.getElementById('theme-dark-toggle');
const themeSettingsError = document.getElementById('theme-settings-error');
const themeSettingsSuccess = document.getElementById('theme-settings-success');

/**
 * Allowed route fragments used for hash routing and page switching.
 * @type {Array<'dashboard'|'rooms'|'equipment'|'settings'|'admin'|'room-management'|'equipment-management'>}
 */
const allPages = ['dashboard', 'rooms', 'equipment', 'settings', 'admin', 'room-management', 'equipment-management'];

/**
 * True when the authenticated profile has admin role.
 * Used to guard admin-only pages and navigation controls.
 * @type {boolean}
 */
let isAdminUser = false;

/**
 * Apply visual theme to the document.
 * @param {'dark'|'light'|string} theme
 */
function applyTheme(theme) {
  const normalizedTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', normalizedTheme);
}

// Default to dark mode for signed-out users and first-time visitors.
applyTheme('dark');

/**
 * Resolve the active page from URL hash.
 * @returns {'dashboard'|'rooms'|'equipment'|'settings'|'admin'|'room-management'|'equipment-management'}
 */
function getPageFromHash() {
  const hashPage = window.location.hash.replace('#', '').trim();
  if (!allPages.includes(hashPage)) {
    return 'dashboard';
  }
  return hashPage;
}

let activePage = getPageFromHash();

// Auth form tab controls (login/register).
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
 * @param {'dashboard'|'rooms'|'equipment'|'settings'|'admin'|'room-management'|'equipment-management'} page Target page.
 * @param {{ updateHash?: boolean }} [options={}] Options for hash behavior.
 */
function setActivePage(page, options = {}) {
  const updateHash = options.updateHash !== false;
  const requestedPage = allPages.includes(page) ? page : 'dashboard';
  const adminOnlyPages = ['admin', 'room-management', 'equipment-management'];
  const nextPage = adminOnlyPages.includes(requestedPage) && !isAdminUser ? 'dashboard' : requestedPage;
  activePage = nextPage;

  pageDashboard.classList.toggle('hidden', nextPage !== 'dashboard');
  pageRooms.classList.toggle('hidden', nextPage !== 'rooms');
  pageEquipment.classList.toggle('hidden', nextPage !== 'equipment');
  pageSettings.classList.toggle('hidden', nextPage !== 'settings');
  pageAdmin.classList.toggle('hidden', nextPage !== 'admin');
  pageRoomManagement.classList.toggle('hidden', nextPage !== 'room-management');
  pageEquipmentManagement.classList.toggle('hidden', nextPage !== 'equipment-management');

  navDashboard.classList.toggle('active', nextPage === 'dashboard');
  navRooms.classList.toggle('active', nextPage === 'rooms');
  navEquipment.classList.toggle('active', nextPage === 'equipment');
  navSettings.classList.toggle('active', nextPage === 'settings');
  navAdmin.classList.toggle('active', nextPage === 'admin');
  navRoomManagement.classList.toggle('active', nextPage === 'room-management');
  navEquipmentManagement.classList.toggle('active', nextPage === 'equipment-management');

  if (nextPage !== 'rooms') {
    roomsPage.hideBookingPanel();
  }

  if (nextPage === 'rooms') {
    roomsPage.loadTimetable();
  }

  if (nextPage === 'admin' && isAdminUser) {
    adminPage.load();
  }

  if (nextPage === 'room-management' && isAdminUser) {
    roomManagementPage.load();
  }

  if (nextPage === 'equipment-management' && isAdminUser) {
    equipmentManagementPage.load();
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
 * Cancel every upcoming occurrence of a recurring booking series for the current user.
 * @param {number} seriesId Series identifier (the first booking's id).
 */
async function cancelBookingSeries(seriesId) {
  if (!confirm('Cancel all upcoming occurrences of this recurring booking?')) return;

  const result = await requestJson('/api/cancel-booking-series', {
    method: 'POST',
    body: JSON.stringify({ seriesId })
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
 * Open the return equipment modal for the given loan.
 * @param {number} loanId Loan identifier.
 */
function returnLoan(loanId) {
  const modal = document.getElementById('return-loan-modal');
  document.getElementById('return-loan-id').value = String(loanId);
  document.getElementById('return-condition').value = '';
  document.getElementById('return-photo').value = '';
  document.getElementById('return-damaged').checked = false;
  document.getElementById('return-loan-error').textContent = '';
  modal.classList.remove('hidden');
}

/**
 * Edit an existing room booking for the current user.
 * @param {{ id: number, date: string, startTime: string, durationHours: number|string }} booking Booking details.
 */
async function editBooking(booking) {
  const date = prompt('Enter a new booking date (YYYY-MM-DD):', booking.date);
  if (date === null) return;

  const startTime = prompt('Enter a new start time (HH:MM):', booking.startTime);
  if (startTime === null) return;

  const durationInput = prompt('Enter duration in hours (e.g. 0.5, 1, 1.5):', String(booking.durationHours));
  if (durationInput === null) return;

  const durationHours = Number(durationInput);
  if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours % 0.5 !== 0) {
    alert('Duration must be a positive number in 30-minute increments.');
    return;
  }

  const result = await requestJson('/api/edit-booking', {
    method: 'POST',
    body: JSON.stringify({
      bookingId: booking.id,
      date: date.trim(),
      startTime: startTime.trim(),
      durationHours
    })
  });

  if (result.error) {
    alert(result.error);
    return;
  }

  alert(result.message);
  await refreshDashboard(bookingFilter.value);
}

/**
 * Edit an existing equipment loan return date for the current user.
 * @param {{ id: number, borrowDate: string, returnDate: string }} loan Loan details.
 */
async function editLoan(loan) {
  const returnDate = prompt('Enter a new return date (YYYY-MM-DD):', loan.returnDate);
  if (returnDate === null) return;

  const result = await requestJson('/api/edit-loan', {
    method: 'POST',
    body: JSON.stringify({
      loanId: loan.id,
      returnDate: returnDate.trim()
    })
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

  let borrowerEmail = '';
  if (isAdminUser) {
    const input = prompt('Borrow on behalf of (email), or leave blank to borrow for yourself:', '');
    if (input === null) return;
    borrowerEmail = input.trim();
  }

  const result = await requestJson('/api/borrow-equipment', {
    method: 'POST',
    body: JSON.stringify({ equipmentId, days: Number(days), borrowerEmail })
  });

  if (result.error) {
    alert(result.error);
    return;
  }

  alert(result.message);
  await refreshDashboard(bookingFilter.value);
  if (activePage === 'admin') {
    await adminPage.load();
  }
}

const dashboardPage = createDashboardPage({
  requestsList,
  formatDuration,
  onCancelBooking: cancelBooking,
  onCancelBookingSeries: cancelBookingSeries,
  onCancelLoan: cancelLoan,
  onReturnLoan: returnLoan,
  onEditBooking: editBooking,
  onEditLoan: editLoan
});

const roomsPage = createRoomsPage({
  roomsList,
  bookingPanel,
  bookingForm,
  bookingRoomName,
  bookingPolicyNote,
  bookingDateInput,
  bookingStartTimeInput,
  bookingDurationInput,
  bookingRecurringInput,
  bookingRecurrenceFrequencyLabel,
  bookingRecurrenceFrequencyInput,
  bookingRecurrenceCountLabel,
  bookingRecurrenceCountInput,
  bookingError,
  bookingCancel,
  timetableRoomSelect: document.getElementById('timetable-room-select'),
  timetableWeekLabel: document.getElementById('timetable-week-label'),
  timetableWeekNav: document.getElementById('timetable-week-nav'),
  timetableGrid: document.getElementById('timetable-grid'),
  timetablePrev: document.getElementById('timetable-prev'),
  timetableNext: document.getElementById('timetable-next'),
  timetableToday: document.getElementById('timetable-today'),
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
  adminBookingsList,
  adminLoansList,
  auditLogList,
  requestJson,
  onReturnLoan: returnLoan
});

const roomManagementPage = createRoomManagementPage({
  roomManagementList,
  roomManagementForm,
  roomNameInput,
  roomLocationInput,
  roomManagementError,
  requestJson,
  onRoomsChanged: async () => refreshDashboard(bookingFilter.value)
});

const equipmentManagementPage = createEquipmentManagementPage({
  equipmentManagementList,
  bookedOutEquipmentList,
  equipmentManagementForm,
  equipmentNameInput,
  equipmentQuantityInput,
  equipmentManagementError,
  requestJson,
  onEquipmentChanged: async () => refreshDashboard(bookingFilter.value)
});

const settingsPage = createSettingsPage({
  changePasswordForm,
  currentPasswordInput,
  newPasswordInput,
  confirmNewPasswordInput,
  changePasswordError,
  changePasswordSuccess,
  themeDarkToggle,
  themeSettingsError,
  themeSettingsSuccess,
  applyTheme,
  requestJson
});

/**
 * Refresh profile-dependent page state and render all page modules.
 * @param {'active'|'all'} [statusFilter='active'] Request filter for dashboard cards.
 */
async function refreshDashboard(statusFilter = 'active') {
  const profile = await requestJson('/api/profile');
  if (!profile.authenticated) {
    applyTheme('dark');
    isAdminUser = false;
    navAdmin.classList.add('hidden');
    navRoomManagement.classList.add('hidden');
    navEquipmentManagement.classList.add('hidden');
    authSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
    userStatus.textContent = '';
    setActivePage('dashboard', { updateHash: false });
    return;
  }

  authSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  settingsPage.setTheme(profile.theme || 'dark');
  isAdminUser = profile.role === 'admin';
  navAdmin.classList.toggle('hidden', !isAdminUser);
  navRoomManagement.classList.toggle('hidden', !isAdminUser);
  navEquipmentManagement.classList.toggle('hidden', !isAdminUser);

  userStatus.textContent = isAdminUser
    ? `Signed in as ${profile.email} (admin)`
    : `Signed in as ${profile.email}`;

  if (!isAdminUser && ['admin', 'room-management', 'equipment-management'].includes(activePage)) {
    activePage = 'dashboard';
  }

  setActivePage(activePage);

  renderListState(roomsList, { kind: 'loading', message: 'Loading rooms...' });
  renderListState(equipmentList, { kind: 'loading', message: 'Loading equipment...' });
  renderListState(requestsList, { kind: 'loading', message: 'Loading your requests...' });

  let resources;
  let requests;
  try {
    [resources, requests] = await Promise.all([
      requestJson('/api/resources'),
      requestJson(`/api/my-requests?status=${statusFilter}`)
    ]);
  } catch (error) {
    renderListState(roomsList, { kind: 'error', message: 'Unable to load rooms.' });
    renderListState(equipmentList, { kind: 'error', message: 'Unable to load equipment.' });
    renderListState(requestsList, { kind: 'error', message: 'Unable to load your requests.' });
    return;
  }

  if (resources.error) {
    renderListState(roomsList, { kind: 'error', message: resources.error });
    renderListState(equipmentList, { kind: 'error', message: resources.error });
  } else {
    roomsPage.render(resources.rooms || []);
    equipmentPage.render(resources.equipment || []);
  }

  if (requests.error) {
    renderListState(requestsList, { kind: 'error', message: requests.error });
  } else {
    dashboardPage.render({
      bookings: Array.isArray(requests.bookings) ? requests.bookings : [],
      loans: Array.isArray(requests.loans) ? requests.loans : []
    });
  }
}

/**
 * Handle login form submission.
 * Attempts authentication and, on success, refreshes dashboard data.
 * @param {SubmitEvent} event
 */
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

/**
 * Handle registration form submission.
 * On success, returns the user to the login tab.
 * @param {SubmitEvent} event
 */
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

/**
 * Re-render the dashboard when the active/history filter changes.
 */
bookingFilter.addEventListener('change', async () => {
  await refreshDashboard(bookingFilter.value);
});

/**
 * Return-loan modal controls.
 * Uses multipart/form-data to support optional photo upload.
 */
const returnLoanModal = document.getElementById('return-loan-modal');
const returnLoanForm = document.getElementById('return-loan-form');
const returnLoanCancelBtn = document.getElementById('return-loan-cancel');

/**
 * Close the return-loan modal via explicit cancel button.
 */
returnLoanCancelBtn.addEventListener('click', () => {
  returnLoanModal.classList.add('hidden');
});

/**
 * Close the return-loan modal when the backdrop is clicked.
 * @param {MouseEvent} event
 */
returnLoanModal.addEventListener('click', (event) => {
  if (event.target === returnLoanModal) {
    returnLoanModal.classList.add('hidden');
  }
});

/**
 * Handle return-loan submission including condition text and optional photo.
 * Uses fetch directly to send FormData payload.
 * @param {SubmitEvent} event
 */
returnLoanForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById('return-loan-error');
  errorEl.textContent = '';

  const loanId = document.getElementById('return-loan-id').value;
  const condition = document.getElementById('return-condition').value.trim();
  const photoFile = document.getElementById('return-photo').files[0];
  const damaged = document.getElementById('return-damaged').checked;

  if (!condition) {
    errorEl.textContent = 'Please describe the equipment condition.';
    return;
  }

  const formData = new FormData();
  formData.append('loanId', loanId);
  formData.append('returnCondition', condition);
  formData.append('damaged', damaged ? 'true' : 'false');
  if (photoFile) {
    formData.append('photo', photoFile);
  }

  const submitBtn = returnLoanForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  const response = await fetch('/api/return-loan', {
    method: 'POST',
    body: formData,
    credentials: 'include'
  });
  const result = await response.json();
  submitBtn.disabled = false;

  if (result.error) {
    errorEl.textContent = result.error;
    return;
  }

  returnLoanModal.classList.add('hidden');
  alert(result.message);
  await refreshDashboard(bookingFilter.value);
  if (activePage === 'admin') {
    await adminPage.load();
  }
});

/**
 * End the active user session and reset role-sensitive UI state.
 */
logoutButton.addEventListener('click', async () => {
  await requestJson('/api/logout', { method: 'POST' });
  isAdminUser = false;
  settingsPage.clearMessages();
  changePasswordForm.reset();
  navAdmin.classList.add('hidden');
  navRoomManagement.classList.add('hidden');
  navEquipmentManagement.classList.add('hidden');
  await refreshDashboard(bookingFilter.value);
});

/**
 * Navigate to dashboard page.
 */
navDashboard.addEventListener('click', () => {
  setActivePage('dashboard');
});

/**
 * Navigate to rooms page.
 */
navRooms.addEventListener('click', () => {
  setActivePage('rooms');
});

/**
 * Navigate to equipment page.
 */
navEquipment.addEventListener('click', () => {
  setActivePage('equipment');
});

/**
 * Navigate to settings page.
 */
navSettings.addEventListener('click', () => {
  setActivePage('settings');
});

/**
 * Navigate to admin page if user is authorized.
 */
navAdmin.addEventListener('click', () => {
  if (!isAdminUser) {
    setActivePage('dashboard');
    return;
  }
  setActivePage('admin');
});

/**
 * Navigate to room-management page if user is authorized.
 */
navRoomManagement.addEventListener('click', () => {
  if (!isAdminUser) {
    setActivePage('dashboard');
    return;
  }
  setActivePage('room-management');
});

/**
 * Navigate to equipment-management page if user is authorized.
 */
navEquipmentManagement.addEventListener('click', () => {
  if (!isAdminUser) {
    setActivePage('dashboard');
    return;
  }
  setActivePage('equipment-management');
});

/**
 * Keep visible page synchronized when URL hash changes externally.
 */
window.addEventListener('hashchange', () => {
  const hashPage = getPageFromHash();
  if (hashPage !== activePage) {
    setActivePage(hashPage, { updateHash: false });
  }
});

// Initial app bootstrap. Determines auth state and renders the first page.
refreshDashboard(bookingFilter.value);
