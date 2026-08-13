/**
 * Dashboard page module.
 * Renders current user's bookings/loans and handles cancellation actions.
 */

/**
 * @typedef {{
 *   id: number,
 *   date: string,
 *   startTime: string,
 *   durationHours: number|string,
 *   roomName: string,
 *   location: string,
 *   status: string,
 *   seriesId?: number|null,
 *   seriesPosition?: number|null,
 *   seriesTotal?: number|null,
 *   returnCondition?: string,
 *   returnConditionPhotoPath?: string,
 *   returnedAt?: string
 * }} DashboardBooking
 */

/**
 * @typedef {{
 *   id: number,
 *   borrowDate: string,
 *   returnDate: string,
 *   equipmentName: string,
 *   equipmentCode?: string,
 *   status: string,
 *   returnCondition?: string,
 *   returnConditionPhotoPath?: string,
 *   returnedAt?: string
 * }} DashboardLoan
 */

/**
 * @typedef {{ bookings: DashboardBooking[], loans: DashboardLoan[] }} DashboardRequests
 */

/**
 * @typedef {{
 *   requestsList: HTMLElement,
 *   formatDuration: (duration: number|string) => string,
 *   onCancelBooking: (bookingId: number) => Promise<void>,
 *   onCancelBookingSeries: (seriesId: number) => Promise<void>,
 *   onCancelLoan: (loanId: number) => Promise<void>,
 *   onReturnLoan: (loanId: number) => Promise<void>,
 *   onEditBooking: (booking: { id: number, date: string, startTime: string, durationHours: number|string }) => Promise<void>,
 *   onEditBookingSeries: (booking: { id: number, date: string, startTime: string, durationHours: number|string }) => Promise<void>,
 *   onEditLoan: (loan: { id: number, borrowDate: string, returnDate: string }) => Promise<void>
 * }} DashboardPageDeps
 */

/**
 * @typedef {{
 *   render: (requests: DashboardRequests) => void
 * }} DashboardPageApi
 */

/**
 * Build the dashboard page controller.
 * @param {DashboardPageDeps} deps Dependency bag.
 * @returns {DashboardPageApi} Dashboard page API.
 */
export function createDashboardPage({ requestsList, formatDuration, onCancelBooking, onCancelBookingSeries, onCancelLoan, onReturnLoan, onEditBooking, onEditBookingSeries, onEditLoan }) {
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

    const editSeriesBtn = event.target.closest('[data-action="edit-booking-series"]');
    if (editSeriesBtn) {
      const bookingId = Number(editSeriesBtn.dataset.bookingId);
      const date = editSeriesBtn.dataset.bookingDate || '';
      const startTime = editSeriesBtn.dataset.bookingStartTime || '';
      const durationHours = Number(editSeriesBtn.dataset.bookingDurationHours);

      if (Number.isFinite(bookingId)) {
        await onEditBookingSeries({
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

    const cancelSeriesBtn = event.target.closest('[data-action="cancel-booking-series"]');
    if (cancelSeriesBtn) {
      const seriesId = Number(cancelSeriesBtn.dataset.seriesId);
      if (Number.isFinite(seriesId)) {
        await onCancelBookingSeries(seriesId);
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
      return;
    }

    const returnLoanBtn = event.target.closest('[data-action="return-loan"]');
    if (returnLoanBtn) {
      const loanId = Number(returnLoanBtn.dataset.loanId);
      if (Number.isFinite(loanId)) {
        await onReturnLoan(loanId);
      }
    }
  });

  /**
   * Render bookings and loans cards for the dashboard page.
    * @param {DashboardRequests} requests Request data from the API.
    * @returns {void}
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
            const isPending = booking.status === 'pending';
            const isDenied = booking.status === 'denied';
            const isEditable = (booking.status === 'active' || isPending) && !isPast;
            let statusLabel = '';

            if (isCancelled) {
              statusLabel = '<span class="status-label cancelled">Cancelled</span>';
            } else if (isDenied) {
              statusLabel = '<span class="status-label denied">Denied</span>';
            } else if (isPending) {
              statusLabel = '<span class="status-label pending">Pending approval</span>';
            } else if (isPast) {
              statusLabel = '<span class="status-label past">Past booking</span>';
            }

            const isRecurring = booking.seriesId != null;
            const recurringLabel = (booking.seriesPosition != null && booking.seriesTotal != null)
              ? `Recurring · Occurrence ${booking.seriesPosition} of ${booking.seriesTotal}`
              : 'Recurring';

            return `
            <div class="request-card ${(isCancelled || isDenied) ? 'cancelled' : ''}">
              <strong>${booking.roomName}</strong>
              <p>${booking.location}</p>
              <p>Date: ${booking.date} · Time: ${booking.startTime} · ${formatDuration(booking.durationHours)}</p>
              ${isRecurring ? `<span class="status-label recurring">${recurringLabel}</span>` : ''}
              ${statusLabel}
              ${isEditable ? `
                <div class="request-actions">
                  <button class="secondary action-button" data-action="edit-booking" data-booking-id="${booking.id}" data-booking-date="${booking.date}" data-booking-start-time="${booking.startTime}" data-booking-duration-hours="${booking.durationHours}">Edit</button>
                  <button class="cancel-button" data-action="cancel-booking" data-booking-id="${booking.id}">Cancel</button>
                  ${isRecurring ? `<button class="secondary action-button" data-action="edit-booking-series" data-booking-id="${booking.id}" data-booking-date="${booking.date}" data-booking-start-time="${booking.startTime}" data-booking-duration-hours="${booking.durationHours}">Edit series</button>` : ''}
                  ${isRecurring ? `<button class="cancel-button" data-action="cancel-booking-series" data-series-id="${booking.seriesId}">Cancel series</button>` : ''}
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
            const isReturned = loan.status === 'returned';
            let statusLabel = '';

            if (isCancelled) {
              statusLabel = '<span class="status-label cancelled">Cancelled</span>';
            } else if (isReturned) {
              statusLabel = '<span class="status-label returned">Returned</span>';
            } else if (isExpired) {
              statusLabel = '<span class="status-label past">Expired</span>';
            }

            const hasCondition = typeof loan.returnCondition === 'string' && loan.returnCondition.trim().length > 0;
            const photoText = loan.returnConditionPhotoPath
              ? `Photo: <a href="/api/loans/${loan.id}/photo" target="_blank" rel="noopener noreferrer">View photo</a>`
              : 'Photo: None';

            return `
            <div class="request-card ${isCancelled ? 'cancelled' : ''}">
              <strong>${loan.equipmentName}</strong>
              ${loan.equipmentCode ? `<p>Assigned item: ${loan.equipmentCode}</p>` : ''}
              <p>Borrowed: ${loan.borrowDate}</p>
              <p>Return by: ${loan.returnDate}</p>
              ${loan.returnedAt ? `<p>Returned at: ${new Date(loan.returnedAt).toLocaleString()}</p>` : ''}
              ${hasCondition ? `<p>Condition: ${loan.returnCondition}</p>` : ''}
              ${(isReturned || hasCondition) ? `<p>${photoText}</p>` : ''}
              ${statusLabel}
              ${(loan.status === 'active') ? `
                <div class="request-actions">
                  <button class="secondary action-button" data-action="edit-loan" data-loan-id="${loan.id}" data-loan-borrow-date="${loan.borrowDate}" data-loan-return-date="${loan.returnDate}">Edit</button>
                  <button class="action-button" data-action="return-loan" data-loan-id="${loan.id}">Return</button>
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
