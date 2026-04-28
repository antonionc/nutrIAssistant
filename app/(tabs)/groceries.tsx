import React, { useMemo, useState } from 'react'
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useGroceries } from '../../src/modules/groceries/GroceriesContext'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../src/theme'
import { useTheme, ThemeColors } from '../../src/theme/ThemeContext'
import { EmptyState } from '../../src/components/layout/EmptyState'
import { GroceryItem } from '../../src/types/groceries'
import { RETAILERS } from '../../src/constants/retailers'

export default function GroceriesScreen() {
  const {
    activeItems,
    purchasedItems,
    isLoading,
    addItem,
    togglePurchased,
    removeItem,
    clearPurchased,
    exportToAmazon,
    grouped,
  } = useGroceries()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [showAddModal, setShowAddModal] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [newItemQty, setNewItemQty] = useState('1')
  const [newItemUnit, setNewItemUnit] = useState('units')
  const [showPurchased, setShowPurchased] = useState(false)

  const handleAdd = async () => {
    if (!newItemName.trim()) return
    await addItem(newItemName.trim(), parseFloat(newItemQty) || 1, newItemUnit)
    setNewItemName('')
    setNewItemQty('1')
    setShowAddModal(false)
  }

  const groups = grouped()

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Lista de la Compra</Text>
        <View style={styles.headerActions}>
          <Text style={styles.count}>{activeItems.length} artículo{activeItems.length !== 1 ? 's' : ''}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Shopping Groups */}
        {groups.length === 0 && !isLoading ? (
          <EmptyState
            emoji="🛒"
            title="Lista de compra vacía"
            description="Añade artículos manualmente o genera un plan de comidas para rellenarla."
            actionLabel="+ Añadir artículo"
            onAction={() => setShowAddModal(true)}
          />
        ) : (
          groups.map((group) => (
            <View key={group.category} style={styles.group}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              {group.items.map((item) => (
                <GroceryRow
                  key={item.id}
                  item={item}
                  colors={colors}
                  onToggle={() => togglePurchased(item.id)}
                  onDelete={() => {
                    Alert.alert('Eliminar artículo', `¿Eliminar "${item.name}"?`, [
                      { text: 'Cancelar', style: 'cancel' },
                      { text: 'Eliminar', style: 'destructive', onPress: () => removeItem(item.id) },
                    ])
                  }}
                />
              ))}
            </View>
          ))
        )}

        {/* Purchased Section */}
        {purchasedItems.length > 0 && (
          <View style={styles.purchasedSection}>
            <TouchableOpacity
              style={styles.purchasedToggle}
              onPress={() => setShowPurchased(!showPurchased)}
            >
              <Text style={styles.purchasedToggleText}>
                {showPurchased ? '▼' : '▶'} Comprado ({purchasedItems.length})
              </Text>
              {showPurchased && (
                <TouchableOpacity onPress={clearPurchased}>
                  <Text style={styles.clearText}>Limpiar todo</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
            {showPurchased &&
              purchasedItems.map((item) => (
                <GroceryRow
                  key={item.id}
                  item={item}
                  colors={colors}
                  onToggle={() => togglePurchased(item.id)}
                  onDelete={() => removeItem(item.id)}
                  purchased
                />
              ))}
          </View>
        )}

        {/* Retailer Export */}
        {activeItems.length > 0 && (
          <View style={styles.retailerSection}>
            <Text style={styles.retailerTitle}>Comprar online</Text>
            <View style={styles.retailerGrid}>
              {RETAILERS.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.retailerCard, !r.active && styles.retailerCardDisabled]}
                  onPress={r.active ? exportToAmazon : () => Alert.alert('Próximamente', `La integración con ${r.name} llega pronto.`)}
                >
                  <Image
                    source={r.logo}
                    style={styles.retailerLogo}
                    resizeMode="contain"
                  />
                  <Text style={styles.retailerName}>{r.name}</Text>
                  {!r.active && (
                    <View style={styles.comingSoonBadge}>
                      <Text style={styles.comingSoonText}>Pronto</Text>
                    </View>
                  )}
                  {r.active && (
                    <Text style={styles.shopBtn}>Comprar →</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowAddModal(true)}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Add Item Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowAddModal(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Añadir artículo</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Nombre del artículo (ej. Tomates)"
              placeholderTextColor={colors.textMuted}
              value={newItemName}
              onChangeText={setNewItemName}
              autoFocus
              returnKeyType="next"
            />
            <View style={styles.modalRow}>
              <TextInput
                style={[styles.modalInput, styles.modalInputSmall]}
                placeholder="Cant."
                placeholderTextColor={colors.textMuted}
                value={newItemQty}
                onChangeText={setNewItemQty}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.modalInput, styles.modalInputSmall]}
                placeholder="Unidad"
                placeholderTextColor={colors.textMuted}
                value={newItemUnit}
                onChangeText={setNewItemUnit}
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddModal(false)}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
                <Text style={styles.addBtnText}>Añadir a la lista</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

function GroceryRow({
  item,
  colors,
  onToggle,
  onDelete,
  purchased = false,
}: {
  item: GroceryItem
  colors: ThemeColors
  onToggle: () => void
  onDelete: () => void
  purchased?: boolean
}) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <TouchableOpacity style={styles.groceryRow} onPress={onToggle} onLongPress={onDelete}>
      <View style={[styles.checkbox, item.isPurchased && styles.checkboxChecked]}>
        {item.isPurchased && <Text style={styles.checkmark}>✓</Text>}
      </View>
      <View style={styles.groceryInfo}>
        <Text style={[styles.groceryName, purchased && styles.groceryNamePurchased]}>
          {item.name}
        </Text>
        <Text style={styles.groceryMeta}>{item.quantity} {item.unit}</Text>
      </View>
      {item.fromMealPlan && (
        <View style={styles.planBadge}>
          <Text style={styles.planBadgeText}>📅</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    },
    title: { ...Typography.heading1, color: colors.text },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    count: { ...Typography.body, color: colors.textSecondary },
    scroll: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
    group: { marginBottom: Spacing.md },
    groupLabel: {
      ...Typography.overline, color: colors.textSecondary,
      marginBottom: Spacing.sm, paddingLeft: Spacing.xs,
    },
    groceryRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      backgroundColor: colors.surface, borderRadius: BorderRadius.md,
      padding: Spacing.sm, marginBottom: Spacing.xs, ...Shadows.subtle,
    },
    checkbox: {
      width: 24, height: 24, borderRadius: 12, borderWidth: 2,
      borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    },
    checkboxChecked: { backgroundColor: Colors.healthGreen, borderColor: Colors.healthGreen },
    checkmark: { color: Colors.white, fontSize: 12, fontWeight: 'bold' },
    groceryInfo: { flex: 1 },
    groceryName: { ...Typography.bodyLarge, color: colors.text },
    groceryNamePurchased: { textDecorationLine: 'line-through', color: colors.textMuted },
    groceryMeta: { ...Typography.caption, color: colors.textSecondary },
    planBadge: { padding: Spacing.xs },
    planBadgeText: { fontSize: 14 },
    purchasedSection: { marginBottom: Spacing.md },
    purchasedToggle: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: Spacing.sm,
    },
    purchasedToggleText: { ...Typography.bodyLarge, color: colors.textSecondary, fontFamily: Typography.heading3.fontFamily },
    clearText: { ...Typography.body, color: Colors.errorRed },
    retailerSection: { marginBottom: Spacing.lg },
    retailerTitle: { ...Typography.heading2, color: colors.text, marginBottom: Spacing.sm },
    retailerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    retailerCard: {
      width: '30%', backgroundColor: colors.surface, borderRadius: BorderRadius.md,
      padding: Spacing.md, alignItems: 'center', gap: Spacing.sm, ...Shadows.subtle,
      borderWidth: 1, borderColor: colors.border,
    },
    retailerCardDisabled: { opacity: 0.65 },
    retailerLogo: { width: 48, height: 48, borderRadius: BorderRadius.sm },
    retailerName: { ...Typography.caption, color: colors.text, textAlign: 'center' },
    comingSoonBadge: { backgroundColor: Colors.goldenAmber, paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.pill },
    comingSoonText: { ...Typography.overline, color: Colors.white, fontSize: 8 },
    shopBtn: { ...Typography.caption, color: Colors.healthGreen, fontFamily: Typography.body.fontFamily },
    fab: {
      position: 'absolute', right: Spacing.md, bottom: 90,
      width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.healthGreen,
      alignItems: 'center', justifyContent: 'center', ...Shadows.elevated,
    },
    fabText: { color: Colors.white, fontSize: 28, lineHeight: 30 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: Spacing.xl, gap: Spacing.md,
    },
    modalTitle: { ...Typography.heading2, color: colors.text },
    modalInput: {
      backgroundColor: colors.surface, borderRadius: BorderRadius.md,
      padding: Spacing.sm, ...Typography.bodyLarge, color: colors.text,
      borderWidth: 1, borderColor: colors.border,
    },
    modalInputSmall: { flex: 1 },
    modalRow: { flexDirection: 'row', gap: Spacing.sm },
    modalActions: { flexDirection: 'row', gap: Spacing.sm },
    cancelBtn: { flex: 1, padding: Spacing.sm, borderRadius: BorderRadius.pill, backgroundColor: colors.mintSurface, alignItems: 'center' },
    cancelBtnText: { ...Typography.bodyLarge, color: colors.text },
    addBtn: { flex: 2, padding: Spacing.sm, borderRadius: BorderRadius.pill, backgroundColor: Colors.healthGreen, alignItems: 'center' },
    addBtnText: { ...Typography.bodyLarge, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
  })
}
