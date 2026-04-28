import React, { useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Colors, Typography, Spacing, BorderRadius } from '../../theme'
import { useTheme, ThemeColors } from '../../theme/ThemeContext'

interface EmptyStateProps {
  emoji?: string
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({
  emoji = '📭',
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.title}>{title}</Text>
      {description && <Text style={styles.description}>{description}</Text>}
      {actionLabel && onAction && (
        <TouchableOpacity style={styles.button} onPress={onAction}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Spacing.xxl,
      paddingHorizontal: Spacing.xl,
      gap: Spacing.md,
    },
    emoji: {
      fontSize: 64,
    },
    title: {
      ...Typography.heading2,
      color: colors.text,
      textAlign: 'center',
    },
    description: {
      ...Typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    button: {
      backgroundColor: Colors.healthGreen,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.sm,
      borderRadius: 100,
      marginTop: Spacing.sm,
    },
    buttonText: {
      ...Typography.bodyLarge,
      color: Colors.white,
      fontFamily: Typography.heading3.fontFamily,
    },
  })
}
