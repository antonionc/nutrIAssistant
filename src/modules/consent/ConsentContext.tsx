import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { recordAuditEvent } from '../../services/auditLog'
import { logger } from '../../utils/logger'

// Three-toggle consent surface for GDPR Art. 9.2.a — covers the *purposes*
// of processing, not the sub-features. Splitting "PDFs" and "school
// menus" into separate toggles would produce consent fatigue for the same
// processing class. Keep this list frozen-in-spirit; new toggles need a
// fresh `policyVersion` bump and explicit re-acceptance.
export type ConsentToggle = 'health' | 'ai' | 'documents'

export interface ConsentState {
  health: boolean
  ai: boolean
  documents: boolean
  grantedAt: string | null
  policyVersion: string
}

// Bumped when the privacy policy is changed materially. A bump invalidates
// older consents and forces re-acceptance via `needsConsent`. Source of
// truth lives here so that the storage layer and the UI agree.
export const POLICY_VERSION = 'v1'
const STORAGE_KEY = 'nutri_consent_v1'

const INITIAL: ConsentState = {
  health: false,
  ai: false,
  documents: false,
  grantedAt: null,
  policyVersion: POLICY_VERSION,
}

interface ConsentContextValue {
  consent: ConsentState
  isLoaded: boolean
  setToggle: (key: ConsentToggle, value: boolean) => Promise<void>
  acceptInitial: (initial: Pick<ConsentState, 'health' | 'ai' | 'documents'>) => Promise<void>
  needsConsent: boolean
}

const ConsentContext = createContext<ConsentContextValue | null>(null)

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<ConsentState>(INITIAL)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) {
          setIsLoaded(true)
          return
        }
        try {
          const parsed = JSON.parse(raw) as ConsentState
          // A policy bump invalidates stale consents. We reset to INITIAL
          // so the onboarding screen prompts re-acceptance.
          if (parsed.policyVersion !== POLICY_VERSION) {
            setConsent(INITIAL)
          } else {
            setConsent(parsed)
          }
        } catch (err) {
          logger.warn('[Consent] corrupt consent payload, resetting', { err })
        } finally {
          setIsLoaded(true)
        }
      })
      .catch(() => setIsLoaded(true))
  }, [])

  const persist = useCallback(async (next: ConsentState) => {
    setConsent(next)
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [])

  const setToggle = useCallback(
    async (key: ConsentToggle, value: boolean) => {
      const next: ConsentState = { ...consent, [key]: value, grantedAt: new Date().toISOString() }
      await persist(next)
      await recordAuditEvent(value ? 'consent_granted' : 'consent_revoked', {
        toggle: key,
        policyVersion: POLICY_VERSION,
      })
    },
    [consent, persist],
  )

  const acceptInitial = useCallback(
    async (initial: Pick<ConsentState, 'health' | 'ai' | 'documents'>) => {
      const next: ConsentState = {
        ...initial,
        grantedAt: new Date().toISOString(),
        policyVersion: POLICY_VERSION,
      }
      await persist(next)
      // Each granted toggle gets its own audit row so a regulator can see
      // exactly which purposes the user consented to at this point in time.
      for (const k of ['health', 'ai', 'documents'] as const) {
        if (initial[k]) {
          await recordAuditEvent('consent_granted', { toggle: k, policyVersion: POLICY_VERSION })
        }
      }
    },
    [persist],
  )

  // Initial consent is required: the user has never accepted, OR the
  // accepted version is older than the current policy.
  const needsConsent =
    isLoaded && (consent.grantedAt === null || consent.policyVersion !== POLICY_VERSION)

  return (
    <ConsentContext.Provider value={{ consent, isLoaded, setToggle, acceptInitial, needsConsent }}>
      {children}
    </ConsentContext.Provider>
  )
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext)
  if (!ctx) throw new Error('useConsent must be used within a ConsentProvider')
  return ctx
}
