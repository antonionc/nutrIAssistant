import React from 'react'
import { StyleSheet, Text, View, ViewStyle } from 'react-native'
import { Colors, Typography, Spacing, BorderRadius } from '../../theme'

type Tone = 'allergy' | 'condition'

interface Props {
  label: string
  tone?: Tone
  style?: ViewStyle
}

const TONE_COLORS: Record<Tone, string> = {
  allergy: Colors.errorRed,
  condition: Colors.goldenAmber,
}

export function AllergyPill({ label, tone = 'allergy', style }: Props) {
  const color = TONE_COLORS[tone]
  return (
    <View style={[styles.pill, { backgroundColor: `${color}18` }, style]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.pill,
  },
  text: {
    ...Typography.caption,
    fontFamily: Typography.heading3.fontFamily,
  },
})
