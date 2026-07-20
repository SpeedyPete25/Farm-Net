const fs = require('fs');
const path = require('path');

const testDataDir = path.join(__dirname, '..', '.test-data');

fs.rmSync(testDataDir, { recursive: true, force: true });
console.log(`Cleared test data at ${testDataDir}`);