const nxPreset = require('@nx/jest/preset').default;

module.exports = {
  ...nxPreset,
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', {}]
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageReporters: ['html', 'lcov', 'text']
};
