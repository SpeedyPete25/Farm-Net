const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const testDataDir = path.join(__dirname, '..', '.test-data');

// The dedicated test database is separate from the dev database (see
// scripts/init-test-db.sql / docker-compose.yml) so this can never wipe real data.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgres://farmnet:farmnet@localhost:5432/farmnet_test';

async function resetDatabase() {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    // Wipe every table the app might have created, then let initDatabase() recreate
    // and reseed a clean schema on the next server startup.
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}

resetDatabase()
  .then(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    console.log(`Cleared test database (${TEST_DATABASE_URL}) and test data at ${testDataDir}`);
  })
  .catch((err) => {
    console.error('Failed to reset test database:', err.message);
    console.error('Is the local Postgres container running? Try: docker compose up -d');
    process.exit(1);
  });
