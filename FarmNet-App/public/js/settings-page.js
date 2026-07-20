/**
 * User settings page module.
 * Handles password and theme preference workflows for the signed-in user.
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
 *   themeDarkToggle: HTMLInputElement,
 *   themeSettingsError: HTMLElement,
 *   themeSettingsSuccess: HTMLElement,
 *   applyTheme: (theme: string) => void,
 *   requestJson: (url: string, options?: RequestInit) => Promise<any>
 * }} deps
 * @returns {{
 *   clearMessages: () => void,
 *   setTheme: (theme: string) => void
 * }} Settings page controller API.
 */
export function createSettingsPage(deps) {
  const {
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
  } = deps;

  // Prevents recursive theme toggle events when the UI is updated programmatically.
  let syncingThemeInput = false;

  /**
   * Clear all success/error messages on the settings page.
   */
  function clearMessages() {
    changePasswordError.textContent = '';
    changePasswordSuccess.textContent = '';
    themeSettingsError.textContent = '';
    themeSettingsSuccess.textContent = '';
  }

  /**
   * Apply a theme value to both UI state and global app theme.
   * Any non-"light" value is treated as "dark" for safety.
   * @param {string} theme Requested theme name.
   */
  function setTheme(theme) {
    const normalizedTheme = theme === 'light' ? 'light' : 'dark';
    syncingThemeInput = true;
    themeDarkToggle.checked = normalizedTheme === 'dark';
    syncingThemeInput = false;
    applyTheme(normalizedTheme);
  }

  /**
   * Persist theme selection when the toggle changes.
   * Reverts the toggle on API failure to keep UI and server state in sync.
   */
  themeDarkToggle.addEventListener('change', async () => {
    if (syncingThemeInput) {
      return;
    }

    themeSettingsError.textContent = '';
    themeSettingsSuccess.textContent = '';

    const selectedTheme = themeDarkToggle.checked ? 'dark' : 'light';
    const result = await requestJson('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ theme: selectedTheme })
    });

    if (result.error) {
      themeSettingsError.textContent = result.error;
      syncingThemeInput = true;
      themeDarkToggle.checked = !themeDarkToggle.checked;
      syncingThemeInput = false;
      return;
    }

    applyTheme(selectedTheme);
    themeSettingsSuccess.textContent = 'Theme preference saved.';
  });

  /**
   * Submit password change request with client-side validation.
   * Validates required fields, minimum password length, and confirmation match.
   */
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
    clearMessages,
    setTheme
  };
}
