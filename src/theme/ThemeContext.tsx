import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Colors } from './colors'

export type ThemePreference = 'light' | 'dark' | 'auto'

export interface ThemeColors {
  background: string
  surface: string
  cardBackground: string
  warmSurface: string
  text: string
  textSecondary: string
  textMuted: string
  border: string
  divider: string
  tabBar: string
  tabBarInactive: string
  mintSurface: string
  // Brand colors (fixed regardless of theme)
  primary: string
  primaryDark: string
  amber: string
  mint: string
  errorRed: string
  warningOrange: string
  white: string
  black: string
}

interface ThemeContextValue {
  preference: ThemePreference
  isDark: boolean
  colors: ThemeColors
  setPreference: (pref: ThemePreference) => void
}

const KEY_THEME = 'theme_preference'

const ThemeContext = createContext<ThemeContextValue | null>(null)

function buildColors(isDark: boolean): ThemeColors {
  const semantic = isDark ? Colors.dark : Colors.light
  return {
    background: semantic.background,
    surface: semantic.surface,
    cardBackground: semantic.cardBackground,
    warmSurface: semantic.warmSurface,
    text: semantic.text,
    textSecondary: semantic.textSecondary,
    textMuted: semantic.textMuted,
    border: semantic.border,
    divider: semantic.divider,
    tabBar: semantic.tabBar,
    tabBarInactive: semantic.tabBarInactive,
    mintSurface: isDark ? 'rgba(29, 158, 117, 0.15)' : Colors.softMint,
    // Brand (fixed)
    primary: Colors.healthGreen,
    primaryDark: Colors.forestGreen,
    amber: Colors.goldenAmber,
    mint: Colors.softMint,
    errorRed: Colors.errorRed,
    warningOrange: Colors.warningOrange,
    white: Colors.white,
    black: Colors.black,
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme()
  const [preference, setPreferenceState] = useState<ThemePreference>('auto')

  useEffect(() => {
    AsyncStorage.getItem(KEY_THEME).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'auto') {
        setPreferenceState(saved)
      }
    })
  }, [])

  const isDark =
    preference === 'dark' || (preference === 'auto' && systemScheme === 'dark')

  const colors = buildColors(isDark)

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref)
    AsyncStorage.setItem(KEY_THEME, pref)
  }, [])

  return (
    <ThemeContext.Provider value={{ preference, isDark, colors, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
