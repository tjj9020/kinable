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
    
    // Set PROVIDER_HEALTH_TABLE from TEST_DYNAMODB_TABLE_PROVIDERHEALTH
    if (result.parsed.TEST_DYNAMODB_TABLE_PROVIDERHEALTH) {
      process.env.PROVIDER_HEALTH_TABLE = result.parsed.TEST_DYNAMODB_TABLE_PROVIDERHEALTH;
      console.log(`[Jest Setup] PROVIDER_HEALTH_TABLE set to: ${process.env.PROVIDER_HEALTH_TABLE}`);
    } else {
      console.warn('[Jest Setup] TEST_DYNAMODB_TABLE_PROVIDERHEALTH not found in .env.dev.remote. Circuit breaker tests might fail.');
    }
  } else {
    console.log('[Jest Setup] .env.dev.remote was loaded but was empty or only had comments.');
  }
} 

process.on('unhandledRejection', (reason, promise) => {
  console.error('!!! GLOBALLY UNHANDLED REJECTION !!!');
  console.error('Reason:', reason);
  // console.error('Promise:', promise); // Can be very verbose
});

process.on('uncaughtException', (error) => {
  console.error('!!! GLOBALLY UNCAUGHT EXCEPTION !!!');
  console.error('Error:', error);
}); 