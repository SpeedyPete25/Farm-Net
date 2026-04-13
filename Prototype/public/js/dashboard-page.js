export function createDashboardPage({ requestsList, formatDuration, onCancelBooking, onCancelLoan }) {
  requestsList.addEventListener('click', async (event) => {
    const cancelBookingBtn = event.target.closest('[data-action="cancel-booking"]');
    if (cancelBookingBtn) {
      const bookingId = Number(cancelBookingBtn.dataset.bookingId);
      if (Number.isFinite(bookingId)) {
        await onCancelBooking(bookingId);
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
              ${!isPast && !isCancelled ? `<button class="cancel-button" data-action="cancel-booking" data-booking-id="${booking.id}">Cancel</button>` : ''}
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
              ${(!isExpired && !isCancelled) ? `<button class="cancel-button" data-action="cancel-loan" data-loan-id="${loan.id}">Cancel</button>` : ''}
            </div>
          `;
          }).join('')}
        </div>
      </div>
    `;
  }

  return { render };
}
