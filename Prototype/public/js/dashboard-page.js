/**
 * Dashboard page module.
 * Renders current user's bookings/loans and handles cancellation actions.
 */

/**
 * Build the dashboard page controller.
 * @param {Object} deps Dependency bag.
 * @param {HTMLElement} deps.requestsList Container for bookings/loans cards.
 * @param {(duration: number|string) => string} deps.formatDuration Duration formatter.
 * @param {(bookingId: number) => Promise<void>} deps.onCancelBooking Cancel booking callback.
 * @param {(loanId: number) => Promise<void>} deps.onCancelLoan Cancel loan callback.
 * @param {(booking: { id: number, date: string, startTime: string, durationHours: number|string }) => Promise<void>} deps.onEditBooking Edit booking callback.
 * @param {(loan: { id: number, borrowDate: string, returnDate: string }) => Promise<void>} deps.onEditLoan Edit loan callback.
 * @returns {{ render: (requests: any) => void }} Dashboard page API.
 */
export function createDashboardPage({ requestsList, formatDuration, onCancelBooking, onCancelLoan, onEditBooking, onEditLoan }) {
  requestsList.addEventListener('click', async (event) => {
    const editBookingBtn = event.target.closest('[data-action="edit-booking"]');
    if (editBookingBtn) {
      const bookingId = Number(editBookingBtn.dataset.bookingId);
      const date = editBookingBtn.dataset.bookingDate || '';
      const startTime = editBookingBtn.dataset.bookingStartTime || '';
      const durationHours = Number(editBookingBtn.dataset.bookingDurationHours);

      if (Number.isFinite(bookingId)) {
        await onEditBooking({
          id: bookingId,
          date,
          startTime,
          durationHours
        });
      }
      return;
    }

    const cancelBookingBtn = event.target.closest('[data-action="cancel-booking"]');
    if (cancelBookingBtn) {
      const bookingId = Number(cancelBookingBtn.dataset.bookingId);
      if (Number.isFinite(bookingId)) {
        await onCancelBooking(bookingId);
      }
      return;
    }

    const editLoanBtn = event.target.closest('[data-action="edit-loan"]');
    if (editLoanBtn) {
      const loanId = Number(editLoanBtn.dataset.loanId);
      const borrowDate = editLoanBtn.dataset.loanBorrowDate || '';
      const returnDate = editLoanBtn.dataset.loanReturnDate || '';

      if (Number.isFinite(loanId)) {
        await onEditLoan({
          id: loanId,
          borrowDate,
          returnDate
        });
      }
      return;
    }

    const cancelLoanBtn = event.target.closest('[data-action="cancel-loan"]');
    if (cancelLoanBtn) {
      const loanId = Number(cancelLoanBtn.dataset.loanId);
      if (Number.isFinite(loanId)) {
        await onCancelLoan(loanId);
      }
    }
  });

  /**
   * Render bookings and loans cards for the dashboard page.
   * @param {{ bookings: any[], loans: any[] }} requests Request data from the API.
   */
  function render(requests) {
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
              ${!isPast && !isCancelled ? `
                <div class="request-actions">
                  <button class="secondary action-button" data-action="edit-booking" data-booking-id="${booking.id}" data-booking-date="${booking.date}" data-booking-start-time="${booking.startTime}" data-booking-duration-hours="${booking.durationHours}">Edit</button>
                  <button class="cancel-button" data-action="cancel-booking" data-booking-id="${booking.id}">Cancel</button>
                </div>
              ` : ''}
            </div>
          `;
          }).join('')}
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
              ${(!isExpired && !isCancelled) ? `
                <div class="request-actions">
                  <button class="secondary action-button" data-action="edit-loan" data-loan-id="${loan.id}" data-loan-borrow-date="${loan.borrowDate}" data-loan-return-date="${loan.returnDate}">Edit</button>
                  <button class="cancel-button" data-action="cancel-loan" data-loan-id="${loan.id}">Cancel</button>
                </div>
              ` : ''}
            </div>
          `;
          }).join('')}
        </div>
      </div>
    `;
  }

  return { render };
}
