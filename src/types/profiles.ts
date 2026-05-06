export type MemberRole = 'father' | 'mother' | 'son' | 'daughter' | 'other'

export type AllergenType =
  | 'gluten' | 'dairy' | 'eggs' | 'peanuts' | 'tree nuts' | 'soy'
  | 'fish' | 'shellfish' | 'sesame' | 'celery' | 'mustard' | 'lupin'
  | 'mollusks' | 'sulfites'

export type DietPreference =
  | 'vegetarian' | 'vegan' | 'pescatarian' | 'keto' | 'mediterranean' | 'none'

export interface SupplementEntry {
  id: string
  name: string
  dose: string
  meal: 'breakfast' | 'lunch' | 'dinner'
  notes?: string
}

export interface SchoolMenuEntry {
  id: string
  date: string          // ISO date YYYY-MM-DD
  childId: string
  meal: 'lunch'
  description: string
  extractedIngredients: string[]
  extractedAllergens: string[]
  nutritionalEstimate?: {
    calories: number
    protein: number
    carbs: number
    fat: number
  }
}

export type DocumentCategory = 'lab_report' | 'medical_history' | 'prescription' | 'other'

export type DocumentSummaryStatus = 'pending' | 'ready' | 'failed'

export interface ProfileDocument {
  id: string
  filename: string
  filePath: string                  // relative to FileSystem.documentDirectory
  uploadedAt: string                // ISO
  category: DocumentCategory
  pageCount?: number
  aiSummary?: string                // ≤500 chars; injected into the LLM system prompt
  aiSummaryStatus: DocumentSummaryStatus
}

export interface FamilyMember {
  id: string
  name: string
  role: MemberRole
  dateOfBirth: string      // ISO YYYY-MM-DD
  weight: number              // kg
  height: number              // cm
  bloodPressure?: string
  restingHeartRate?: number   // bpm
  hrv?: number                // ms
  spO2?: number               // %
  allergies: AllergenType[]
  conditions: string[]
  dietPreference: DietPreference
  avatarUrl?: string
  isSchoolAge: boolean
  schoolMenuDays?: SchoolMenuEntry[]
  supplements?: SupplementEntry[]
  dailyCalorieTarget?: number
  macroTargets?: {
    protein: number
    carbs: number
    fat: number
  }
  favoriteRecipeIds: string[]
  documents: ProfileDocument[]
  createdAt: string
  updatedAt: string
}
