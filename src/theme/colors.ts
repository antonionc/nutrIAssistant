export const Colors = {
  // Brand tokens
  healthGreen: '#1D9E75',
  forestGreen: '#0F6E56',
  goldenAmber: '#D4A853',
  softMint: '#E1F5EE',
  warmCharcoal: '#2C2C2A',
  cream: '#F1EFE8',
  errorRed: '#E53E3E',
  warningOrange: '#ED8936',
  infoBlue: '#3182CE',
  white: '#FFFFFF',
  black: '#000000',

  // Semantic light mode
  light: {
    background: '#F1EFE8',
    surface: '#FFFFFF',
    cardBackground: '#FFFFFF',
    text: '#2C2C2A',
    textSecondary: '#6B7280',
    textMuted: '#9CA3AF',
    border: '#E5E7EB',
    divider: '#E5E7EB',
    tabBar: 'rgba(241,239,232,0.95)',
    tabBarInactive: '#9CA3AF',
    statusBar: '#0F6E56',
  },

  // Semantic dark mode
  dark: {
    background: '#141412',
    surface: '#1E1E1C',
    cardBackground: '#252523',
    text: '#F0EDE6',
    textSecondary: '#9E9A93',
    textMuted: '#6B6760',
    border: '#2A2A28',
    divider: '#1E1E1C',
    tabBar: 'rgba(20,20,18,0.97)',
    tabBarInactive: '#6B6760',
    statusBar: '#1D9E75',
  },
} as const

export type ColorScheme = 'light' | 'dark'
