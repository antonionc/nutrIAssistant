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
  DOCUMENT_CATEGORY_LABEL,
  deleteDocumentFile,
  pickAndCopyDocument,
  summarizeDocument,
} from '../../services/profileDocuments'

let BottomSheet: any = null
let BottomSheetScrollView: any = null
try {
  const bs = require('@gorhom/bottom-sheet')
  BottomSheet = bs.default
  BottomSheetScrollView = bs.BottomSheetScrollView
} catch {
  console.log('[DocumentsSheet] @gorhom/bottom-sheet no disponible')
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
        // Kick off the summary in the background — UI updates via context.
        summarizeDocument(doc)
          .then(async (summary) => {
            await updateDocument(member.id, doc.id, {
              aiSummary: summary,
              aiSummaryStatus: 'ready',
            })
          })
          .catch(async (e) => {
            console.warn('[DocumentsSheet] summarize failed:', e)
            await updateDocument(member.id, doc.id, { aiSummaryStatus: 'failed' })
          })
      } catch (e) {
        setUploading(false)
        const msg = e instanceof Error ? e.message : 'Error desconocido'
        Alert.alert('Error al subir', msg)
      }
    }, [uploading, member.id, addDocument, updateDocument])

    const handleDelete = useCallback(
      (doc: ProfileDocument) => {
        Alert.alert(
          'Eliminar documento',
          `¿Eliminar "${doc.filename}"? El asistente perderá este contexto.`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Eliminar',
              style: 'destructive',
              onPress: async () => {
                await removeDocument(member.id, doc.id)
                await deleteDocumentFile(doc.filePath)
              },
            },
          ]
        )
      },
      [member.id, removeDocument]
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
            <Text style={styles.title}>Informes y documentos</Text>
          </View>

          <BottomSheetScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.hint}>
              Sube PDFs (informes médicos, analíticas, recetas) y el asistente
              local los resumirá para tener más contexto sobre {member.name}. Todo
              se almacena en el dispositivo.
            </Text>

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
                  <Text style={styles.uploadBtnText}>Subir PDF</Text>
                </>
              )}
            </TouchableOpacity>

            {member.documents.length === 0 ? (
              <Text style={styles.empty}>Aún no hay documentos para {member.name}.</Text>
            ) : (
              member.documents.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  onDelete={() => handleDelete(doc)}
                  styles={styles}
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
}: {
  doc: ProfileDocument
  onDelete: () => void
  styles: ReturnType<typeof makeStyles>
}) {
  const date = new Date(doc.uploadedAt).toLocaleDateString('es-ES', {
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
            {DOCUMENT_CATEGORY_LABEL[doc.category]} · {date}
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
            <Text style={styles.docStatusPending}>Resumiendo con IA…</Text>
          </>
        )}
        {doc.aiSummaryStatus === 'ready' && (
          <Text style={styles.docSummary} numberOfLines={4}>
            {doc.aiSummary || 'Sin datos clínicos relevantes.'}
          </Text>
        )}
        {doc.aiSummaryStatus === 'failed' && (
          <Text style={styles.docStatusFailed}>
            No se pudo resumir el documento. Comprueba que el PDF contenga texto.
          </Text>
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
