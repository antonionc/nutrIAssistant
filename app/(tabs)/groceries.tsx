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
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useGroceries } from '../../src/modules/groceries/GroceriesContext'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../src/theme'
import { useTheme, ThemeColors } from '../../src/theme/ThemeContext'
import { useTranslation } from '../../src/i18n'
import { EmptyState } from '../../src/components/layout/EmptyState'
import { GroceryItem } from '../../src/types/groceries'
import { RETAILERS } from '../../src/constants/retailers'
import { HeaderProfileAvatar } from '../../src/components/layout/HeaderProfileAvatar'

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
  const tr = useTranslation()
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
        <View>
          <Text style={styles.title}>{tr.groceries.title}</Text>
          {activeItems.length > 0 && (
            <Text style={styles.count}>{tr.groceries.pendingCount(activeItems.length)}</Text>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.addHeaderBtn} onPress={() => setShowAddModal(true)}>
            <Ionicons name="add" size={22} color={Colors.healthGreen} />
          </TouchableOpacity>
          <HeaderProfileAvatar />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Shopping Groups */}
        {groups.length === 0 && !isLoading ? (
          <EmptyState
            emoji={tr.empty.groceries.emoji}
            title={tr.empty.groceries.title}
            description={tr.empty.groceries.desc}
            actionLabel={tr.empty.groceries.action}
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
                    Alert.alert(tr.groceries.removeItem, tr.groceries.removeConfirm(item.name), [
                      { text: tr.app.cancel, style: 'cancel' },
                      { text: tr.app.delete, style: 'destructive', onPress: () => removeItem(item.id) },
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
                {showPurchased ? '▼' : '▶'} {tr.groceries.purchasedSection(purchasedItems.length)}
              </Text>
              {showPurchased && (
                <TouchableOpacity onPress={clearPurchased}>
                  <Text style={styles.clearText}>{tr.groceries.clearAll}</Text>
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
            <Text style={styles.retailerTitle}>{tr.groceries.shopOnline}</Text>
            <View style={styles.retailerGrid}>
              {RETAILERS.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.retailerCard, !r.active && styles.retailerCardDisabled]}
                  onPress={r.active ? exportToAmazon : () => Alert.alert(tr.app.soon, tr.groceries.comingSoonRetailer(r.name))}
                >
                  <Image
                    source={r.logo}
                    style={styles.retailerLogo}
                    resizeMode="contain"
                  />
                  <Text style={styles.retailerName}>{r.name}</Text>
                  {!r.active && (
                    <View style={styles.comingSoonBadge}>
                      <Text style={styles.comingSoonText}>{tr.app.soon}</Text>
                    </View>
                  )}
                  {r.active && (
                    <Text style={styles.shopBtn}>{tr.groceries.shopNow}</Text>
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
            <Text style={styles.modalTitle}>{tr.groceries.addTitle}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={tr.groceries.itemName}
              placeholderTextColor={colors.textMuted}
              value={newItemName}
              onChangeText={setNewItemName}
              autoFocus
              returnKeyType="next"
            />
            <View style={styles.modalRow}>
              <TextInput
                style={[styles.modalInput, styles.modalInputSmall]}
                placeholder={tr.groceries.qty}
                placeholderTextColor={colors.textMuted}
                value={newItemQty}
                onChangeText={setNewItemQty}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.modalInput, styles.modalInputSmall]}
                placeholder={tr.groceries.unit}
                placeholderTextColor={colors.textMuted}
                value={newItemUnit}
                onChangeText={setNewItemUnit}
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddModal(false)}>
                <Text style={styles.cancelBtnText}>{tr.app.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
                <Text style={styles.addBtnText}>{tr.groceries.addToList}</Text>
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
    <TouchableOpacity style={styles.groceryRow} onPress={onToggle} onLongPress={onDelete} activeOpacity={0.7}>
      {/* Circular checkbox */}
      <View style={[styles.checkbox, item.isPurchased && styles.checkboxChecked]}>
        {item.isPurchased && (
          <Ionicons name="checkmark" size={13} color={Colors.white} />
        )}
      </View>
      {/* Name + quantity */}
      <View style={styles.groceryInfo}>
        <Text style={[styles.groceryName, purchased && styles.groceryNamePurchased]}>
          {item.name}
        </Text>
        {!item.isPurchased && (
          <Text style={styles.groceryQty}>{item.quantity} {item.unit}</Text>
        )}
      </View>
      {item.fromMealPlan && !item.isPurchased && (
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

    // Header
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
      paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    },
    title: { ...Typography.displaySerif, color: colors.text },
    count: { ...Typography.caption, color: colors.textSecondary, marginTop: 2 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4 },
    addHeaderBtn: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: `${Colors.healthGreen}18`,
      alignItems: 'center', justifyContent: 'center',
    },

    // Scroll
    scroll: { paddingTop: Spacing.xs },

    // Groups — clean section dividers
    group: { marginBottom: Spacing.md },
    groupLabel: {
      ...Typography.overline, color: colors.textSecondary,
      paddingHorizontal: Spacing.md, marginBottom: Spacing.xs,
    },

    // Item rows — Mela-style: divider lines, no cards
    groceryRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      paddingVertical: 13, paddingHorizontal: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider,
    },
    checkbox: {
      width: 26, height: 26, borderRadius: 13, borderWidth: 2,
      borderColor: colors.textMuted, backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    checkboxChecked: { backgroundColor: Colors.healthGreen, borderColor: Colors.healthGreen },
    groceryInfo: { flex: 1 },
    groceryName: { ...Typography.bodyLarge, color: colors.text },
    groceryNamePurchased: { textDecorationLine: 'line-through', color: colors.textMuted },
    groceryQty: { ...Typography.caption, color: Colors.healthGreen, marginTop: 1, fontFamily: Typography.body.fontFamily },
    planBadge: {},
    planBadgeText: { fontSize: 14 },

    // Purchased section
    purchasedSection: { marginBottom: Spacing.md },
    purchasedToggle: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    },
    purchasedToggleText: { ...Typography.bodyLarge, color: colors.textSecondary, fontFamily: Typography.heading3.fontFamily },
    clearText: { ...Typography.body, color: Colors.errorRed },

    // Retailer section
    retailerSection: { marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
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

    // FAB (kept for accessibility, but we also added a header + button)
    fab: {
      position: 'absolute', right: Spacing.md, bottom: 90,
      width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.healthGreen,
      alignItems: 'center', justifyContent: 'center', ...Shadows.elevated,
    },
    fabText: { color: Colors.white, fontSize: 28, lineHeight: 30 },

    // Add modal
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
    cancelBtn: { flex: 1, padding: Spacing.sm, borderRadius: BorderRadius.pill, backgroundColor: colors.warmSurface, alignItems: 'center' },
    cancelBtnText: { ...Typography.bodyLarge, color: colors.text },
    addBtn: { flex: 2, padding: Spacing.sm, borderRadius: BorderRadius.pill, backgroundColor: Colors.healthGreen, alignItems: 'center' },
    addBtnText: { ...Typography.bodyLarge, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
  })
}
