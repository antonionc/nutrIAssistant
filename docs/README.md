# NutrIAssistant — Documentation

Technical and strategic documentation for **NutrIAssistant**, a local-first React Native nutrition assistant for families with on-device AI (Qwen 3 1.7B Quantized via ExecuTorch), encrypted SQLite storage, and zero backend.

The project status at the time of writing is **prototype `v1.0.0` in development**. Every factual claim in this documentation is anchored to a source-code reference of the form `path/to/file.ext:Lnn-Lnn`. Gaps relative to a production-ready state are flagged with `⚠️ GAP`.

## Areas

| Area | Status | Entry point |
|---|---|---|
| Data, AI, and Compliance Architecture | ✅ Complete | [`data-architecture/`](./data-architecture/README.md) |

## How to read this documentation

1. Start with the [Executive Summary](./data-architecture/00-executive-summary.md) for the one-page picture of where the project stands today.
2. Drill into any specific concern (security, privacy, observability, …) via the area-specific README.
3. The architecture is fully described by Mermaid diagrams: a C4 model (context → containers → components), plus sequence, state, and ER diagrams. They are rendered automatically by GitHub.

## Conventions

- **Language:** English. All documentation, identifiers, and inline citations are in English.
- **Citations:** `path/file.ext:Lnn` or `path/file.ext:Lnn-Lmm`. Citations capture the file state at the time the section was written; drift of a few lines is expected over time.
- **Gap markers:** `⚠️ GAP` denotes something declared, expected by a normative reference (course curriculum, GDPR, App Store guidelines, etc.), but not yet present in the repository.
- **Status icons in tables:** ✅ implemented · 🟡 partial · 🔴 missing · ⚠️ at risk.
