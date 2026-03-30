const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const userStatus = document.getElementById('user-status');
const roomsList = document.getElementById('rooms-list');
const equipmentList = document.getElementById('equipment-list');
const requestsList = document.getElementById('requests-list');
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
let activeBookingRoomId = null;

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

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    credentials: 'include'
  });
  return response.json();
}

function showError(element, message) {
  element.textContent = message;
}

function formatDuration(duration) {
  const value = Number(duration);
  if (!Number.isFinite(value)) return `${duration}h`;
  const minutes = Math.round(value * 60);
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes} min`;
}

function resetErrors() {
  showError(loginError, '');
  showError(registerError, '');
}

async function refreshDashboard() {
  const profile = await requestJson('/api/profile');
  if (!profile.authenticated) {
    authSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
    userStatus.textContent = '';
    return;
  }

  authSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  userStatus.textContent = `Signed in as ${profile.username}`;

  const resources = await requestJson('/api/resources');
  const requests = await requestJson('/api/my-requests');

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
        ${requests.bookings.length === 0 ? '<div class="request-card"><p>No room bookings yet.</p></div>' : requests.bookings.map((booking) => `
          <div class="request-card">
            <strong>${booking.roomName}</strong>
            <p>${booking.location}</p>
            <p>Date: ${booking.date} · Time: ${booking.startTime} · ${formatDuration(booking.durationHours)}</p>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="request-group">
      <h3>Equipment Loans</h3>
      <div class="request-list">
        ${requests.loans.length === 0 ? '<div class="request-card"><p>No equipment loans yet.</p></div>' : requests.loans.map((loan) => `
          <div class="request-card">
            <strong>${loan.equipmentName}</strong>
            <p>Borrowed: ${loan.borrowDate}</p>
            <p>Return by: ${loan.returnDate}</p>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function bookRoom(roomId, roomName) {
  activeBookingRoomId = roomId;
  bookingRoomName.textContent = roomName;
  bookingDateInput.value = '';
  bookingStartTimeInput.value = '09:00';
  bookingDurationInput.value = '0.25';
  bookingError.textContent = '';
  bookingPanel.classList.remove('hidden');
}

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
  if (durationHours <= 0 || durationHours % 0.25 !== 0) {
    bookingError.textContent = 'Duration must be in 15-minute increments.';
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

  alert(result.message);
  bookingPanel.classList.add('hidden');
  await refreshDashboard();
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
    await refreshDashboard();
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  resetErrors();
  const formData = new FormData(loginForm);
  const username = formData.get('username').trim();
  const password = formData.get('password').trim();

  const result = await requestJson('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

  if (result.error) {
    showError(loginError, result.error);
    return;
  }
  await refreshDashboard();
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  resetErrors();
  const formData = new FormData(registerForm);
  const username = formData.get('username').trim();
  const password = formData.get('password').trim();

  const result = await requestJson('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

  if (result.error) {
    showError(registerError, result.error);
    return;
  }

  alert(result.message);
  tabs[0].click();
});

logoutButton.addEventListener('click', async () => {
  await requestJson('/api/logout', { method: 'POST' });
  await refreshDashboard();
});

window.bookRoom = bookRoom;
window.borrowEquipment = borrowEquipment;
refreshDashboard();
