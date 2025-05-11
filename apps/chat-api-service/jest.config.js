module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\.(ts|tsx)$': ['ts-jest', {
      // ts-jest configuration options
      tsconfig: 'tsconfig.json' // Or tsconfig.test.json if you have a specific one
    }]
  },
  moduleNameMapper: {
    // Handle module aliases (if you have them in tsconfig.paths)
    // e.g., '@src/(.*)': '<rootDir>/src/$1'
  },
  // setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'], // if you have a setup file
}; 