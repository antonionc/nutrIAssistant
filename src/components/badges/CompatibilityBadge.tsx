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
  isActive?: boolean
}

export function CompatibilityBadge({ result, member, showName = true, isActive = false }: CompatibilityBadgeProps) {
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
    <View style={[styles.container, isActive && styles.containerActive]}>
      <View style={[styles.iconCircle, { backgroundColor: `${iconColor}20` }]}>
        {avatarSource ? (
          <Image source={avatarSource} style={styles.avatarImage} />
        ) : (
          <Text style={[styles.icon, { color: iconColor }]}>{icon}</Text>
        )}
      </View>
      {showName && (
        <View>
          <Text style={[styles.name, isActive && styles.nameActive]}>{result.memberName}</Text>
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
  activeMemberId,
  compact = false,
}: {
  compatibility: Record<string, CompatibilityResult>
  members: FamilyMember[]
  activeMemberId?: string
  compact?: boolean
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {members.map((member) => {
        const result = compatibility[member.id]
        if (!result) return null
        const isActive = member.id === activeMemberId
        return compact ? (
          <CompactCompatibilityDot
            key={member.id}
            result={result}
            member={member}
            isActive={isActive}
          />
        ) : (
          <CompatibilityBadge
            key={member.id}
            result={result}
            member={member}
            showName
            isActive={isActive}
          />
        )
      })}
    </View>
  )
}

function CompactCompatibilityDot({
  result,
  member,
  isActive = false,
}: {
  result: CompatibilityResult
  member: FamilyMember
  isActive?: boolean
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
    <View
      style={[
        styles.dot,
        { borderColor },
        isActive && { borderWidth: 3, transform: [{ scale: 1.1 }] },
      ]}
    >
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
    containerActive: {
      borderLeftWidth: 3,
      borderLeftColor: Colors.healthGreen,
      paddingLeft: Spacing.xs,
    },
    nameActive: {
      fontFamily: Typography.heading3.fontFamily,
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
