-- Runs once when the Postgres container's data volume is first created.
-- Creates a second, separate database for the automated test suite so
-- `npm test` never touches the dev database's data.
CREATE DATABASE farmnet_test;
