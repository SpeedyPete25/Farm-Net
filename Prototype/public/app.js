// Frontend element bindings for the lab booking app.
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const pageDashboard = document.getElementById('page-dashboard');
const pageRooms = document.getElementById('page-rooms');
const pageEquipment = document.getElementById('page-equipment');
const navDashboard = document.getElementById('nav-dashboard');
const navRooms = document.getElementById('nav-rooms');
const navEquipment = document.getElementById('nav-equipment');
const userStatus = document.getElementById('user-status');
const roomsList = document.getElementById('rooms-list');
const equipmentList = document.getElementById('equipment-list');
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
let activeBookingRoomId = null;
const allowedPages = ['dashboard', 'rooms', 'equipment'];

function getPageFromHash() {
  const hashPage = window.location.hash.replace('#', '').trim();
  return allowedPages.includes(hashPage) ? hashPage : 'dashboard';
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

// Sends a JSON request to the backend and returns parsed JSON.
async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    credentials: 'include'
  });
  return response.json();
}

// Display a validation or error message in a UI element.
function showError(element, message) {
  element.textContent = message;
}

// Convert stored duration in hours to a friendly label.
function formatDuration(duration) {
  const value = Number(duration);
  if (!Number.isFinite(value)) return `${duration}h`;
  const minutes = Math.round(value * 60);
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes} min`;
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function getNextQuarterTime() {
  const now = new Date();
  const nextQuarter = Math.ceil(now.getMinutes() / 15) * 15;
  let hours = now.getHours();
  let minutes = nextQuarter;
  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }
  if (hours >= 24) {
    return '23:45';
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function updateBookingTimeMin() {
  const today = getTodayDateString();
  const selected = bookingDateInput.value;

  if (selected === today) {
    const minTime = getNextQuarterTime();
    bookingStartTimeInput.min = minTime;
    if (!bookingStartTimeInput.value || bookingStartTimeInput.value < minTime) {
      bookingStartTimeInput.value = minTime;
    }
  } else {
    bookingStartTimeInput.min = '00:00';
    if (!bookingStartTimeInput.value) {
      bookingStartTimeInput.value = '09:00';
    }
  }
}

function setBookingConstraints() {
  const today = getTodayDateString();
  bookingDateInput.min = today;
  if (!bookingDateInput.value || bookingDateInput.value < today) {
    bookingDateInput.value = today;
  }
  updateBookingTimeMin();
}

function resetErrors() {
  showError(loginError, '');
  showError(registerError, '');
}

function setActivePage(page, options = {}) {
  const updateHash = options.updateHash !== false;
  const nextPage = allowedPages.includes(page) ? page : 'dashboard';
  activePage = nextPage;

  pageDashboard.classList.toggle('hidden', nextPage !== 'dashboard');
  pageRooms.classList.toggle('hidden', nextPage !== 'rooms');
  pageEquipment.classList.toggle('hidden', nextPage !== 'equipment');

  navDashboard.classList.toggle('active', nextPage === 'dashboard');
  navRooms.classList.toggle('active', nextPage === 'rooms');
  navEquipment.classList.toggle('active', nextPage === 'equipment');

  if (nextPage !== 'rooms') {
    bookingPanel.classList.add('hidden');
  }

  if (updateHash) {
    const targetHash = `#${nextPage}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
  }
}

async function refreshDashboard(statusFilter = 'active') {
  const profile = await requestJson('/api/profile');
  if (!profile.authenticated) {
    authSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
    userStatus.textContent = '';
    setActivePage('dashboard', { updateHash: false });
    return;
  }

  authSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  userStatus.textContent = `Signed in as ${profile.email}`;
  setActivePage(activePage);

  const resources = await requestJson('/api/resources');
  const requests = await requestJson(`/api/my-requests?status=${statusFilter}`);

  roomsList.innerHTML = resources.rooms.map((room) => {
    return `
      <div class="item-row">
        <div>
          <strong>${room.name}</strong>
          <p>${room.location}</p>
        </div>
        <button onclick="bookRoom(${room.id}, '${room.name}')">Book</button>
      </div>
    `;
  }).join('');

  equipmentList.innerHTML = resources.equipment.map((item) => {
    return `
      <div class="item-row">
        <div>
          <strong>${item.name}</strong>
          <p>Available: ${item.available} / ${item.quantity}</p>
        </div>
        <button ${item.available === 0 ? 'disabled' : ''} onclick="borrowEquipment(${item.id}, '${item.name}')">Borrow</button>
      </div>
    `;
  }).join('');

  requestsList.innerHTML = `
    <div class="request-group">
      <h3>Room Bookings</h3>
      <div class="request-list">
        ${requests.bookings.length === 0 ? '<div class="request-card"><p>No room bookings yet.</p></div>' : requests.bookings.map((booking) => {
          const bookingDateTime = new Date(`${booking.date}T${booking.startTime}:00`);
          const isPast = bookingDateTime <= new Date();
          const isCancelled = booking.status === 'cancelled';
          let statusLabel = '';
          if (isCancelled) {
            statusLabel = '<span class="status-label cancelled">Cancelled</span>';
          } else if (isPast) {
            statusLabel = '<span class="status-label past">Past booking</span>';
          }
          return `
          <div class="request-card ${isCancelled ? 'cancelled' : ''}">
            <strong>${booking.roomName}</strong>
            <p>${booking.location}</p>
            <p>Date: ${booking.date} · Time: ${booking.startTime} · ${formatDuration(booking.durationHours)}</p>
            ${statusLabel}
            ${!isPast && !isCancelled ? `<button class="cancel-button" onclick="cancelBooking(${booking.id})">Cancel</button>` : ''}
          </div>
        `}).join('')}
      </div>
    </div>
    <div class="request-group">
      <h3>Equipment Loans</h3>
      <div class="request-list">
        ${requests.loans.length === 0 ? '<div class="request-card"><p>No equipment loans yet.</p></div>' : requests.loans.map((loan) => {
          const today = new Date().toISOString().slice(0, 10);
          const isExpired = loan.returnDate < today;
          const isCancelled = loan.status === 'cancelled';
          let statusLabel = '';
          if (isCancelled) {
            statusLabel = '<span class="status-label cancelled">Cancelled</span>';
          } else if (isExpired) {
            statusLabel = '<span class="status-label past">Expired</span>';
          }

          return `
          <div class="request-card ${isCancelled ? 'cancelled' : ''}">
            <strong>${loan.equipmentName}</strong>
            <p>Borrowed: ${loan.borrowDate}</p>
            <p>Return by: ${loan.returnDate}</p>
            ${statusLabel}
            ${(!isExpired && !isCancelled) ? `<button class="cancel-button" onclick="cancelLoan(${loan.id})">Cancel</button>` : ''}
          </div>
        `}).join('')}
      </div>
    </div>
  `;
}

async function renderSchedule(roomId, date) {
  if (!roomId || !date) { scheduleGrid.innerHTML = ''; return; }
  const bookings = await requestJson(`/api/rooms/${roomId}/schedule?date=${date}`);
  if (!Array.isArray(bookings)) { scheduleGrid.innerHTML = ''; return; }

  // Build a set of occupied 30-min slot labels from all bookings on this day.
  const occupied = new Map();
  for (const b of bookings) {
    const [h, m] = b.startTime.split(':').map(Number);
    const totalSlots = Math.round(Number(b.durationHours) / 0.5);
    for (let i = 0; i < totalSlots; i++) {
      const mins = h * 60 + m + i * 30;
      const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      if (!occupied.has(label)) occupied.set(label, b.email);
    }
  }

  const currentSelection = bookingStartTimeInput.value;
  let html = '<div class="schedule-grid">';
  for (let mins = 8 * 60; mins < 20 * 60; mins += 30) {
    const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const busy = occupied.has(label);
    const selected = !busy && label === currentSelection;
    const cls = busy ? 'slot-busy' : selected ? 'slot-free slot-selected' : 'slot-free';
    html += `<div class="slot ${cls}"${!busy ? ` onclick="selectSlot('${label}')"` : ''}>`
      + `<span>${label}</span>`
      + `<span>${busy ? 'Booked' : selected ? 'Selected' : 'Available'}</span>`
      + `</div>`;
  }
  html += '</div>';
  scheduleGrid.innerHTML = html;
}

function selectSlot(time) {
  bookingStartTimeInput.value = time;
  bookingError.textContent = '';
  renderSchedule(activeBookingRoomId, bookingDateInput.value);
}

function bookRoom(roomId, roomName) {
  activeBookingRoomId = roomId;
  bookingRoomName.textContent = roomName;
  setBookingConstraints();
  bookingDurationInput.value = '0.5';
  bookingError.textContent = '';
  bookingPanel.classList.remove('hidden');
  renderSchedule(roomId, bookingDateInput.value);
}

bookingDateInput.addEventListener('change', () => {
  updateBookingTimeMin();
  renderSchedule(activeBookingRoomId, bookingDateInput.value);
});

bookingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeBookingRoomId) return;

  const date = bookingDateInput.value;
  const startTime = bookingStartTimeInput.value;
  const durationHours = Number(bookingDurationInput.value);

  if (!/^[0-9]{2}:[0-9]{2}$/.test(startTime)) {
    bookingError.textContent = 'Start time must be in HH:MM format.';
    return;
  }
  const minutes = Number(startTime.split(':')[1]);
  if (minutes % 15 !== 0) {
    bookingError.textContent = 'Start time must be a 15-minute increment.';
    return;
  }
  if (durationHours <= 0 || durationHours % 0.5 !== 0) {
    bookingError.textContent = 'Duration must be in 30-minute increments.';
    return;
  }

  const selectedDateTime = new Date(`${date}T${startTime}:00`);
  if (Number.isNaN(selectedDateTime.getTime()) || selectedDateTime <= new Date()) {
    bookingError.textContent = 'Booking must be in the future.';
    return;
  }

  const result = await requestJson('/api/book-room', {
    method: 'POST',
    body: JSON.stringify({ roomId: activeBookingRoomId, date, startTime, durationHours })
  });

  if (result.error) {
    bookingError.textContent = result.error;
    return;
  }

  const durationLabel = formatDuration(durationHours);
  alert(`Booking confirmed!\n\nRoom: ${bookingRoomName.textContent}\nDate: ${date}\nStart: ${startTime}\nDuration: ${durationLabel}`);
  bookingPanel.classList.add('hidden');
  await refreshDashboard(bookingFilter.value);
});

bookingCancel.addEventListener('click', () => {
  bookingPanel.classList.add('hidden');
});

async function borrowEquipment(equipmentId, equipmentName) {
  const days = prompt(`How many days do you need ${equipmentName}?`);
  if (!days) return;

  const result = await requestJson('/api/borrow-equipment', {
    method: 'POST',
    body: JSON.stringify({ equipmentId, days: Number(days) })
  });

  if (result.error) {
    alert(result.error);
  } else {
    alert(result.message);
    await refreshDashboard(bookingFilter.value);
  }
}

async function cancelBooking(bookingId) {
  if (!confirm('Are you sure you want to cancel this booking?')) return;

  const result = await requestJson('/api/cancel-booking', {
    method: 'POST',
    body: JSON.stringify({ bookingId })
  });

  if (result.error) {
    alert(result.error);
  } else {
    alert(result.message);
    await refreshDashboard(bookingFilter.value);
  }
}

async function cancelLoan(loanId) {
  if (!confirm('Are you sure you want to cancel this loan?')) return;

  const result = await requestJson('/api/cancel-loan', {
    method: 'POST',
    body: JSON.stringify({ loanId })
  });

  if (result.error) {
    alert(result.error);
  } else {
    alert(result.message);
    await refreshDashboard(bookingFilter.value);
  }
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

window.addEventListener('hashchange', () => {
  const hashPage = getPageFromHash();
  if (hashPage !== activePage) {
    setActivePage(hashPage, { updateHash: false });
  }
});

window.bookRoom = bookRoom;
window.borrowEquipment = borrowEquipment;
window.cancelBooking = cancelBooking;
window.cancelLoan = cancelLoan;
window.selectSlot = selectSlot;
refreshDashboard(bookingFilter.value);
