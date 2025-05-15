import { IUserIdentity } from './core-interfaces';

describe('IUserIdentity Contract', () => {
  it('should adhere to the IUserIdentity structure', () => {
    const exampleUserIdentity: IUserIdentity = {
      userId: 'test-user-123',
      familyId: 'family-abc',
      profileId: 'profile-xyz',
      role: 'child',
      isAuthenticated: true,
      displayName: 'Test User',
      email: 'test@example.com',
      region: 'us-east-1',
    };

    // Basic structural check
    expect(exampleUserIdentity).toEqual(
      expect.objectContaining({
        userId: expect.any(String),
        familyId: expect.toBeOneOf([expect.any(String), null]),
        profileId: expect.toBeOneOf([expect.any(String), null]),
        role: expect.any(String),
        isAuthenticated: expect.any(Boolean),
        displayName: expect.toBeOneOf([expect.any(String), undefined]),
        email: expect.toBeOneOf([expect.any(String), undefined]),
        region: expect.toBeOneOf([expect.any(String), null, undefined]),
      })
    );

    // Check for specific required fields
    expect(exampleUserIdentity.userId).toBeDefined();
    expect(exampleUserIdentity.role).toBeDefined();
    expect(exampleUserIdentity.isAuthenticated).toBeDefined();

    // Type check for non-optional fields
    expect(typeof exampleUserIdentity.userId).toBe('string');
    expect(typeof exampleUserIdentity.role).toBe('string');
    expect(typeof exampleUserIdentity.isAuthenticated).toBe('boolean');

    if (exampleUserIdentity.familyId !== null) {
      expect(typeof exampleUserIdentity.familyId).toBe('string');
    }
    if (exampleUserIdentity.profileId !== null) {
      expect(typeof exampleUserIdentity.profileId).toBe('string');
    }
    if (exampleUserIdentity.displayName !== undefined) {
      expect(typeof exampleUserIdentity.displayName).toBe('string');
    }
    if (exampleUserIdentity.email !== undefined) {
      expect(typeof exampleUserIdentity.email).toBe('string');
    }
    if (exampleUserIdentity.region !== null && exampleUserIdentity.region !== undefined) {
      expect(typeof exampleUserIdentity.region).toBe('string');
    }
  });

  it('should allow optional fields to be undefined or null where appropriate', () => {
    const minimalUserIdentity: IUserIdentity = {
      userId: 'min-user-456',
      familyId: null,
      profileId: null,
      role: 'guardian',
      isAuthenticated: true,
      // displayName, email, region are optional
    };

    expect(minimalUserIdentity).toEqual(
      expect.objectContaining({
        userId: 'min-user-456',
        familyId: null,
        profileId: null,
        role: 'guardian',
        isAuthenticated: true,
      })
    );
    expect(minimalUserIdentity.displayName).toBeUndefined();
    expect(minimalUserIdentity.email).toBeUndefined();
    expect(minimalUserIdentity.region).toBeUndefined();
  });
});

// Helper to extend Jest matchers if not already available globally
// In a real setup, this might come from a shared test utility or jest setup file
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Expect {
      toBeOneOf<E>(arr: E[]): E;
    }
    interface Matchers<R> {
      toBeOneOf<E>(arr: E[]): R;
    }
  }
}

if (typeof expect !== 'undefined' && !expect.toBeOneOf) {
  expect.extend({
    toBeOneOf(received: unknown, expectedPossibilities: unknown[]) {
      const pass = expectedPossibilities.some(expected => {
        if (expected === null && received === null) return true;
        if (expected === undefined && received === undefined) return true;
        if (typeof received === typeof expected) return true;
        // For expect.any(String) etc.
        if (typeof expected === 'function' && typeof received !== 'object' && received !== null) {
          try {
            expect(received).toEqual(expected);
            return true;
          } catch (e) {
            return false;
          }
        }
        return false;
      });

      if (pass) {
        return {
          message: () =>
            `expected ${received} not to be one of [${expectedPossibilities.join(', ')}]`,
          pass: true,
        };
      } else {
        return {
          message: () =>
            `expected ${received} to be one of [${expectedPossibilities.join(', ')}]`,
          pass: false,
        };
      }
    },
  });
} 