import React, { useRef, useEffect, useState } from 'react'
import { View, TextInput, Text, StyleSheet } from 'react-native'
import { Colors, Typography, Spacing, BorderRadius } from '../../theme'

interface Props {
  value: string            // 'YYYY-MM-DD' or ''
  onChange: (isoDate: string) => void
}

export function DateOfBirthInput({ value, onChange }: Props) {
  const [day,   setDay]   = useState(value.length >= 10 ? value.slice(8, 10) : '')
  const [month, setMonth] = useState(value.length >= 10 ? value.slice(5, 7)  : '')
  const [year,  setYear]  = useState(value.length >= 10 ? value.slice(0, 4)  : '')

  const monthRef = useRef<TextInput>(null)
  const yearRef  = useRef<TextInput>(null)

  // Sync when parent resets the value (e.g. blank draft)
  useEffect(() => {
    if (value.length >= 10) {
      setDay(value.slice(8, 10))
      setMonth(value.slice(5, 7))
      setYear(value.slice(0, 4))
    } else if (value === '') {
      setDay(''); setMonth(''); setYear('')
    }
  }, [value])

  function emit(d: string, m: string, y: string) {
    if (d.length === 2 && m.length === 2 && y.length === 4) {
      onChange(`${y}-${m}-${d}`)
    } else {
      onChange('')
    }
  }

  return (
    <View style={styles.row}>
      <TextInput
        style={styles.input}
        value={day}
        onChangeText={(v) => {
          const clean = v.replace(/\D/g, '').slice(0, 2)
          setDay(clean)
          emit(clean, month, year)
          if (clean.length === 2) monthRef.current?.focus()
        }}
        placeholder="DD"
        placeholderTextColor={Colors.light.textMuted}
        keyboardType="numeric"
        maxLength={2}
        textAlign="center"
        returnKeyType="next"
        onSubmitEditing={() => monthRef.current?.focus()}
      />
      <Text style={styles.sep}>/</Text>
      <TextInput
        ref={monthRef}
        style={styles.input}
        value={month}
        onChangeText={(v) => {
          const clean = v.replace(/\D/g, '').slice(0, 2)
          setMonth(clean)
          emit(day, clean, year)
          if (clean.length === 2) yearRef.current?.focus()
        }}
        placeholder="MM"
        placeholderTextColor={Colors.light.textMuted}
        keyboardType="numeric"
        maxLength={2}
        textAlign="center"
        returnKeyType="next"
        onSubmitEditing={() => yearRef.current?.focus()}
      />
      <Text style={styles.sep}>/</Text>
      <TextInput
        ref={yearRef}
        style={[styles.input, styles.yearInput]}
        value={year}
        onChangeText={(v) => {
          const clean = v.replace(/\D/g, '').slice(0, 4)
          setYear(clean)
          emit(day, month, clean)
        }}
        placeholder="AAAA"
        placeholderTextColor={Colors.light.textMuted}
        keyboardType="numeric"
        maxLength={4}
        textAlign="center"
        returnKeyType="done"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    fontSize: 14,
    color: Colors.warmCharcoal,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 4,
    paddingVertical: 6,
    width: 36,
  },
  yearInput: { width: 50 },
  sep: { fontSize: 14, color: Colors.light.textSecondary },
})
