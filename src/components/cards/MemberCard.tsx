import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { FamilyMember } from '../../types/profiles'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../theme'
import { ProgressRing } from '../charts/ProgressRing'

interface MemberCardProps {
  member: FamilyMember
  caloriesConsumed?: number
  isActive?: boolean
  onPress?: () => void
  compact?: boolean
}

export function MemberCard({
  member,
  caloriesConsumed = 0,
  isActive = false,
  onPress,
  compact = false,
}: MemberCardProps) {
  const target = member.dailyCalorieTarget ?? 2000
  const progress = Math.min(1, caloriesConsumed / target)

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isActive && styles.cardActive,
        compact && styles.cardCompact,
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.avatarContainer}>
        <ProgressRing
          value={caloriesConsumed}
          max={target}
          size={compact ? 56 : 72}
          strokeWidth={4}
          color={Colors.goldenAmber}
          trackColor={Colors.softMint}
          animate
        />
        <View style={styles.avatarOverlay}>
          {member.avatarUrl ? (
            <Image
              source={{ uri: member.avatarUrl }}
              style={[styles.avatarImage, compact && styles.avatarImageCompact]}
            />
          ) : (
            <Text style={[styles.avatarEmoji, compact && styles.avatarEmojiCompact]}>
              {member.avatarEmoji ?? '👤'}
            </Text>
          )}
        </View>
      </View>
      <Text style={styles.name} numberOfLines={1}>{member.name}</Text>
      {!compact && (
        <>
          <Text style={styles.calories}>
            {caloriesConsumed} / {target} kcal
          </Text>
          {member.allergies.length > 0 && (
            <View style={styles.badges}>
              {member.allergies.slice(0, 2).map((a) => (
                <View key={a} style={styles.allergenBadge}>
                  <Text style={styles.allergenText}>{a.slice(0, 4)}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.cardBackground,
    borderRadius: BorderRadius.lg,
    padding: Spacing.sm,
    alignItems: 'center',
    gap: Spacing.xs,
    ...Shadows.subtle,
    minWidth: 90,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardActive: {
    borderColor: Colors.healthGreen,
  },
  cardCompact: {
    padding: Spacing.xs,
    minWidth: 64,
  },
  avatarContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  avatarImageCompact: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarEmoji: {
    fontSize: 28,
  },
  avatarEmojiCompact: {
    fontSize: 20,
  },
  name: {
    ...Typography.caption,
    color: Colors.warmCharcoal,
    fontFamily: Typography.body.fontFamily,
    textAlign: 'center',
  },
  calories: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    textAlign: 'center',
  },
  badges: {
    flexDirection: 'row',
    gap: 2,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  allergenBadge: {
    backgroundColor: `${Colors.errorRed}20`,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  allergenText: {
    ...Typography.overline,
    color: Colors.errorRed,
    fontSize: 8,
  },
})
