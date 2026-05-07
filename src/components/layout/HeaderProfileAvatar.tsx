import React from 'react'
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native'
import { Colors } from '../../theme'
import { useTheme } from '../../theme/ThemeContext'
import { useSelectedProfile } from '../../modules/profiles/SelectedProfileContext'
import { getMemberAvatarSource } from '../../services/avatarService'

interface Props {
  size?: number
}

export function HeaderProfileAvatar({ size = 32 }: Props) {
  const { colors } = useTheme()
  const { selected, openSelector } = useSelectedProfile()

  if (!selected) return null

  return (
    <TouchableOpacity
      onPress={openSelector}
      activeOpacity={0.7}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Cambiar de perfil"
    >
      <View
        style={[
          styles.frame,
          { width: size, height: size, borderRadius: size / 2, borderColor: colors.border },
          selected.isSuperUser && styles.frameAdmin,
        ]}
      >
        <Image
          source={getMemberAvatarSource(selected)}
          style={{ width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 }}
        />
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    overflow: 'hidden',
  },
  frameAdmin: {
    borderColor: Colors.healthGreen,
  },
})
