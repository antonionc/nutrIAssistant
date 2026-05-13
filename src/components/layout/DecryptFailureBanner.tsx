import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { subscribeDecryptFailures } from '../../services/encryption'
import { recordAuditEvent } from '../../services/auditLog'
import { exportAllUserData } from '../../services/userDataExport'
import { eraseAllUserData } from '../../services/dataErasure'
import { Colors, Spacing, BorderRadius, Typography } from '../../theme'
import { useTheme } from '../../theme/ThemeContext'
import { useTranslation } from '../../i18n'
import { logger } from '../../utils/logger'

/**
 * Mounts at the app root. Surfaces a persistent banner the first time a
 * decrypt() call fails in the current session — typical cause is a master
 * key that was wiped, rotated externally, or a corrupt ciphertext row.
 *
 * The banner is non-dismissible to make sure the user notices: silent data
 * loss is worse than an annoying banner. Two recovery actions are offered:
 *
 *   - "Export now" — attempts an Art. 15 export of whatever is still
 *     readable, so the user can salvage their data before doing anything
 *     destructive.
 *   - "Start fresh" — triggers the Art. 17 erasure flow, then sends the
 *     user back to onboarding.
 *
 * Only the FIRST failure per session writes an audit event — subsequent
 * failures would clutter the log without adding signal.
 */
export function DecryptFailureBanner({ appVersion }: { appVersion: string }) {
  const { colors } = useTheme()
  const tr = useTranslation()
  const [visible, setVisible] = useState(false)
  const auditedRef = useRef(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsubscribe = subscribeDecryptFailures(() => {
      setVisible(true)
      if (!auditedRef.current) {
        auditedRef.current = true
        // Fire-and-forget; the audit log is best-effort.
        recordAuditEvent('decrypt_failure', { firstOfSession: true }).catch(() => {
          /* recordAuditEvent already logs its own errors */
        })
      }
    })
    return unsubscribe
  }, [])

  const handleExport = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const { uri } = await exportAllUserData(appVersion)
      Alert.alert(tr.decryptFailure.exportOkTitle, tr.decryptFailure.exportOkMsg(uri))
    } catch (err) {
      logger.error('[DecryptFailureBanner] export failed', { err })
      Alert.alert(tr.decryptFailure.exportFailTitle, tr.decryptFailure.exportFailMsg)
    } finally {
      setBusy(false)
    }
  }, [appVersion, busy, tr])

  const handleStartFresh = useCallback(() => {
    if (busy) return
    Alert.alert(
      tr.decryptFailure.confirmEraseTitle,
      tr.decryptFailure.confirmEraseMsg,
      [
        { text: tr.app.cancel, style: 'cancel' },
        {
          text: tr.decryptFailure.confirmEraseBtn,
          style: 'destructive',
          onPress: async () => {
            setBusy(true)
            try {
              await eraseAllUserData()
              router.replace('/onboarding')
            } catch (err) {
              logger.error('[DecryptFailureBanner] erase failed', { err })
              Alert.alert(tr.settings.deleteAllErrorTitle, tr.settings.deleteAllErrorMsg)
            } finally {
              setBusy(false)
            }
          },
        },
      ],
    )
  }, [busy, tr])

  if (!visible) return null

  return (
    <View style={[styles.banner, { backgroundColor: `${Colors.errorRed}15`, borderBottomColor: `${Colors.errorRed}40` }]}>
      <Text style={[styles.title, { color: Colors.errorRed }]}>
        {tr.decryptFailure.title}
      </Text>
      <Text style={[styles.body, { color: colors.text }]}>
        {tr.decryptFailure.body}
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity
          onPress={handleExport}
          disabled={busy}
          style={[styles.btn, { backgroundColor: Colors.healthGreen, opacity: busy ? 0.5 : 1 }]}
        >
          <Text style={styles.btnText}>{tr.decryptFailure.exportBtn}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleStartFresh}
          disabled={busy}
          style={[styles.btn, { backgroundColor: Colors.errorRed, opacity: busy ? 0.5 : 1 }]}
        >
          <Text style={styles.btnText}>{tr.decryptFailure.startFreshBtn}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    gap: Spacing.xs,
  },
  title: { ...Typography.heading3, fontSize: 13 },
  body: { ...Typography.caption, fontSize: 12 },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  btn: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.pill },
  btnText: { ...Typography.caption, color: Colors.white, fontSize: 12 },
})
