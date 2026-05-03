import React from 'react'
import { Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { Colors, Typography } from '../../theme'
import { useTheme } from '../../theme/ThemeContext'
import { NutritionalInfo } from '../../types/nutrition'

const PROTEIN_COLOR = Colors.healthGreen
const CARBS_COLOR = Colors.goldenAmber
const FAT_COLOR = Colors.warningOrange

interface MacroDonutProps {
  nutritionalInfo: NutritionalInfo
  size?: number
  strokeWidth?: number
  /** 'horizontal' = ring left, labels right (default)
   *  'vertical'   = ring top, labels below (use when placed at card edge) */
  layout?: 'horizontal' | 'vertical'
}

export function MacroDonut({
  nutritionalInfo,
  size = 52,
  strokeWidth = 6,
  layout = 'horizontal',
}: MacroDonutProps) {
  const { colors } = useTheme()
  const { protein, carbs, fat } = nutritionalInfo
  const total = protein + carbs + fat
  if (total === 0) return null

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const cx = size / 2
  const cy = size / 2

  const proteinPct = protein / total
  const carbsPct = carbs / total
  const fatPct = fat / total

  const proteinLen = circumference * proteinPct
  const carbsLen = circumference * carbsPct
  const fatLen = circumference * fatPct

  const baseRotation = -90
  const proteinRotation = baseRotation
  const carbsRotation = baseRotation + proteinPct * 360
  const fatRotation = carbsRotation + carbsPct * 360

  const sharedProps = {
    cx,
    cy,
    r: radius,
    fill: 'none',
    strokeWidth,
    strokeLinecap: 'butt' as const,
  }

  const ring = (
    <Svg width={size} height={size}>
      <Circle {...sharedProps} stroke={colors.border} />
      <Circle
        {...sharedProps}
        stroke={PROTEIN_COLOR}
        strokeDasharray={[proteinLen - 1, circumference - proteinLen + 1]}
        rotation={proteinRotation}
        originX={cx}
        originY={cy}
      />
      <Circle
        {...sharedProps}
        stroke={CARBS_COLOR}
        strokeDasharray={[carbsLen - 1, circumference - carbsLen + 1]}
        rotation={carbsRotation}
        originX={cx}
        originY={cy}
      />
      <Circle
        {...sharedProps}
        stroke={FAT_COLOR}
        strokeDasharray={[fatLen - 1, circumference - fatLen + 1]}
        rotation={fatRotation}
        originX={cx}
        originY={cy}
      />
    </Svg>
  )

  const labels = (
    <View style={{ gap: layout === 'vertical' ? 1 : 3 }}>
      <MacroLabel color={PROTEIN_COLOR} label="P" value={protein} textColor={colors.textSecondary} valueColor={colors.text} small={layout === 'vertical'} />
      <MacroLabel color={CARBS_COLOR} label="C" value={carbs} textColor={colors.textSecondary} valueColor={colors.text} small={layout === 'vertical'} />
      <MacroLabel color={FAT_COLOR} label="G" value={fat} textColor={colors.textSecondary} valueColor={colors.text} small={layout === 'vertical'} />
    </View>
  )

  if (layout === 'vertical') {
    return (
      <View style={{ alignItems: 'center', gap: 4 }}>
        {ring}
        {labels}
      </View>
    )
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {ring}
      {labels}
    </View>
  )
}

function MacroLabel({
  color,
  label,
  value,
  textColor,
  valueColor,
  small = false,
}: {
  color: string
  label: string
  value: number
  textColor: string
  valueColor: string
  small?: boolean
}) {
  const fontSize = small ? 10 : 11
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ ...Typography.caption, fontSize, color: textColor }}>
        {label} <Text style={{ color: valueColor }}>{Math.round(value)}g</Text>
      </Text>
    </View>
  )
}
