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
  private userPoolId: string;
  private clientId: string;
  private tokenUse: 'id' | 'access';

  constructor(userPoolId: string, clientId: string, tokenUse: 'id' | 'access' = 'id') {
    if (!userPoolId || !clientId) {
      throw new Error('Cognito User Pool ID and Client ID must be provided.');
    }
    this.userPoolId = userPoolId;
    this.clientId = clientId;
    this.tokenUse = tokenUse; // 'id' for ID tokens, 'access' for access tokens
  }

  public async verifyToken(token: string): Promise<IUserIdentity | null> {
    const verifier = CognitoJwtVerifier.create({
      userPoolId: this.userPoolId,
      tokenUse: this.tokenUse,
      clientId: this.clientId,
    });

    try {
      const payload = await verifier.verify(token) as CognitoIdTokenPayload | CognitoAccessTokenPayload;

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
    } catch (error) {
      console.error('Token validation error:', error);
      return null;
    }
  }
} 