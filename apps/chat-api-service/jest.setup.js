const dotenv = require('dotenv');
const path = require('path');

// Construct the absolute path to the .env.dev.remote file
// __dirname here will be apps/chat-api-service/, so ./.env.dev.remote points to the correct file in the same directory.
const envPath = path.resolve(__dirname, './.env.dev.remote'); // Corrected path

console.log(`[Jest Setup] Attempting to load environment variables from: ${envPath}`);
const result = dotenv.config({ path: envPath, debug: true }); // Enable dotenv debug

if (result.error) {
  console.error('[Jest Setup] Error loading .env.dev.remote:', result.error);
} else {
  console.log('[Jest Setup] Successfully loaded .env.dev.remote. Parsed variables:');
  // Optionally log parsed variables, but be careful with secrets
  // For debugging, you might temporarily log Object.keys(result.parsed)
  if (result.parsed) {
    console.log(`[Jest Setup] AWS_PROFILE loaded: ${result.parsed.AWS_PROFILE}`);
    console.log(`[Jest Setup] TEST_AWS_REGION loaded: ${result.parsed.TEST_AWS_REGION}`);
    console.log(`[Jest Setup] TEST_STACK_NAME loaded: ${result.parsed.TEST_STACK_NAME}`); // Check if it's present after parsing
  } else {
    console.log('[Jest Setup] .env.dev.remote was loaded but was empty or only had comments.');
  }
} 