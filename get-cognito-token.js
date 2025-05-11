// Simple script to authenticate a user in Amazon Cognito and get their tokens
const { exec } = require('child_process');

// Configuration - change these values
const USER_POOL_ID = 'us-east-2_bdkYVDzIQ';
const CLIENT_ID = '2dv7defismd0m2mlg9s0vvofoe';
const USERNAME = 'test@example.com'; // Change this to your test user
const PASSWORD = 'TestPassword123!'; // Change this to your test user's password

// Authenticate using admin-initiate-auth (requires AWS credentials)
const command = `aws cognito-idp admin-initiate-auth \
  --user-pool-id ${USER_POOL_ID} \
  --client-id ${CLIENT_ID} \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=${USERNAME},PASSWORD=${PASSWORD} \
  --profile kinable-dev`;

console.log(`Authenticating user ${USERNAME}...`);
exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`stderr: ${stderr}`);
    return;
  }

  try {
    const response = JSON.parse(stdout);
    console.log('\nAuthentication successful!');
    
    if (response.AuthenticationResult) {
      // For normal authentication flow
      console.log('\nID Token (for JWT Authorizer):');
      console.log(response.AuthenticationResult.IdToken);
      
      console.log('\n\nAccess Token:');
      console.log(response.AuthenticationResult.AccessToken);
      
      console.log('\n\nRefresh Token:');
      console.log(response.AuthenticationResult.RefreshToken);

      console.log('\n\nTo test the API with this token:');
      console.log(`curl -H "Authorization: Bearer ${response.AuthenticationResult.IdToken}" https://u2xkxe75t1.execute-api.us-east-2.amazonaws.com/hello`);
    } else if (response.ChallengeName) {
      // For authentication challenges (NEW_PASSWORD_REQUIRED, etc.)
      console.log(`\nChallenge required: ${response.ChallengeName}`);
      console.log('Session:', response.Session);
    }
  } catch (e) {
    console.error('Failed to parse response:', e.message);
    console.log('Raw output:', stdout);
  }
}); 