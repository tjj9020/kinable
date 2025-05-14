module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\.(ts|tsx)$': ['ts-jest', {
      // ts-jest configuration options
      tsconfig: 'tsconfig.test.json' // Use the test-specific config
    }]
  },
  moduleNameMapper: {
    // Handle module aliases (if you have them in tsconfig.paths)
    // e.g., '@src/(.*)': '<rootDir>/src/$1'
    '^node-fetch$': require.resolve('node-fetch'),
    '^amazon-cognito-identity-js$': require.resolve('amazon-cognito-identity-js'),
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  preset: 'ts-jest',
}; 