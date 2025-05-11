import { IAuthProvider, IUserIdentity } from '@kinable/common-types';

// Mock implementation that can be configured for tests
const mockVerifyToken = jest.fn();

export class CognitoAuthProvider implements IAuthProvider {
  constructor(userPoolId: string, clientId: string, tokenUse: string = 'id') {
    // Constructor implementation is not needed for testing
    console.log('Mock CognitoAuthProvider constructor called:', { userPoolId, clientId, tokenUse });
  }

  // This method will be replaced by a Jest mock function in tests
  verifyToken(token: string): Promise<IUserIdentity | null> {
    return mockVerifyToken(token);
  }
}

// Export the mock function for tests to configure
export const __mockVerifyToken = mockVerifyToken; 