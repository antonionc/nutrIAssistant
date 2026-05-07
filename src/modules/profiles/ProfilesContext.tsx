import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import * as FileSystem from 'expo-file-system/legacy'
import { FamilyMember, ProfileDocument } from '../../types/profiles'
import { AIAction } from '../../services/aiActions'
import {
  loadFamilyName,
  loadProfiles,
  markAppInitialized,
  saveFamilyName,
  saveProfiles,
  isAppInitialized,
} from './profileStorage'
import { computeDailyCalorieTarget, computeMacroTargets } from './calorieCalculator'
import { getAge } from '../../utils/ageUtils'
import { generateId } from '../../utils/idUtils'
import { resolveAvatarUri } from '../../services/avatarService'

// Removes avatarUrl for any member whose image file no longer exists on disk.
// Returns the cleaned array and a flag indicating whether anything changed.
async function sanitiseAvatarUris(
  profiles: FamilyMember[]
): Promise<{ profiles: FamilyMember[]; changed: boolean }> {
  let changed = false
  const sanitised = await Promise.all(
    profiles.map(async (p) => {
      if (!p.avatarUrl) return p
      const { exists } = await FileSystem.getInfoAsync(resolveAvatarUri(p.avatarUrl))
      if (exists) return p
      changed = true
      return { ...p, avatarUrl: undefined }
    })
  )
  return { profiles: sanitised, changed }
}

// Converts profiles saved with the old `age: number` field to `dateOfBirth: string`
function migrateProfile(raw: any): FamilyMember {
  if (!raw.dateOfBirth && typeof raw.age === 'number' && raw.age > 0) {
    const year = new Date().getFullYear() - raw.age
    const { age: _age, ...rest } = raw
    return { ...rest, dateOfBirth: `${year}-01-01` } as FamilyMember
  }
  return raw as FamilyMember
}

// Members can be added without specifying favoriteRecipeIds / documents —
// they default to empty arrays. This keeps existing call sites (settings,
// onboarding) untouched while the type still requires the fields on the
// stored FamilyMember.
type NewMemberInput = Omit<
  FamilyMember,
  'id' | 'createdAt' | 'updatedAt' | 'favoriteRecipeIds' | 'documents' | 'isSuperUser'
> & {
  favoriteRecipeIds?: string[]
  documents?: ProfileDocument[]
  isSuperUser?: boolean
}

interface ProfilesContextValue {
  profiles: FamilyMember[]
  familyName: string
  isLoading: boolean
  needsOnboarding: boolean
  addProfile: (member: NewMemberInput) => Promise<void>
  updateProfile: (id: string, updates: Partial<FamilyMember>) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  setFamilyName: (name: string) => Promise<void>
  completeOnboarding: (familyNameInput: string, members: NewMemberInput[]) => Promise<void>
  importFamily: (familyNameInput: string, members: FamilyMember[]) => Promise<void>
  addFavorite: (memberId: string, recipeId: string) => Promise<void>
  removeFavorite: (memberId: string, recipeId: string) => Promise<void>
  addDocument: (memberId: string, doc: ProfileDocument) => Promise<void>
  updateDocument: (memberId: string, docId: string, updates: Partial<ProfileDocument>) => Promise<void>
  removeDocument: (memberId: string, docId: string) => Promise<void>
  applyAIActions: (actions: AIAction[]) => Promise<{ applied: number; skipped: number }>
}

function applySchoolAgeRule<T extends { dateOfBirth: string; isSchoolAge: boolean }>(member: T): T {
  return getAge(member.dateOfBirth) < 18 ? { ...member, isSchoolAge: true } : member
}

const ProfilesContext = createContext<ProfilesContextValue | null>(null)

export function ProfilesProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfilesState] = useState<FamilyMember[]>([])
  const [familyName, setFamilyNameState] = useState<string>('My Family')
  const [isLoading, setIsLoading] = useState(true)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)

  useEffect(() => {
    async function init() {
      try {
        const initialized = await isAppInitialized()
        if (!initialized) {
          setNeedsOnboarding(true)
        } else {
          const [raw, fn] = await Promise.all([loadProfiles(), loadFamilyName()])
          const migrated = (raw as any[]).map(migrateProfile)
          const { profiles: p, changed } = await sanitiseAvatarUris(migrated)
          // Backfill super-user flag for legacy data: if no member is a super-user,
          // promote the first member. Idempotent: only fires when none exists.
          let withSuper = p
          let superChanged = false
          if (withSuper.length > 0 && !withSuper.some((m) => m.isSuperUser)) {
            withSuper = withSuper.map((m, i) => (i === 0 ? { ...m, isSuperUser: true } : m))
            superChanged = true
          }
          if (changed || superChanged) await saveProfiles(withSuper)
          setProfilesState(withSuper)
          setFamilyNameState(fn)
        }
      } catch (e) {
        console.error('[Profiles] Failed to load profiles, starting fresh:', e)
        setNeedsOnboarding(true)
      } finally {
        setIsLoading(false)
      }
    }
    init()
  }, [])

  const addProfile = useCallback(
    async (member: NewMemberInput) => {
      const now = new Date().toISOString()
      const newMember: FamilyMember = applySchoolAgeRule({
        ...member,
        favoriteRecipeIds: member.favoriteRecipeIds ?? [],
        documents: member.documents ?? [],
        isSuperUser: member.isSuperUser ?? false,
        id: generateId('member'),
        createdAt: now,
        updatedAt: now,
      })
      const updated = [...profiles, newMember]
      await saveProfiles(updated)
      setProfilesState(updated)
    },
    [profiles]
  )

  const updateProfile = useCallback(
    async (id: string, updates: Partial<FamilyMember>) => {
      let next: FamilyMember[] = []
      setProfilesState(prev => {
        next = prev.map(p =>
          p.id === id ? applySchoolAgeRule({ ...p, ...updates, updatedAt: new Date().toISOString() }) : p
        )
        return next
      })
      await saveProfiles(next)
    },
    []
  )

  const deleteProfile = useCallback(
    async (id: string) => {
      const updated = profiles.filter((p) => p.id !== id)
      await saveProfiles(updated)
      setProfilesState(updated)
    },
    [profiles]
  )

  const setFamilyName = useCallback(async (name: string) => {
    await saveFamilyName(name)
    setFamilyNameState(name)
  }, [])

  const completeOnboarding = useCallback(
    async (familyNameInput: string, members: NewMemberInput[]) => {
      const now = new Date().toISOString()
      const seeded: FamilyMember[] = members.map((m, i) => {
        const partial = m as FamilyMember
        const calories = m.dailyCalorieTarget ?? computeDailyCalorieTarget(partial)
        const macros = m.macroTargets ?? computeMacroTargets(calories, m.conditions)
        return applySchoolAgeRule({
          ...m,
          favoriteRecipeIds: m.favoriteRecipeIds ?? [],
          documents: m.documents ?? [],
          isSuperUser: m.isSuperUser ?? false,
          id: `member-${Date.now()}-${i}`,
          dailyCalorieTarget: calories,
          macroTargets: macros,
          createdAt: now,
          updatedAt: now,
        })
      })
      await saveProfiles(seeded)
      await saveFamilyName(familyNameInput)
      await markAppInitialized()
      setProfilesState(seeded)
      setFamilyNameState(familyNameInput)
      setNeedsOnboarding(false)
    },
    []
  )

  const importFamily = useCallback(
    async (familyNameInput: string, members: FamilyMember[]) => {
      const normalised = members.map((m) =>
        applySchoolAgeRule({
          ...m,
          favoriteRecipeIds: m.favoriteRecipeIds ?? [],
          documents: m.documents ?? [],
          isSuperUser: Boolean(m.isSuperUser),
        })
      )
      // Same backfill as init() for imports lacking a super-user.
      if (normalised.length > 0 && !normalised.some((m) => m.isSuperUser)) {
        normalised[0] = { ...normalised[0], isSuperUser: true }
      }
      await saveProfiles(normalised)
      await saveFamilyName(familyNameInput)
      await markAppInitialized()
      setProfilesState(normalised)
      setFamilyNameState(familyNameInput)
      setNeedsOnboarding(false)
    },
    []
  )

  // Internal helper: mutate a single member and persist.
  const mutateMember = useCallback(
    async (id: string, fn: (m: FamilyMember) => FamilyMember) => {
      let next: FamilyMember[] = []
      setProfilesState((prev) => {
        next = prev.map((p) =>
          p.id === id ? { ...fn(p), updatedAt: new Date().toISOString() } : p
        )
        return next
      })
      await saveProfiles(next)
    },
    []
  )

  const addFavorite = useCallback(
    async (memberId: string, recipeId: string) => {
      await mutateMember(memberId, (m) =>
        m.favoriteRecipeIds.includes(recipeId)
          ? m
          : { ...m, favoriteRecipeIds: [...m.favoriteRecipeIds, recipeId] }
      )
    },
    [mutateMember]
  )

  const removeFavorite = useCallback(
    async (memberId: string, recipeId: string) => {
      await mutateMember(memberId, (m) => ({
        ...m,
        favoriteRecipeIds: m.favoriteRecipeIds.filter((r) => r !== recipeId),
      }))
    },
    [mutateMember]
  )

  const addDocument = useCallback(
    async (memberId: string, doc: ProfileDocument) => {
      await mutateMember(memberId, (m) => ({
        ...m,
        documents: [...m.documents, doc],
      }))
    },
    [mutateMember]
  )

  const updateDocument = useCallback(
    async (memberId: string, docId: string, updates: Partial<ProfileDocument>) => {
      await mutateMember(memberId, (m) => ({
        ...m,
        documents: m.documents.map((d) => (d.id === docId ? { ...d, ...updates } : d)),
      }))
    },
    [mutateMember]
  )

  const removeDocument = useCallback(
    async (memberId: string, docId: string) => {
      await mutateMember(memberId, (m) => ({
        ...m,
        documents: m.documents.filter((d) => d.id !== docId),
      }))
    },
    [mutateMember]
  )

  // Apply structured actions emitted by the on-device LLM. Unknown member or
  // recipe IDs are silently skipped so a hallucinated ID never crashes the app.
  const applyAIActions = useCallback(
    async (actions: AIAction[]) => {
      let applied = 0
      let skipped = 0
      for (const action of actions) {
        const member = profiles.find((p) => p.id === action.memberId)
        if (!member) {
          skipped++
          continue
        }
        if (action.type === 'add_favorite') {
          await addFavorite(action.memberId, action.recipeId)
          applied++
        } else if (action.type === 'remove_favorite') {
          await removeFavorite(action.memberId, action.recipeId)
          applied++
        } else {
          skipped++
        }
      }
      return { applied, skipped }
    },
    [profiles, addFavorite, removeFavorite]
  )

  return (
    <ProfilesContext.Provider
      value={{
        profiles,
        familyName,
        isLoading,
        needsOnboarding,
        addProfile,
        updateProfile,
        deleteProfile,
        setFamilyName,
        completeOnboarding,
        importFamily,
        addFavorite,
        removeFavorite,
        addDocument,
        updateDocument,
        removeDocument,
        applyAIActions,
      }}
    >
      {children}
    </ProfilesContext.Provider>
  )
}

export function useProfiles(): ProfilesContextValue {
  const ctx = useContext(ProfilesContext)
  if (!ctx) throw new Error('useProfiles must be used within ProfilesProvider')
  return ctx
}
