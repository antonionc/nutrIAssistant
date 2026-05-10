import { FamilyMember } from '../../types/profiles'
import { getAge } from '../../utils/ageUtils'

// Policy: the on-device AI assistant is gated by the active user's age.
// Anyone under 18 (or any state where we can't confirm 18+) is blocked.
// Hide-by-default — if there's no active profile or the profile lacks a
// valid date of birth, we treat that as "cannot verify adult" and deny.
//
// This is the single source of truth, used by:
//   - AIFloatingButton (hides the FAB)
//   - AIAssistantHost (auto-closes the sheet on profile switch)
//   - AIEngine.sendMessage (refuses to send if somehow reached)
export const ADULT_AGE = 18

export function isAIAccessibleForMember(member?: FamilyMember | null): boolean {
  if (!member) return false
  if (!member.dateOfBirth) return false
  const age = getAge(member.dateOfBirth)
  // getAge returns 0 for malformed input — that's < 18, so the deny path
  // is taken automatically. No special-casing needed.
  return age >= ADULT_AGE
}
