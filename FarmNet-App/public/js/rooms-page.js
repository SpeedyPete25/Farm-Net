/**
 * Room bookings page module.
 * Handles room list rendering, booking form state, timetable rendering, and booking submission.
 */

import { renderListState } from './utils.js';

/**
 * @typedef {{
 *   id: number,
 *   name: string,
 *   location: string,
 *   minDurationMinutes?: number|null,
 *   maxDurationMinutes?: number|null,
 *   maxBookingsPerUserPerWeek?: number|null,
 *   requiresApproval?: 0|1
 * }} RoomSummary
 */

/**
 * @typedef {{
 *   render: (rooms: RoomSummary[]) => void,
 *   hideBookingPanel: () => void,
 *   loadTimetable: () => Promise<void>
 * }} RoomsPageApi
 */

/**
 * @typedef {{
 *   roomsList: HTMLElement,
 *   bookingPanel: HTMLElement,
 *   bookingForm: HTMLFormElement,
 *   bookingRoomName: HTMLElement,
 *   bookingPolicyNote: HTMLElement,
 *   bookingDateInput: HTMLInputElement,
 *   bookingStartTimeInput: HTMLInputElement,
 *   bookingDurationInput: HTMLInputElement,
 *   bookingRecurringInput: HTMLInputElement,
 *   bookingRecurrenceCountLabel: HTMLElement,
 *   bookingRecurrenceCountInput: HTMLInputElement,
 *   bookingError: HTMLElement,
 *   bookingCancel: HTMLElement,
 *   timetableRoomSelect: HTMLSelectElement,
 *   timetableWeekLabel: HTMLElement,
 *   timetableWeekNav: HTMLElement,
 *   timetableGrid: HTMLElement,
 *   timetablePrev: HTMLButtonElement,
 *   timetableNext: HTMLButtonElement,
 *   timetableToday: HTMLButtonElement,
 *   requestJson: (url: string, options?: RequestInit) => Promise<any>,
 *   getTodayDateString: () => string,
 *   getNextQuarterTime: () => string,
 *   formatDuration: (duration: number|string) => string,
 *   onBookingCreated: () => Promise<void>
 * }} RoomsPageDeps
 */

/**
 * Build the room bookings page controller.
 * @param {RoomsPageDeps} deps Dependency bag.
 * @returns {RoomsPageApi} Rooms page API.
 */
export function createRoomsPage({
  roomsList,
  bookingPanel,
  bookingForm,
  bookingRoomName,
  bookingPolicyNote,
  bookingDateInput,
  bookingStartTimeInput,
  bookingDurationInput,
  bookingRecurringInput,
  bookingRecurrenceCountLabel,
  bookingRecurrenceCountInput,
  bookingError,
  bookingCancel,
  timetableRoomSelect,
  timetableWeekLabel,
  timetableWeekNav,
  timetableGrid,
  timetablePrev,
  timetableNext,
  timetableToday,
  requestJson,
  getTodayDateString,
  getNextQuarterTime,
  formatDuration,
  onBookingCreated
}) {
  let activeBookingRoomId = null;

  /** @type {Map<number, RoomSummary>} */
  let roomsById = new Map();

  /**
   * Build a short policy hint for the booking panel.
   * @param {RoomSummary} [room]
   * @returns {string}
   */
  function describeRoomPolicy(room) {
    if (!room) return '';
    const parts = [];
    if (room.minDurationMinutes != null) parts.push(`Min ${room.minDurationMinutes} min`);
    if (room.maxDurationMinutes != null) parts.push(`Max ${room.maxDurationMinutes} min`);
    if (room.maxBookingsPerUserPerWeek != null) parts.push(`Max ${room.maxBookingsPerUserPerWeek} booking(s)/week`);
    if (room.requiresApproval) parts.push('Requires admin approval');
    return parts.join(' · ');
  }

  // ── Timetable ──────────────────────────────────────────────────────────────

  const TIMETABLE_START_HOUR = 8;
  const TIMETABLE_END_HOUR = 20; // exclusive
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /**
   * Returns the Monday for the week containing the given YYYY-MM-DD date.
   * @param {string} dateStr Date in YYYY-MM-DD.
   * @returns {string} Monday in YYYY-MM-DD.
   */
  function getMondayOf(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day); // local time
    const dow = d.getDay(); // 0=Sun,1=Mon,...,6=Sat
    const diff = (dow === 0 ? -6 : 1 - dow);
    d.setDate(d.getDate() + diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Shift a YYYY-MM-DD date string by a number of days.
   * @param {string} dateStr Date in YYYY-MM-DD.
   * @param {number} days Signed day offset.
   * @returns {string} Shifted date in YYYY-MM-DD.
   */
  function shiftDate(dateStr, days) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day); // local time
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Format YYYY-MM-DD to a short localized label for column headers.
   * @param {string} dateStr Date in YYYY-MM-DD.
   * @returns {string} Human-readable date label.
   */
  function formatDayLabel(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day); // local time
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }

  // Track current week start (always a Monday) and selected room.
  let weekStart = getMondayOf(getTodayDateString());
  let timetableRoomId = null;
  let timetableRoomName = '';

  /**
   * Update the visible timetable week range label.
   * @returns {void}
   */
  function updateWeekLabel() {
    const end = shiftDate(weekStart, 6);
    const [sYear, sMonth, sDay] = weekStart.split('-').map(Number);
    const [eYear, eMonth, eDay] = end.split('-').map(Number);
    const startLabel = new Date(sYear, sMonth - 1, sDay).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    const endLabel = new Date(eYear, eMonth - 1, eDay).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    timetableWeekLabel.textContent = `${startLabel} – ${endLabel}`;
  }

  /**
   * Render the seven-day timetable grid for the selected room and week.
   * Marks each half-hour slot as busy, past, or selectable.
   * @returns {Promise<void>}
   */
  async function renderTimetable() {
    if (!timetableRoomId) return;

    timetableGrid.innerHTML = '<p style="color:var(--muted);padding:12px;">Loading…</p>';
    updateWeekLabel();

    const data = await requestJson(`/api/timetable?roomId=${timetableRoomId}&weekStart=${weekStart}`);
    if (!data || !Array.isArray(data.dates)) {
      timetableGrid.innerHTML = '<p style="color:var(--muted);padding:12px;">Could not load timetable.</p>';
      return;
    }

    let { dates, bookings } = data;
    const today = getTodayDateString();

    // Ensure dates start on Monday and end on Sunday
    if (dates.length === 7) {
      const [year, month, day] = dates[0].split('-').map(Number);
      const firstDayOfWeek = new Date(year, month - 1, day).getDay();
      if (firstDayOfWeek === 0) { // Sunday from previous week
        dates = dates.slice(1); // Remove that Sunday
        // Add the correct Sunday (6 days after the new first date)
        dates.push(shiftDate(dates[0], 6));
      }
    }

    // Build occupied set: key = `${date}:${slotLabel}`
    const occupied = new Set();
    for (const booking of bookings) {
      const [hour, minute] = booking.startTime.split(':').map(Number);
      const totalSlots = Math.round(Number(booking.durationHours) / 0.5);
      for (let i = 0; i < totalSlots; i++) {
        const mins = hour * 60 + minute + i * 30;
        const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
        occupied.add(`${booking.date}:${label}`);
      }
    }

    // 8 columns: time label + 7 days
    let html = '<div class="timetable" style="--tt-cols:8;">';

    // Header row: blank corner + day headers
    html += '<div class="tt-header tt-corner"></div>';
    for (let i = 0; i < 7; i++) {
      const dateStr = dates[i];
      const isToday = dateStr === today;
      const [year, month, day] = dateStr.split('-').map(Number);
      const dayOfWeek = new Date(year, month - 1, day).getDay();
      const dayName = DAY_NAMES[(dayOfWeek + 6) % 7]; // Convert Sunday=0 to Monday=0
      html += `<div class="tt-header${isToday ? ' tt-today' : ''}">${dayName}<span class="tt-location">${formatDayLabel(dateStr)}</span></div>`;
    }

    // Time rows
    for (let mins = TIMETABLE_START_HOUR * 60; mins < TIMETABLE_END_HOUR * 60; mins += 30) {
      const slotLabel = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

      html += `<div class="tt-time">${slotLabel}</div>`;

      for (let i = 0; i < 7; i++) {
        const dateStr = dates[i];
        const busy = occupied.has(`${dateStr}:${slotLabel}`);
        const isPast = dateStr < today || (dateStr === today && slotLabel < getTodayDateString().slice(0, 5));

        if (busy) {
          html += `<div class="tt-cell tt-busy" title="Booked"></div>`;
        } else if (isPast) {
          html += `<div class="tt-cell tt-past"></div>`;
        } else {
          html += `<div class="tt-cell tt-free" data-date="${dateStr}" data-slot-time="${slotLabel}" title="Book at ${slotLabel} on ${formatDayLabel(dateStr)}"></div>`;
        }
      }
    }

    html += '</div>';
    timetableGrid.innerHTML = html;
  }

  /**
   * Handle timetable room selection changes and refresh timetable state.
   * @returns {void}
   */
  timetableRoomSelect.addEventListener('change', () => {
    const selected = timetableRoomSelect.options[timetableRoomSelect.selectedIndex];
    timetableRoomId = selected.value ? Number(selected.value) : null;
    timetableRoomName = selected.text;

    if (timetableRoomId) {
      timetableWeekNav.classList.remove('hidden');
      renderTimetable();
    } else {
      timetableWeekNav.classList.add('hidden');
      timetableGrid.innerHTML = '';
    }
  });

  /** Navigate one week backward in the timetable. */
  timetablePrev.addEventListener('click', () => {
    weekStart = shiftDate(weekStart, -7);
    renderTimetable();
  });

  /** Navigate one week forward in the timetable. */
  timetableNext.addEventListener('click', () => {
    weekStart = shiftDate(weekStart, 7);
    renderTimetable();
  });

  /** Jump the timetable to the current week. */
  timetableToday.addEventListener('click', () => {
    weekStart = getMondayOf(getTodayDateString());
    renderTimetable();
  });

  // Clicking a free timetable cell opens the booking form pre-filled.
  timetableGrid.addEventListener('click', (event) => {
    const cell = event.target.closest('.tt-free[data-date]');
    if (!cell) return;
    const date = cell.dataset.date;
    const slotTime = cell.dataset.slotTime;
    bookingDateInput.value = date;
    openBookingPanel(timetableRoomId, timetableRoomName, slotTime);
  });

  // ── Booking form ───────────────────────────────────────────────────────────
  /**
   * Keep start-time minimum aligned with selected booking date.
   * Uses next quarter-hour for today and a default morning value for future dates.
   * @returns {void}
   */
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

  /**
   * Apply initial constraints for booking date/time fields.
   */
  function setBookingConstraints() {
    const today = getTodayDateString();
    bookingDateInput.min = today;
    if (!bookingDateInput.value || bookingDateInput.value < today) {
      bookingDateInput.value = today;
    }
    updateBookingTimeMin();
  }

  /**
   * Hide the booking panel.
   */
  function hideBookingPanel() {
    bookingPanel.classList.add('hidden');
  }

  /**
   * Open the booking panel for a room.
   * @param {number} roomId Room identifier.
   * @param {string} roomName Room display name.
   * @param {string} [presetTime] Optional HH:MM to pre-fill the start time.
   */
  function openBookingPanel(roomId, roomName, presetTime) {
    activeBookingRoomId = roomId;
    bookingRoomName.textContent = roomName;
    bookingDurationInput.value = '0.5';
    bookingRecurringInput.checked = false;
    bookingRecurrenceCountInput.value = '4';
    bookingRecurrenceCountLabel.classList.add('hidden');
    bookingError.textContent = '';
    setBookingConstraints();
    if (presetTime) {
      bookingStartTimeInput.value = presetTime;
    }

    const room = roomsById.get(roomId);
    bookingPolicyNote.textContent = describeRoomPolicy(room);
    if (room?.minDurationMinutes != null) {
      bookingDurationInput.min = String(room.minDurationMinutes / 60);
    } else {
      bookingDurationInput.min = '0.5';
    }
    if (room?.maxDurationMinutes != null) {
      bookingDurationInput.max = String(room.maxDurationMinutes / 60);
    } else {
      bookingDurationInput.removeAttribute('max');
    }

    bookingPanel.classList.remove('hidden');
    bookingPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  bookingRecurringInput.addEventListener('change', () => {
    bookingRecurrenceCountLabel.classList.toggle('hidden', !bookingRecurringInput.checked);
  });

  bookingDateInput.addEventListener('change', () => {
    updateBookingTimeMin();
    bookingError.textContent = '';
  });

  /** Close the booking panel when cancel is clicked. */
  bookingCancel.addEventListener('click', () => {
    hideBookingPanel();
  });

  /**
   * Submit room booking after validating date/time/duration fields.
   * @param {SubmitEvent} event
   * @returns {Promise<void>}
   */
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

    let recurrence = null;
    if (bookingRecurringInput.checked) {
      const occurrences = Number(bookingRecurrenceCountInput.value);
      if (!Number.isInteger(occurrences) || occurrences < 2 || occurrences > 52) {
        bookingError.textContent = 'Number of occurrences must be a whole number between 2 and 52.';
        return;
      }
      recurrence = { frequency: 'weekly', occurrences };
    }

    const result = await requestJson('/api/book-room', {
      method: 'POST',
      body: JSON.stringify({
        roomId: activeBookingRoomId,
        date,
        startTime,
        durationHours,
        recurrence
      })
    });

    if (result.error) {
      bookingError.textContent = result.error;
      return;
    }

    const durationLabel = formatDuration(durationHours);
    const recurrenceLabel = recurrence ? `\nRepeats weekly for ${recurrence.occurrences} occurrences.` : '';
    if (result.status === 'pending') {
      alert(`Booking request submitted!\n\nRoom: ${bookingRoomName.textContent}\nDate: ${date}\nStart: ${startTime}\nDuration: ${durationLabel}${recurrenceLabel}\n\nThis room requires admin approval — you'll see it as "Pending approval" until reviewed.`);
    } else {
      alert(`Booking confirmed!\n\nRoom: ${bookingRoomName.textContent}\nDate: ${date}\nStart: ${startTime}\nDuration: ${durationLabel}${recurrenceLabel}`);
    }
    hideBookingPanel();
    renderTimetable();
    await onBookingCreated();
  });

  /**
   * Render available room cards and populate the timetable room dropdown.
    * @param {RoomSummary[]} rooms Rooms list.
    * @returns {void}
   */
  function render(rooms) {
    roomsById = new Map((Array.isArray(rooms) ? rooms : []).map((room) => [room.id, room]));

    if (!Array.isArray(rooms) || rooms.length === 0) {
      renderListState(roomsList, { kind: 'empty', message: 'No rooms available.' });
      timetableRoomSelect.innerHTML = '<option value="">— Select a room —</option>';
      timetableWeekNav.classList.add('hidden');
      timetableGrid.innerHTML = '';
      return;
    }

    roomsList.innerHTML = rooms.map((room) => {
      return `
        <div class="item-row">
          <div>
            <strong>${room.name}</strong>
            <p>${room.location}</p>
          </div>
        </div>
      `;
    }).join('');

    // Repopulate the timetable room dropdown, preserving selection if still valid.
    const prevValue = timetableRoomSelect.value;
    timetableRoomSelect.innerHTML = '<option value="">— Select a room —</option>'
      + rooms.map((room) => `<option value="${room.id}">${room.name} — ${room.location}</option>`).join('');
    if (prevValue && rooms.some((r) => String(r.id) === prevValue)) {
      timetableRoomSelect.value = prevValue;
    }
  }

  return {
    render,
    hideBookingPanel,
    loadTimetable: renderTimetable
  };
}
