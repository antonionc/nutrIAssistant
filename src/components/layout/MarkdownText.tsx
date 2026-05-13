import React, { useMemo } from 'react'
import { Platform, StyleSheet, Text, TextStyle, View } from 'react-native'
import { Colors, Spacing, Typography } from '../../theme'
import { useTheme } from '../../theme/ThemeContext'

interface Props {
  content: string
  isUser: boolean
}

type InlineRun =
  | { type: 'plain'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }

type Block =
  | { type: 'paragraph'; runs: InlineRun[] }
  | { type: 'bullet'; items: InlineRun[][] }
  | { type: 'ordered'; items: InlineRun[][] }
  | { type: 'heading'; level: 1 | 2 | 3; runs: InlineRun[] }
  | { type: 'divider' }

// Inline tokens — bold first so **x** wins over *x*. Disallow newlines inside
// emphasis to keep formatting line-bounded (matches typical LLM output).
const INLINE_RE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g

function parseInline(text: string): InlineRun[] {
  if (!text) return []
  const runs: InlineRun[] = []
  let lastIndex = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0
    if (start > lastIndex) {
      runs.push({ type: 'plain', text: text.slice(lastIndex, start) })
    }
    const tok = m[0]
    if (tok.startsWith('**') || tok.startsWith('__')) {
      runs.push({ type: 'bold', text: tok.slice(2, -2) })
    } else if (tok.startsWith('`')) {
      runs.push({ type: 'code', text: tok.slice(1, -1) })
    } else {
      runs.push({ type: 'italic', text: tok.slice(1, -1) })
    }
    lastIndex = start + tok.length
  }
  if (lastIndex < text.length) {
    runs.push({ type: 'plain', text: text.slice(lastIndex) })
  }
  return runs.length > 0 ? runs : [{ type: 'plain', text }]
}

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraphLines: string[] = []
  let bulletItems: string[] | null = null
  let orderedItems: string[] | null = null

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', runs: parseInline(paragraphLines.join('\n')) })
      paragraphLines = []
    }
  }
  const flushBullets = () => {
    if (bulletItems && bulletItems.length > 0) {
      blocks.push({ type: 'bullet', items: bulletItems.map(parseInline) })
    }
    bulletItems = null
  }
  const flushOrdered = () => {
    if (orderedItems && orderedItems.length > 0) {
      blocks.push({ type: 'ordered', items: orderedItems.map(parseInline) })
    }
    orderedItems = null
  }
  const flushAll = () => {
    flushParagraph()
    flushBullets()
    flushOrdered()
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      flushAll()
      continue
    }

    if (/^-{3,}$/.test(line)) {
      flushAll()
      blocks.push({ type: 'divider' })
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/)
    if (headingMatch) {
      flushAll()
      const level = headingMatch[1].length as 1 | 2 | 3
      blocks.push({ type: 'heading', level, runs: parseInline(headingMatch[2]) })
      continue
    }

    const bulletMatch = line.match(/^[-*•]\s+(.*)$/)
    if (bulletMatch) {
      flushParagraph()
      flushOrdered()
      if (!bulletItems) bulletItems = []
      bulletItems.push(bulletMatch[1])
      continue
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/)
    if (orderedMatch) {
      flushParagraph()
      flushBullets()
      if (!orderedItems) orderedItems = []
      orderedItems.push(orderedMatch[1])
      continue
    }

    flushBullets()
    flushOrdered()
    paragraphLines.push(line)
  }

  flushAll()
  return blocks
}

const MONO_FAMILY = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })
const BOLD_FAMILY = 'Poppins_600SemiBold'

export function MarkdownText({ content, isUser }: Props) {
  const { colors } = useTheme()
  const blocks = useMemo(() => parseBlocks(content), [content])

  const baseColor = isUser ? Colors.white : colors.text
  const accentColor = isUser ? Colors.white : Colors.forestGreen
  const codeBg = isUser ? 'rgba(255,255,255,0.18)' : 'rgba(15,110,86,0.08)'
  const dividerColor = isUser ? 'rgba(255,255,255,0.4)' : colors.border

  const renderRuns = (runs: InlineRun[]): React.ReactNode =>
    runs.map((run, i) => {
      switch (run.type) {
        case 'bold':
          return (
            <Text key={i} style={{ fontFamily: BOLD_FAMILY }}>
              {run.text}
            </Text>
          )
        case 'italic':
          return (
            <Text key={i} style={{ fontStyle: 'italic' }}>
              {run.text}
            </Text>
          )
        case 'code':
          return (
            <Text
              key={i}
              style={{
                fontFamily: MONO_FAMILY,
                fontSize: 13,
                backgroundColor: codeBg,
              }}
            >
              {' '}
              {run.text}
              {' '}
            </Text>
          )
        default:
          return <Text key={i}>{run.text}</Text>
      }
    })

  return (
    <View>
      {blocks.map((block, i) => {
        const isLast = i === blocks.length - 1
        const blockMargin = isLast ? 0 : Spacing.sm

        if (block.type === 'divider') {
          return (
            <View
              key={i}
              style={{
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: dividerColor,
                marginVertical: Spacing.sm,
              }}
            />
          )
        }

        if (block.type === 'heading') {
          let headingStyle: TextStyle
          if (block.level === 1) {
            headingStyle = { ...Typography.heading3, color: baseColor }
          } else if (block.level === 2) {
            headingStyle = {
              ...Typography.body,
              fontFamily: BOLD_FAMILY,
              fontSize: 15,
              color: baseColor,
            }
          } else {
            headingStyle = {
              ...Typography.body,
              fontFamily: BOLD_FAMILY,
              color: accentColor,
            }
          }
          return (
            <Text
              key={i}
              style={[headingStyle, { marginBottom: isLast ? 0 : Spacing.xs }]}
            >
              {renderRuns(block.runs)}
            </Text>
          )
        }

        if (block.type === 'paragraph') {
          return (
            <Text
              key={i}
              style={{ ...Typography.body, color: baseColor, marginBottom: blockMargin }}
            >
              {renderRuns(block.runs)}
            </Text>
          )
        }

        const isOrdered = block.type === 'ordered'
        const items = block.items
        return (
          <View key={i} style={{ marginBottom: blockMargin, gap: 4 }}>
            {items.map((itemRuns, idx) => (
              <View key={idx} style={{ flexDirection: 'row', gap: 8, paddingLeft: 2 }}>
                <Text
                  style={{
                    ...Typography.body,
                    color: accentColor,
                    fontFamily: isOrdered ? BOLD_FAMILY : Typography.body.fontFamily,
                    minWidth: isOrdered ? 18 : 10,
                    textAlign: isOrdered ? 'right' : 'center',
                  }}
                >
                  {isOrdered ? `${idx + 1}.` : '•'}
                </Text>
                <Text
                  style={{ ...Typography.body, color: baseColor, flex: 1 }}
                >
                  {renderRuns(itemRuns)}
                </Text>
              </View>
            ))}
          </View>
        )
      })}
    </View>
  )
}
