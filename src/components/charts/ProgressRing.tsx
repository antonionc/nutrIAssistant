import React, { useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { Colors, Typography } from '../../theme'
import { useTheme, ThemeColors } from '../../theme/ThemeContext'

interface ProgressRingProps {
  value: number
  max: number
  size?: number
  strokeWidth?: number
  color?: string
  trackColor?: string
  label?: string
  sublabel?: string
  showPercent?: boolean
  animate?: boolean
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

export function ProgressRing({
  value,
  max,
  size = 80,
  strokeWidth = 8,
  color = Colors.healthGreen,
  trackColor,
  label,
  sublabel,
  showPercent = false,
  animate = true,
}: ProgressRingProps) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const resolvedTrackColor = trackColor ?? colors.mintSurface

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = Math.min(1, max > 0 ? value / max : 0)

  const animatedValue = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (animate) {
      Animated.timing(animatedValue, {
        toValue: progress,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    } else {
      animatedValue.setValue(progress)
    }
  }, [progress, animate])

  const strokeDashoffset = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  })

  const displayText = showPercent
    ? `${Math.round(progress * 100)}%`
    : label ?? ''

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={resolvedTrackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {(displayText || sublabel) && (
        <View style={[styles.textContainer, { paddingHorizontal: strokeWidth * 1.5 }]}>
          {displayText ? (
            <Text style={[styles.label, { fontSize: size > 80 ? 20 : 12 }]} numberOfLines={1} adjustsFontSizeToFit>{displayText}</Text>
          ) : null}
          {sublabel ? (
            <Text style={styles.sublabel} numberOfLines={2} adjustsFontSizeToFit>{sublabel}</Text>
          ) : null}
        </View>
      )}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { alignItems: 'center', justifyContent: 'center' },
    textContainer: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      fontFamily: Typography.heading2.fontFamily,
      color: colors.text,
      textAlign: 'center',
    },
    sublabel: {
      ...Typography.caption,
      color: colors.text,
      opacity: 0.6,
      textAlign: 'center',
    },
  })
}
