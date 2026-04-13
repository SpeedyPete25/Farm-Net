export function createRoomsPage({
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
  onBookingCreated
}) {
  let activeBookingRoomId = null;

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

  async function renderSchedule(roomId, date) {
    if (!roomId || !date) {
      scheduleGrid.innerHTML = '';
      return;
    }

    const bookings = await requestJson(`/api/rooms/${roomId}/schedule?date=${date}`);
    if (!Array.isArray(bookings)) {
      scheduleGrid.innerHTML = '';
      return;
    }

    const occupied = new Map();
    for (const booking of bookings) {
      const [hour, minute] = booking.startTime.split(':').map(Number);
      const totalSlots = Math.round(Number(booking.durationHours) / 0.5);

      for (let i = 0; i < totalSlots; i++) {
        const mins = hour * 60 + minute + i * 30;
        const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
        if (!occupied.has(label)) {
          occupied.set(label, booking.email);
        }
      }
    }

    const currentSelection = bookingStartTimeInput.value;
    let html = '<div class="schedule-grid">';

    for (let mins = 8 * 60; mins < 20 * 60; mins += 30) {
      const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      const busy = occupied.has(label);
      const selected = !busy && label === currentSelection;
      const classes = busy ? 'slot slot-busy' : selected ? 'slot slot-free slot-selected' : 'slot slot-free';
      const dataAttr = busy ? '' : ` data-slot-time="${label}"`;

      html += `<div class="${classes}"${dataAttr}>`
        + `<span>${label}</span>`
        + `<span>${busy ? 'Booked' : selected ? 'Selected' : 'Available'}</span>`
        + '</div>';
    }

    html += '</div>';
    scheduleGrid.innerHTML = html;
  }

  function hideBookingPanel() {
    bookingPanel.classList.add('hidden');
  }

  function openBookingPanel(roomId, roomName) {
    activeBookingRoomId = roomId;
    bookingRoomName.textContent = roomName;
    bookingDurationInput.value = '0.5';
    bookingError.textContent = '';
    setBookingConstraints();
    bookingPanel.classList.remove('hidden');
    renderSchedule(roomId, bookingDateInput.value);
  }

  roomsList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="book-room"]');
    if (!button) return;

    const roomId = Number(button.dataset.roomId);
    const roomName = button.dataset.roomName || 'Room';
    if (!Number.isFinite(roomId)) return;

    openBookingPanel(roomId, roomName);
  });

  scheduleGrid.addEventListener('click', (event) => {
    const slot = event.target.closest('[data-slot-time]');
    if (!slot) return;

    bookingStartTimeInput.value = slot.dataset.slotTime;
    bookingError.textContent = '';
    renderSchedule(activeBookingRoomId, bookingDateInput.value);
  });

  bookingDateInput.addEventListener('change', () => {
    updateBookingTimeMin();
    renderSchedule(activeBookingRoomId, bookingDateInput.value);
  });

  bookingCancel.addEventListener('click', () => {
    hideBookingPanel();
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
      body: JSON.stringify({
        roomId: activeBookingRoomId,
        date,
        startTime,
        durationHours
      })
    });

    if (result.error) {
      bookingError.textContent = result.error;
      return;
    }

    const durationLabel = formatDuration(durationHours);
    alert(`Booking confirmed!\n\nRoom: ${bookingRoomName.textContent}\nDate: ${date}\nStart: ${startTime}\nDuration: ${durationLabel}`);
    hideBookingPanel();
    await onBookingCreated();
  });

  function render(rooms) {
    roomsList.innerHTML = rooms.map((room) => {
      return `
        <div class="item-row">
          <div>
            <strong>${room.name}</strong>
            <p>${room.location}</p>
          </div>
          <button data-action="book-room" data-room-id="${room.id}" data-room-name="${room.name}">Book</button>
        </div>
      `;
    }).join('');
  }

  return {
    render,
    hideBookingPanel
  };
}
