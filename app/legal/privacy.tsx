import React, { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import { useTranslation } from '../../src/i18n'
import { currentLang } from '../../src/utils/locale'
import { Colors, Typography, Spacing } from '../../src/theme'
import { useTheme, ThemeColors } from '../../src/theme/ThemeContext'
import { MarkdownText } from '../../src/components/layout/MarkdownText'
import { logger } from '../../src/utils/logger'

// Renders the static privacy policy markdown shipped under
// `assets/legal/privacy-policy-v1.<lang>.md`. The markdown lives in
// assets so the legal team can edit it without touching code, and so
// the same source can be served from the future website.
//
// The on-disk asset is read at runtime through `expo-asset` because
// the bundler treats the .md as a static asset, not as a module.
export default function PrivacyPolicyScreen() {
  const tr = useTranslation()
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const [markdown, setMarkdown] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const lang = currentLang()
        const assetModule = lang === 'en'
          ? require('../../assets/legal/privacy-policy-v1.en.md')
          : require('../../assets/legal/privacy-policy-v1.es.md')
        const asset = Asset.fromModule(assetModule)
        await asset.downloadAsync()
        if (!asset.localUri) throw new Error('Asset has no local URI')
        const text = await FileSystem.readAsStringAsync(asset.localUri, {
          encoding: FileSystem.EncodingType.UTF8,
        })
        if (!cancelled) setMarkdown(text)
      } catch (err) {
        logger.error('[privacy] failed to load policy asset', { err })
        if (!cancelled) setMarkdown(tr.privacyPolicy.headerTitle)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [tr])

  if (markdown === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.healthGreen} />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator
    >
      <MarkdownText content={markdown} isUser={false} />
    </ScrollView>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: Spacing.lg, gap: Spacing.sm },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    title: { ...Typography.heading2, color: colors.text, marginBottom: Spacing.sm },
  })
}
