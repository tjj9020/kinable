import { IAuthProvider, IUserIdentity } from '@kinable/common-types';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { CognitoIdTokenPayload, CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';

// Helper to safely get string claims
function getStringClaim(payload: any, claimName: string): string | null {
  const claim = payload[claimName];
  return typeof claim === 'string' ? claim : null;
}

function getRoleClaim(payload: any, claimName: string): string {
  const claim = payload[claimName];
  return typeof claim === 'string' ? claim : 'unknown';
}

export class CognitoAuthProvider implements IAuthProvider {
  private verifier;
  private userPoolId: string;
  private clientId: string;
  private tokenUse: 'id' | 'access';

  constructor(config: { userPoolId: string; tokenUse: 'id' | 'access'; clientId: string }) {
    if (!config.userPoolId || !config.clientId) {
      throw new Error('Cognito User Pool ID and Client ID must be provided.');
    }
    this.userPoolId = config.userPoolId;
    this.clientId = config.clientId;
    this.tokenUse = config.tokenUse; // 'id' for ID tokens, 'access' for access tokens
    this.verifier = CognitoJwtVerifier.create(config);
  }

  public async verifyToken(token: string): Promise<IUserIdentity | null> {
    try {
      const payload = await this.verifier.verify(token) as CognitoIdTokenPayload | CognitoAccessTokenPayload;

      let displayNameValue: string | undefined = undefined;
      if (typeof payload.name === 'string') {
        displayNameValue = payload.name;
      } else if (typeof payload.preferred_username === 'string') {
        displayNameValue = payload.preferred_username;
      } else {
        const cUsername = (payload as any)['cognito:username'];
        if (typeof cUsername === 'string') {
          displayNameValue = cUsername;
        }
      }

      const userIdentity: IUserIdentity = {
        userId: payload.sub || (payload as CognitoAccessTokenPayload).username || '',
        email: getStringClaim(payload, 'email') || undefined,
        familyId: getStringClaim(payload, 'custom:familyId'),
        profileId: getStringClaim(payload, 'custom:profileId'),
        role: getRoleClaim(payload, 'custom:role'),
        isAuthenticated: true,
        displayName: displayNameValue,
        region: getStringClaim(payload, 'custom:region'),
      };

      if (!userIdentity.userId) {
        console.error('User identifier (sub or username) not found in token payload.');
        return null;
      }

      return userIdentity;
    } catch (error: unknown) {
      console.error('Token verification failed:', error);
      return null;
    }
  }

  // Helper function to decode JWT (if needed elsewhere, keep, otherwise can remove)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private decodeToken(token: string): Record<string, unknown> | null {
    try {
      const [_header, payloadBase64, _signature] = token.split('.');
      if (!payloadBase64) {
        return null;
      }
      const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
      return JSON.parse(payloadJson);
    } catch (error: unknown) {
      console.error('Error decoding token:', error);
      return null;
    }
  }
} 