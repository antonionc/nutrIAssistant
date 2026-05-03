import React, { useMemo } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { CompatibilityResult } from '../../types/recipes'
import { FamilyMember } from '../../types/profiles'
import { Colors, Typography, Spacing } from '../../theme'
import { useTheme, ThemeColors } from '../../theme/ThemeContext'
import { getMemberAvatarSource } from '../../services/avatarService'

interface CompatibilityBadgeProps {
  result: CompatibilityResult
  member?: FamilyMember
  showName?: boolean
}

export function CompatibilityBadge({ result, member, showName = true }: CompatibilityBadgeProps) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const icon = result.riskLevel === 'danger'
    ? '✗'
    : result.riskLevel === 'warning'
    ? '⚠'
    : '✓'

  const iconColor =
    result.riskLevel === 'danger'
      ? Colors.errorRed
      : result.riskLevel === 'warning'
      ? Colors.warningOrange
      : Colors.healthGreen

  const avatarSource = member ? getMemberAvatarSource(member) : null

  return (
    <View style={styles.container}>
      <View style={[styles.iconCircle, { backgroundColor: `${iconColor}20` }]}>
        {avatarSource ? (
          <Image source={avatarSource} style={styles.avatarImage} />
        ) : (
          <Text style={[styles.icon, { color: iconColor }]}>{icon}</Text>
        )}
      </View>
      {showName && (
        <View>
          <Text style={styles.name}>{result.memberName}</Text>
          {result.reason && result.riskLevel !== 'safe' ? (
            <Text style={[styles.reason, { color: iconColor }]} numberOfLines={1}>
              {result.reason}
            </Text>
          ) : null}
        </View>
      )}
      {avatarSource && (
        <Text style={[styles.statusIcon, { color: iconColor }]}>{icon}</Text>
      )}
    </View>
  )
}

export function FamilyCompatibilityRow({
  compatibility,
  members,
  compact = false,
}: {
  compatibility: Record<string, CompatibilityResult>
  members: FamilyMember[]
  compact?: boolean
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {members.map((member) => {
        const result = compatibility[member.id]
        if (!result) return null
        return compact ? (
          <CompactCompatibilityDot key={member.id} result={result} member={member} />
        ) : (
          <CompatibilityBadge key={member.id} result={result} member={member} showName />
        )
      })}
    </View>
  )
}

function CompactCompatibilityDot({
  result,
  member,
}: {
  result: CompatibilityResult
  member: FamilyMember
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const borderColor =
    result.riskLevel === 'danger'
      ? Colors.errorRed
      : result.riskLevel === 'warning'
      ? Colors.warningOrange
      : Colors.healthGreen

  return (
    <View style={[styles.dot, { borderColor }]}>
      <Image source={getMemberAvatarSource(member)} style={styles.dotImage} />
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    iconCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarImage: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    icon: {
      fontSize: 14,
      fontWeight: 'bold',
    },
    statusIcon: {
      fontSize: 12,
      fontWeight: 'bold',
    },
    name: {
      ...Typography.caption,
      color: colors.text,
      fontFamily: Typography.body.fontFamily,
    },
    reason: {
      ...Typography.caption,
      maxWidth: 140,
    },
    row: {
      flexDirection: 'row',
      gap: Spacing.sm,
      flexWrap: 'wrap',
    },
    rowCompact: {
      gap: Spacing.xs,
    },
    dot: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.mintSurface,
    },
    dotImage: {
      width: 28,
      height: 28,
      borderRadius: 14,
    },
  })
}
