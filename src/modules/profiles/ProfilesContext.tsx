import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { FamilyMember } from '../../types/profiles'
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

// Converts profiles saved with the old `age: number` field to `dateOfBirth: string`
function migrateProfile(raw: any): FamilyMember {
  if (!raw.dateOfBirth && typeof raw.age === 'number' && raw.age > 0) {
    const year = new Date().getFullYear() - raw.age
    const { age: _age, ...rest } = raw
    return { ...rest, dateOfBirth: `${year}-01-01` } as FamilyMember
  }
  return raw as FamilyMember
}

interface ProfilesContextValue {
  profiles: FamilyMember[]
  familyName: string
  isLoading: boolean
  needsOnboarding: boolean
  addProfile: (member: Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  updateProfile: (id: string, updates: Partial<FamilyMember>) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  setFamilyName: (name: string) => Promise<void>
  completeOnboarding: (
    familyNameInput: string,
    members: Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>[]
  ) => Promise<void>
  importFamily: (familyNameInput: string, members: FamilyMember[]) => Promise<void>
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
      const initialized = await isAppInitialized()
      if (!initialized) {
        setNeedsOnboarding(true)
      } else {
        const [raw, fn] = await Promise.all([loadProfiles(), loadFamilyName()])
        const p = (raw as any[]).map(migrateProfile)
        setProfilesState(p)
        setFamilyNameState(fn)
      }
      setIsLoading(false)
    }
    init()
  }, [])

  const addProfile = useCallback(
    async (member: Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = new Date().toISOString()
      const newMember: FamilyMember = applySchoolAgeRule({
        ...member,
        id: `member-${Date.now()}`,
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
      const updated = profiles.map((p) =>
        p.id === id ? applySchoolAgeRule({ ...p, ...updates, updatedAt: new Date().toISOString() }) : p
      )
      await saveProfiles(updated)
      setProfilesState(updated)
    },
    [profiles]
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
    async (
      familyNameInput: string,
      members: Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>[]
    ) => {
      const now = new Date().toISOString()
      const seeded: FamilyMember[] = members.map((m, i) => {
        const partial = m as FamilyMember
        const calories = m.dailyCalorieTarget ?? computeDailyCalorieTarget(partial)
        const macros = m.macroTargets ?? computeMacroTargets(calories, m.conditions)
        return applySchoolAgeRule({
          ...m,
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
      const normalised = members.map(applySchoolAgeRule)
      await saveProfiles(normalised)
      await saveFamilyName(familyNameInput)
      await markAppInitialized()
      setProfilesState(normalised)
      setFamilyNameState(familyNameInput)
      setNeedsOnboarding(false)
    },
    []
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
