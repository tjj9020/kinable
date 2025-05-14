import { CognitoAuthProvider } from './CognitoAuthProvider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { IUserIdentity } from '@kinable/common-types';
import { JwtInvalidSignatureError } from 'aws-jwt-verify/error';

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
    authProvider = new CognitoAuthProvider({ userPoolId, clientId, tokenUse: 'id' });
  });

  it('should throw an error if userPoolId or clientId is missing', () => {
    expect(() => new CognitoAuthProvider({ userPoolId: '', clientId, tokenUse: 'id' })).toThrow(
      'Cognito User Pool ID and Client ID must be provided.'
    );
    expect(() => new CognitoAuthProvider({ userPoolId, clientId: '', tokenUse: 'id' })).toThrow(
      'Cognito User Pool ID and Client ID must be provided.'
    );
  });

  it('should return IUserIdentity on successful token verification', async () => {
    const mockToken = 'valid.jwt.token';
    const mockPayload = {
      sub: 'test-sub-123',
      email: 'test@example.com',
      'custom:familyId': 'fam123',
      'custom:profileId': 'prof456',
      'custom:role': 'guardian',
      name: 'Test User',
      'custom:region': 'us-east-1'
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
      region: 'us-east-1',
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
    mockVerify.mockRejectedValue(new JwtInvalidSignatureError('Invalid signature'));

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
      'custom:familyId': 'fam789',
      'custom:role': 'child',
    };
    mockVerify.mockResolvedValue(mockPayload);

    const expectedIdentity: Partial<IUserIdentity> = {
      userId: 'test-sub-789',
      email: undefined,
      familyId: 'fam789',
      profileId: null,
      role: 'child',
      isAuthenticated: true,
      displayName: undefined,
      region: null,
    };

    const result = await authProvider.verifyToken(mockToken);
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
      'custom:familyId': 'famRegion',
      'custom:profileId': 'profRegion',
      'custom:role': 'guardian',
      'custom:region': mockRegion,
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
      'custom:region': 123,
    };
    mockVerify.mockResolvedValue(mockPayload);

    const result = await authProvider.verifyToken(mockToken);
    expect(result?.region).toBeNull();
  });

}); 