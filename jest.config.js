module.exports = {
  preset: 'jest-expo',
  // Transform packages that ship as ESM or need Babel
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|native-base|react-native-svg)',
  ],
  // Map the @/ alias defined in tsconfig.json
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Only collect coverage from business-logic source files
  collectCoverageFrom: [
    'src/utils/**/*.ts',
    'src/db/dbUtils.ts',
    'src/services/nutriscore.ts',
    'src/services/prompts/cloud.ts',
    'src/services/prompts/onDevice.ts',
    'src/modules/profiles/allergenEngine.ts',
    'src/modules/profiles/calorieCalculator.ts',
    'src/modules/groceries/groceryUtils.ts',
    '!**/*.d.ts',
  ],
}
