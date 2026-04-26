import React, { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import {
  CameraView,
  CameraType,
  useCameraPermissions,
} from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useProfiles } from '../src/modules/profiles/ProfilesContext'
import { useInventory } from '../src/modules/inventory/useInventory'
import { getProductByBarcode } from '../src/services/openFoodFacts'
import { computeNutriScore } from '../src/services/nutriscore'
import { checkFamilyCompatibility } from '../src/modules/profiles/allergenEngine'
import { saveScanResult, getScanHistory } from '../src/modules/scanner/scannerDB'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../src/theme'
import { NutriScoreBadge } from '../src/components/charts/NutriScoreBadge'
import { MacroBar } from '../src/components/charts/MacroBar'
import { FamilyCompatibilityRow } from '../src/components/badges/CompatibilityBadge'
import { ScanResult } from '../src/types/scanner'
import { NutritionalInfo } from '../src/types/nutrition'
import { generateId } from '../src/utils/idUtils'

type ScanMode = 'barcode' | 'photo'

export default function ScannerScreen() {
  const insets = useSafeAreaInsets()
  const { profiles } = useProfiles()
  const { addItem } = useInventory()
  const [permission, requestPermission] = useCameraPermissions()
  const [mode, setMode] = useState<ScanMode>('barcode')
  const [scannedResult, setScannedResult] = useState<ScanResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [flashOn, setFlashOn] = useState(false)
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const scannedRef = useRef(false)

  const handleBarcodeScan = useCallback(async ({ data }: { data: string }) => {
    if (scannedRef.current || isLoading) return
    scannedRef.current = true
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setIsLoading(true)

    try {
      const product = await getProductByBarcode(data)
      if (!product) {
        Alert.alert('Producto no encontrado', 'Este código de barras no se encontró en Open Food Facts. Prueba el modo foto para escanear la etiqueta.')
        scannedRef.current = false
        setIsLoading(false)
        return
      }

      const compatibility = checkFamilyCompatibility(
        { ingredients: product.ingredientsText.split(',').map((n) => ({ name: n.trim(), quantity: 1, unit: 'g', isAllergen: false })), allergens: product.allergens },
        profiles
      )

      const nutriscore = product.nutriscore ?? computeNutriScore(product.nutritionalInfo)

      const result: ScanResult = {
        id: generateId('scan'),
        scanType: 'barcode',
        timestamp: new Date().toISOString(),
        barcode: data,
        productName: product.productName,
        brand: product.brand,
        imageUri: product.imageUrl ?? '',
        nutritionalInfo: product.nutritionalInfo,
        nutriscore,
        allergens: product.allergens,
        ingredients: product.ingredientsText.split(',').map((s) => s.trim()).filter(Boolean),
        familyCompatibility: compatibility,
        addedToInventory: false,
        addedToCart: false,
      }

      await saveScanResult(result)
      setScannedResult(result)
    } catch (error) {
      Alert.alert('Error al escanear', error instanceof Error ? error.message : 'Error desconocido')
      scannedRef.current = false
    } finally {
      setIsLoading(false)
    }
  }, [profiles, isLoading])

  const handleAddToInventory = async () => {
    if (!scannedResult?.productName) return
    await addItem({
      name: scannedResult.productName,
      category: 'other',
      quantity: 1,
      unit: 'units',
      nutritionalInfo: scannedResult.nutritionalInfo,
      barcode: scannedResult.barcode,
    })
    Alert.alert('¡Añadido!', `${scannedResult.productName} añadido a tu despensa.`)
  }

  const loadHistory = async () => {
    const history = await getScanHistory(20)
    setScanHistory(history)
    setShowHistory(true)
  }

  if (!permission) return <View style={styles.container} />

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>Acceso a cámara requerido</Text>
          <Text style={styles.permissionText}>NutrIAssistant necesita acceso a la cámara para escanear códigos de barras y etiquetas.</Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Conceder permiso</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>← Atrás</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <View style={styles.container}>
      {/* Camera */}
      <CameraView
        style={styles.camera}
        facing="back"
        enableTorch={flashOn}
        onBarcodeScanned={mode === 'barcode' && !scannedResult ? handleBarcodeScan : undefined}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'qr'] }}
      >
        {/* Floating back button — clears status bar on all iOS devices */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backCircleBtn, { top: insets.top + 12 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backCircleIcon}>‹</Text>
        </TouchableOpacity>

        {/* Overlay */}
        <SafeAreaView style={styles.overlay} edges={['top']}>
          <View style={styles.topBar}>
            <View style={{ width: 44 }} />
            <Text style={styles.scanTitle}>Escáner de alimentos</Text>
            <TouchableOpacity onPress={() => setFlashOn(!flashOn)} style={styles.overlayBtn}>
              <Text style={styles.overlayBtnText}>{flashOn ? '⚡' : '○'}</Text>
            </TouchableOpacity>
          </View>

          {/* Mode Toggle */}
          <View style={styles.modeToggle}>
            {(['barcode', 'photo'] as ScanMode[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
                onPress={() => { setMode(m); setScannedResult(null); scannedRef.current = false }}
              >
                <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextActive]}>
                  {m === 'barcode' ? '▦ Código de barras' : '📷 Foto'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Scanning frame */}
          <View style={styles.frameContainer}>
            <View style={styles.frame}>
              {isLoading && <ActivityIndicator color={Colors.healthGreen} size="large" />}
              {!isLoading && !scannedResult && (
                <Text style={styles.frameHint}>
                  {mode === 'barcode' ? 'Apunta al código de barras' : 'Fotografía el producto'}
                </Text>
              )}
            </View>
          </View>

          {/* Bottom actions */}
          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.historyBtn} onPress={loadHistory}>
              <Text style={styles.historyBtnText}>📋 Historial</Text>
            </TouchableOpacity>
            {mode === 'barcode' && scannedResult && (
              <TouchableOpacity
                style={styles.rescanBtn}
                onPress={() => { setScannedResult(null); scannedRef.current = false }}
              >
                <Text style={styles.rescanBtnText}>↺ Escanear de nuevo</Text>
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      </CameraView>

      {/* Scan Result Sheet */}
      {scannedResult && (
        <View style={styles.resultSheet}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.resultContent}>
            <View style={styles.resultHeader}>
              {scannedResult.imageUri ? (
                <Image source={{ uri: scannedResult.imageUri }} style={styles.productImage} />
              ) : (
                <View style={[styles.productImage, { backgroundColor: Colors.softMint, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 32 }}>🥫</Text>
                </View>
              )}
              <View style={styles.productInfo}>
                <Text style={styles.productName}>{scannedResult.productName}</Text>
                {scannedResult.brand && <Text style={styles.productBrand}>{scannedResult.brand}</Text>}
                {scannedResult.nutriscore && (
                  <NutriScoreBadge score={scannedResult.nutriscore} size="md" />
                )}
              </View>
            </View>

            {scannedResult.nutritionalInfo && (
              <View style={styles.nutritionSection}>
                <Text style={styles.sectionLabel}>Info nutricional (por 100g)</Text>
                <MacroBar nutritionalInfo={scannedResult.nutritionalInfo} height={8} showLabels />
                <View style={styles.nutritionGrid}>
                  <NutritionCell label="Calorías" value={`${scannedResult.nutritionalInfo.calories} kcal`} />
                  <NutritionCell label="Proteínas" value={`${scannedResult.nutritionalInfo.protein}g`} />
                  <NutritionCell label="Carbohid." value={`${scannedResult.nutritionalInfo.carbs}g`} />
                  <NutritionCell label="Grasas" value={`${scannedResult.nutritionalInfo.fat}g`} />
                </View>
              </View>
            )}

            <View style={styles.compatSection}>
              <Text style={styles.sectionLabel}>Compatibilidad familiar</Text>
              <FamilyCompatibilityRow
                compatibility={scannedResult.familyCompatibility}
                members={profiles}
                compact={false}
              />
            </View>

            <View style={styles.resultActions}>
              <TouchableOpacity style={styles.actionBtn} onPress={handleAddToInventory}>
                <Text style={styles.actionBtnText}>+ Añadir a despensa</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSecondary]}>
                <Text style={styles.actionBtnTextSecondary}>+ Añadir a compra</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  )
}

function NutritionCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.nutritionCell}>
      <Text style={styles.nutritionValue}>{value}</Text>
      <Text style={styles.nutritionLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  overlay: { flex: 1 },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  scanTitle: { ...Typography.heading3, color: Colors.white },
  backCircleBtn: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  backCircleIcon: { color: Colors.white, fontSize: 32, lineHeight: 36, marginLeft: -2 },
  overlayBtn: { padding: Spacing.sm, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: BorderRadius.md },
  overlayBtnText: { color: Colors.white, fontSize: 14 },
  modeToggle: {
    flexDirection: 'row', alignSelf: 'center', gap: Spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: BorderRadius.pill, padding: 4,
  },
  modeBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: BorderRadius.pill },
  modeBtnActive: { backgroundColor: Colors.healthGreen },
  modeBtnText: { ...Typography.body, color: 'rgba(255,255,255,0.7)' },
  modeBtnTextActive: { color: Colors.white, fontFamily: Typography.heading3.fontFamily },
  frameContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: 260, height: 160, borderWidth: 2, borderColor: Colors.healthGreen,
    borderRadius: BorderRadius.lg, alignItems: 'center', justifyContent: 'center',
  },
  frameHint: { ...Typography.body, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
  bottomBar: {
    flexDirection: 'row', justifyContent: 'center', gap: Spacing.md,
    paddingBottom: Spacing.xl, paddingHorizontal: Spacing.md,
  },
  historyBtn: { backgroundColor: 'rgba(0,0,0,0.5)', padding: Spacing.sm, borderRadius: BorderRadius.pill },
  historyBtnText: { ...Typography.body, color: Colors.white },
  rescanBtn: { backgroundColor: Colors.healthGreen, padding: Spacing.sm, borderRadius: BorderRadius.pill },
  rescanBtnText: { ...Typography.body, color: Colors.white },
  resultSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.cream, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '60%', ...Shadows.elevated,
  },
  resultContent: { padding: Spacing.md, gap: Spacing.md },
  resultHeader: { flexDirection: 'row', gap: Spacing.md },
  productImage: { width: 80, height: 80, borderRadius: BorderRadius.md, resizeMode: 'contain' },
  productInfo: { flex: 1, gap: Spacing.xs },
  productName: { ...Typography.heading2, color: Colors.warmCharcoal },
  productBrand: { ...Typography.body, color: Colors.light.textSecondary },
  nutritionSection: { gap: Spacing.sm },
  sectionLabel: { ...Typography.heading3, color: Colors.warmCharcoal },
  nutritionGrid: { flexDirection: 'row', gap: Spacing.sm },
  nutritionCell: { flex: 1, backgroundColor: Colors.softMint, borderRadius: BorderRadius.md, padding: Spacing.sm, alignItems: 'center' },
  nutritionValue: { ...Typography.heading3, color: Colors.warmCharcoal },
  nutritionLabel: { ...Typography.caption, color: Colors.light.textSecondary },
  compatSection: { gap: Spacing.sm },
  resultActions: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { flex: 1, backgroundColor: Colors.healthGreen, padding: Spacing.sm, borderRadius: BorderRadius.pill, alignItems: 'center' },
  actionBtnText: { ...Typography.bodyLarge, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
  actionBtnSecondary: { backgroundColor: Colors.softMint },
  actionBtnTextSecondary: { ...Typography.bodyLarge, color: Colors.healthGreen, fontFamily: Typography.heading3.fontFamily },
  permissionContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  permissionTitle: { ...Typography.heading1, color: Colors.warmCharcoal, textAlign: 'center' },
  permissionText: { ...Typography.body, color: Colors.light.textSecondary, textAlign: 'center' },
  permissionBtn: { backgroundColor: Colors.healthGreen, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, borderRadius: BorderRadius.pill },
  permissionBtnText: { ...Typography.bodyLarge, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
  backBtn: { padding: Spacing.sm },
  backBtnText: { ...Typography.body, color: Colors.healthGreen },
})
