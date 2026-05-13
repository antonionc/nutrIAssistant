import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../theme'
import { useTheme, ThemeColors } from '../../theme/ThemeContext'
import { FamilyMember, ProfileDocument } from '../../types/profiles'
import { useProfiles } from '../../modules/profiles/ProfilesContext'
import {
  deleteDocumentFile,
  indexDocumentForRetrieval,
  pickAndCopyDocument,
  summarizeDocument,
} from '../../services/profileDocuments'
import { deleteDocChunksForDoc } from '../../services/memoryStore'
import { useTranslation, type Translations } from '../../i18n'
import { logger } from '../../utils/logger'

let BottomSheet: any = null
let BottomSheetScrollView: any = null
try {
  const bs = require('@gorhom/bottom-sheet')
  BottomSheet = bs.default
  BottomSheetScrollView = bs.BottomSheetScrollView
} catch {
  logger.info('[DocumentsSheet] @gorhom/bottom-sheet no disponible')
}

export interface DocumentsSheetRef {
  present: () => void
  dismiss: () => void
}

interface Props {
  member: FamilyMember
  onAfterClose?: () => void
}

export const DocumentsSheet = forwardRef<DocumentsSheetRef, Props>(
  function DocumentsSheet({ member, onAfterClose }, ref) {
    const { colors } = useTheme()
    const { addDocument, updateDocument, removeDocument } = useProfiles()
    const tr = useTranslation()
    const styles = useMemo(() => makeStyles(colors), [colors])
    const sheetRef = useRef<any>(null)
    const [uploading, setUploading] = useState(false)

    useImperativeHandle(ref, () => ({
      present: () => sheetRef.current?.expand(),
      dismiss: () => sheetRef.current?.close(),
    }))

    const handleUpload = useCallback(async () => {
      if (uploading) return
      setUploading(true)
      try {
        const doc = await pickAndCopyDocument(member.id)
        if (!doc) {
          setUploading(false)
          return
        }
        await addDocument(member.id, doc)
        setUploading(false)
        // Kick off the summary AND semantic indexing in the background. They
        // both read the same PDF text but the LLM summary call can be slow,
        // so they run in parallel — UI updates incrementally via context.
        summarizeDocument(doc)
          .then(async (summary) => {
            await updateDocument(member.id, doc.id, {
              aiSummary: summary,
              aiSummaryStatus: 'ready',
            })
          })
          .catch(async (e) => {
            logger.warn('[DocumentsSheet] summarize failed:', e)
            await updateDocument(member.id, doc.id, { aiSummaryStatus: 'failed' })
          })
        indexDocumentForRetrieval(member.id, doc).catch((e) =>
          logger.warn('[DocumentsSheet] indexing failed:', e)
        )
      } catch (e) {
        setUploading(false)
        const msg = e instanceof Error ? e.message : tr.app.error
        Alert.alert(tr.documents.uploadError, msg)
      }
    }, [uploading, member.id, addDocument, updateDocument, tr])

    const handleDelete = useCallback(
      (doc: ProfileDocument) => {
        Alert.alert(
          tr.documents.deleteTitle,
          tr.documents.deleteMsg(doc.filename),
          [
            { text: tr.app.cancel, style: 'cancel' },
            {
              text: tr.app.delete,
              style: 'destructive',
              onPress: async () => {
                await removeDocument(member.id, doc.id)
                await deleteDocumentFile(doc.filePath)
                await deleteDocChunksForDoc(doc.id)
              },
            },
          ]
        )
      },
      [member.id, removeDocument, tr]
    )

    if (!BottomSheet) return null

    return (
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={['75%']}
        enablePanDownToClose
        onClose={onAfterClose}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handle}
        enableDynamicSizing={false}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Ionicons name="document-text-outline" size={20} color={colors.text} />
            <Text style={styles.title}>{tr.documents.sheetTitle}</Text>
          </View>

          <BottomSheetScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.hint}>{tr.documents.uploadHint(member.name)}</Text>

            <TouchableOpacity
              style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]}
              onPress={handleUpload}
              disabled={uploading}
              activeOpacity={0.85}
            >
              {uploading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={18} color={Colors.white} />
                  <Text style={styles.uploadBtnText}>{tr.documents.uploadBtn}</Text>
                </>
              )}
            </TouchableOpacity>

            {member.documents.length === 0 ? (
              <Text style={styles.empty}>{tr.documents.empty(member.name)}</Text>
            ) : (
              member.documents.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  onDelete={() => handleDelete(doc)}
                  styles={styles}
                  tr={tr}
                />
              ))
            )}

            <View style={{ height: Spacing.xl }} />
          </BottomSheetScrollView>
        </View>
      </BottomSheet>
    )
  }
)

function DocumentRow({
  doc,
  onDelete,
  styles,
  tr,
}: {
  doc: ProfileDocument
  onDelete: () => void
  styles: ReturnType<typeof makeStyles>
  tr: Translations
}) {
  // Date format follows the device locale (Intl), so EN devices see
  // "Mar 4, 2026" and ES devices see "4 mar 2026" without us hardcoding.
  const date = new Date(doc.uploadedAt).toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
  })

  return (
    <View style={styles.docRow}>
      <View style={styles.docHeader}>
        <View style={styles.docIcon}>
          <Ionicons name="document-text" size={18} color={Colors.forestGreen} />
        </View>
        <View style={styles.docHeaderText}>
          <Text style={styles.docFilename} numberOfLines={1}>{doc.filename}</Text>
          <Text style={styles.docMeta}>
            {tr.documents.categories[doc.category]} · {date}
          </Text>
        </View>
        <TouchableOpacity onPress={onDelete} hitSlop={8} style={styles.docDelete}>
          <Ionicons name="trash-outline" size={18} color={Colors.errorRed} />
        </TouchableOpacity>
      </View>

      <View style={styles.docStatusRow}>
        {doc.aiSummaryStatus === 'pending' && (
          <>
            <ActivityIndicator size="small" color={Colors.forestGreen} />
            <Text style={styles.docStatusPending}>{tr.documents.summarizing}</Text>
          </>
        )}
        {doc.aiSummaryStatus === 'ready' && (
          <Text style={styles.docSummary} numberOfLines={4}>
            {doc.aiSummary || tr.documents.summaryFallback}
          </Text>
        )}
        {doc.aiSummaryStatus === 'failed' && (
          <Text style={styles.docStatusFailed}>{tr.documents.summaryFailed}</Text>
        )}
      </View>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.background,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
    },
    handle: { backgroundColor: colors.border, width: 40 },
    container: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { ...Typography.heading2, color: colors.text },
    scrollContent: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
    hint: { ...Typography.body, color: colors.textSecondary, marginBottom: Spacing.md },
    uploadBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      backgroundColor: Colors.healthGreen,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      marginBottom: Spacing.md,
    },
    uploadBtnDisabled: { opacity: 0.6 },
    uploadBtnText: {
      ...Typography.body,
      color: Colors.white,
      fontFamily: Typography.heading3.fontFamily,
    },
    empty: { ...Typography.body, color: colors.textMuted, paddingVertical: Spacing.sm },

    docRow: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
      ...Shadows.subtle,
    },
    docHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    docIcon: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: `${Colors.forestGreen}15`,
      alignItems: 'center', justifyContent: 'center',
    },
    docHeaderText: { flex: 1 },
    docFilename: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    docMeta: { ...Typography.caption, color: colors.textSecondary, marginTop: 2 },
    docDelete: { padding: Spacing.xs },
    docStatusRow: {
      marginTop: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.xs,
    },
    docStatusPending: { ...Typography.caption, color: colors.textSecondary },
    docSummary: { ...Typography.caption, color: colors.text, lineHeight: 18 },
    docStatusFailed: { ...Typography.caption, color: Colors.errorRed },
  })
}
