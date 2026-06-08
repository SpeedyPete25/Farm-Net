const path = require('path');

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: path.join(__dirname, 'tests', 'browser'),
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3201',
    headless: true,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node server.js',
    cwd: __dirname,
    url: 'http://127.0.0.1:3201/api/profile',
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: '3201',
      EMAIL_VERIFICATION_ENABLED: 'false',
      DATA_DIR: path.join(__dirname, '.test-data', 'browser')
    }
  }
};