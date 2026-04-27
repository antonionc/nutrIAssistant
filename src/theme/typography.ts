import { TextStyle } from 'react-native'

const FontFamily = {
  regular: 'Poppins_400Regular',
  light: 'Poppins_300Light',
  medium: 'Poppins_500Medium',
  semiBold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const

export interface TypographyScale {
  display: TextStyle
  heading1: TextStyle
  heading2: TextStyle
  heading3: TextStyle
  bodyLarge: TextStyle
  body: TextStyle
  caption: TextStyle
  overline: TextStyle
}

export const Typography: TypographyScale = {
  display: {
    fontFamily: FontFamily.bold,
    fontSize: 28,
    lineHeight: 36,
  },
  heading1: {
    fontFamily: FontFamily.bold,
    fontSize: 24,
    lineHeight: 32,
  },
  heading2: {
    fontFamily: FontFamily.semiBold,
    fontSize: 20,
    lineHeight: 28,
  },
  heading3: {
    fontFamily: FontFamily.semiBold,
    fontSize: 17,
    lineHeight: 24,
  },
  bodyLarge: {
    fontFamily: FontFamily.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  body: {
    fontFamily: FontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  caption: {
    fontFamily: FontFamily.light,
    fontSize: 12,
    lineHeight: 16,
  },
  overline: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
}
