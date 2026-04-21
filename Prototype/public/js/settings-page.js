/**
 * User settings page module.
 * Handles password change workflow for the signed-in user.
 */

/**
 * Build settings page controller.
 * @param {{
 *   changePasswordForm: HTMLFormElement,
 *   currentPasswordInput: HTMLInputElement,
 *   newPasswordInput: HTMLInputElement,
 *   confirmNewPasswordInput: HTMLInputElement,
 *   changePasswordError: HTMLElement,
 *   changePasswordSuccess: HTMLElement,
 *   requestJson: (url: string, options?: RequestInit) => Promise<any>
 * }} deps
 */
export function createSettingsPage(deps) {
  const {
    changePasswordForm,
    currentPasswordInput,
    newPasswordInput,
    confirmNewPasswordInput,
    changePasswordError,
    changePasswordSuccess,
    requestJson
  } = deps;

  function clearMessages() {
    changePasswordError.textContent = '';
    changePasswordSuccess.textContent = '';
  }

  changePasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessages();

    const currentPassword = currentPasswordInput.value.trim();
    const newPassword = newPasswordInput.value.trim();
    const confirmNewPassword = confirmNewPasswordInput.value.trim();

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      changePasswordError.textContent = 'All password fields are required.';
      return;
    }

    if (newPassword.length < 8) {
      changePasswordError.textContent = 'New password must be at least 8 characters long.';
      return;
    }

    if (newPassword !== confirmNewPassword) {
      changePasswordError.textContent = 'New passwords do not match.';
      return;
    }

    const result = await requestJson('/api/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });

    if (result.error) {
      changePasswordError.textContent = result.error;
      return;
    }

    changePasswordForm.reset();
    changePasswordSuccess.textContent = result.message || 'Password changed successfully.';
  });

  return {
    clearMessages
  };
}
