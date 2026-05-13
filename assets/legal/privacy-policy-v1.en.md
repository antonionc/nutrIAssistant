# Privacy Policy — NutrIAssistant

**Version:** v1
**Last updated:** 2026-05-13

> This is a placeholder text drafted by engineering. The final version
> must be reviewed and signed off by qualified legal counsel before
> production release. Sections below match the structure required by
> Spanish AEPD and GDPR Art. 13.

## 1. Data controller

NutrIAssistant ("we", "the app"). Contact for privacy matters:
hola@nutriassistant.ai. A Data Protection Officer will be appointed
before the production launch; the appointment will be reflected here.

## 2. Categories of personal data we process

- **Identifying data:** family name, member display names, dates of birth, role within the family, optional avatar image.
- **Health data (GDPR Art. 9):** weight, height, declared allergies, diagnosed medical conditions, free-text "about me" notes, uploaded clinical PDF documents.
- **Usage data on-device:** chat messages with the on-device AI, AI-extracted memories, meal plans, recipe favorites, pantry inventory, grocery list, barcode scan history, school menus.
- **Device technical data:** locale, OS version, app version. No advertising identifiers are collected.

## 3. Where the data lives

All personal data is stored **on your device** in encrypted SQLite and
AsyncStorage, plus encrypted files in the app's document directory.
Sensitive fields use AES-256-GCM with a master key held in the iOS
Keychain or Android Keystore. **No personal data is sent to any of our
servers.** The Cloudflare Worker BFF at api.nutriassistant.org proxies
catalog APIs (OpenFoodFacts, Edamam, Spoonacular) — the queries we
forward contain no personal data.

## 4. Legal basis (GDPR Art. 6 + Art. 9.2.a)

- **Health data processing** (Art. 9) — your explicit consent, captured
  in the onboarding consent screen and revocable in Settings.
- **Service delivery** (Art. 6.1.b) — performance of the service you
  requested by installing the app.

You can revoke any granted consent at any time from Settings → My consent.

## 5. Retention

- Scan history: 180 days.
- Meal plans: 90 days.
- Conversation summaries: 30 days.
- Audit log: 365 days.
- Profiles, memories, documents, recipes: kept until you delete the data
  yourself or trigger a full erasure.

## 6. Your rights

You may, at any time:

- **Access** your data via Settings → Export all my data (GDPR).
- **Rectify** any field by editing your profile.
- **Erase** all your data via Settings → Delete all my data.
- **Object** to a specific processing purpose by revoking the
  corresponding consent toggle.
- **Lodge a complaint** with the Spanish Data Protection Agency (AEPD).

## 7. Minors

Members under 14 may not be added without verifiable parental consent.
The AI assistant is disabled for members under 18 regardless of
parental consent.

## 8. International transfers

OpenFoodFacts (France), Edamam (US), and Spoonacular (US) are reached
only through our EU-hosted Cloudflare Worker. Query parameters contain
no personal data, but the upstream IP path crosses borders. Standard
Contractual Clauses (SCCs) with Edamam and Spoonacular are pending.

## 9. Changes to this policy

A material change bumps the policy version and re-prompts you for
consent on next launch. Minor edits (typos, clarifications) do not.

## 10. Contact

hola@nutriassistant.ai
