import { CognitoAuthProvider } from './CognitoAuthProvider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { IUserIdentity } from '@kinable/common-types';

// Mock the CognitoJwtVerifier
const mockVerify = jest.fn();
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({
      verify: mockVerify,
    })),
  },
}));

describe('CognitoAuthProvider', () => {
  const userPoolId = 'us-east-1_testpool';
  const clientId = 'testclient';
  let authProvider: CognitoAuthProvider;

  beforeEach(() => {
    // Reset mocks before each test
    mockVerify.mockReset();
    (CognitoJwtVerifier.create as jest.Mock).mockClear();
    authProvider = new CognitoAuthProvider(userPoolId, clientId, 'id');
  });

  it('should throw an error if userPoolId or clientId is missing', () => {
    expect(() => new CognitoAuthProvider('', clientId)).toThrow(
      'Cognito User Pool ID and Client ID must be provided.'
    );
    expect(() => new CognitoAuthProvider(userPoolId, '')).toThrow(
      'Cognito User Pool ID and Client ID must be provided.'
    );
  });

  it('should return IUserIdentity on successful token verification', async () => {
    const mockToken = 'valid.jwt.token';
    const mockPayload = {
      sub: 'test-sub-123',
      email: 'test@example.com',
      'custom:custom:familyId': 'fam123',
      'custom:custom:profileId': 'prof456',
      'custom:custom:role': 'guardian',
      name: 'Test User',
    };
    mockVerify.mockResolvedValue(mockPayload);

    const expectedIdentity: IUserIdentity = {
      userId: 'test-sub-123',
      email: 'test@example.com',
      familyId: 'fam123',
      profileId: 'prof456',
      role: 'guardian',
      isAuthenticated: true,
      displayName: 'Test User',
      region: null,
    };

    const result = await authProvider.verifyToken(mockToken);
    expect(result).toEqual(expectedIdentity);
    expect(CognitoJwtVerifier.create).toHaveBeenCalledWith({
      userPoolId,
      tokenUse: 'id',
      clientId,
    });
    expect(mockVerify).toHaveBeenCalledWith(mockToken);
  });

  it('should return null if token verification fails', async () => {
    const mockToken = 'invalid.jwt.token';
    mockVerify.mockRejectedValue(new Error('Invalid token'));

    const result = await authProvider.verifyToken(mockToken);
    expect(result).toBeNull();
  });

  it('should return null if userId (sub/username) is missing in payload', async () => {
    const mockToken = 'valid.jwt.token';
    const mockPayload = { /* sub or username missing */ email: 'test@example.com' };
    mockVerify.mockResolvedValue(mockPayload);

    const result = await authProvider.verifyToken(mockToken);
    expect(result).toBeNull();
  });

   it('should correctly map claims when some optional claims are missing', async () => {
    const mockToken = 'valid.jwt.token';
    const mockPayload = {
      sub: 'test-sub-789',
      // email is missing
      'custom:custom:familyId': 'fam789',
      // profileId is missing
      'custom:custom:role': 'child',
      // name is missing
    };
    mockVerify.mockResolvedValue(mockPayload);

    const expectedIdentity: Partial<IUserIdentity> = {
      userId: 'test-sub-789',
      email: undefined, // or null depending on getStringClaim for missing email
      familyId: 'fam789',
      profileId: null,
      role: 'child',
      isAuthenticated: true,
      displayName: undefined,
      region: null,
    };

    const result = await authProvider.verifyToken(mockToken);
    // Adjusting expectation for email based on getStringClaim returning null then coalesced to undefined
    expect(result).toEqual(expect.objectContaining(expectedIdentity)); 
    expect(result?.email).toBeUndefined();
    expect(result?.region).toBeNull();
  });

  it('should correctly extract custom:region claim when present', async () => {
    const mockToken = 'valid.jwt.token.with.region';
    const mockRegion = 'us-west-2';
    const mockPayload = {
      sub: 'test-sub-region',
      email: 'region@example.com',
      'custom:custom:familyId': 'famRegion',
      'custom:custom:profileId': 'profRegion',
      'custom:custom:role': 'guardian',
      'custom:custom:region': mockRegion,
      name: 'Region User',
    };
    mockVerify.mockResolvedValue(mockPayload);

    const expectedIdentity: IUserIdentity = {
      userId: 'test-sub-region',
      email: 'region@example.com',
      familyId: 'famRegion',
      profileId: 'profRegion',
      role: 'guardian',
      isAuthenticated: true,
      displayName: 'Region User',
      region: mockRegion,
    };

    const result = await authProvider.verifyToken(mockToken);
    expect(result).toEqual(expectedIdentity);
  });

  it('should handle custom:region claim not being a string gracefully (as null)', async () => {
    const mockToken = 'valid.jwt.token.invalid.region';
    const mockPayload = {
      sub: 'test-sub-invalid-region',
      'custom:custom:region': 123, // Invalid type for region
    };
    mockVerify.mockResolvedValue(mockPayload);

    const result = await authProvider.verifyToken(mockToken);
    expect(result?.region).toBeNull();
  });

}); 