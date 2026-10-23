# ClearMatch

> **Deterministic Invoice & Purchase Order Reconciliation Engine (`v0.1-deterministic`)**

[![Status: Work in Progress](https://img.shields.io/badge/status-work--in--progress-orange.svg)](https://github.com/astukov56/clearmatch)
[![Next.js 16](https://img.shields.io/badge/Next.js-16.4-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-64%20passing-brightgreen.svg)](https://vitest.dev/)

---

> [!WARNING]
> ### 🚧 Work in Progress (WIP)
> **ClearMatch is under active development and is not yet production-ready.**  
> Core architecture, API contracts, domain logic, and UI components are continuously being iterated. Features and schemas are subject to change.

---

## Overview

**ClearMatch** is an automated accounts payable reconciliation engine designed to eliminate invoice drift, phantom rate creep, and quantity mismatches between vendor invoices and contracted purchase orders (POs).

### The Core Architectural Thesis

ClearMatch rejects the fragile pattern of delegating financial calculations, rounding, or balance verification to probabilistic LLMs. Instead, the platform establishes an unyielding **Trust Boundary**:

- **Perception vs. Execution:** Gemini 3.8 Flash is strictly isolated as an untrusted perception layer validated via Zod runtime schemas (`ExtractedInvoiceSchema`). It is prohibited from performing arithmetic.
- **Deterministic Accounting:** All unit price comparisons, line totals, tax basis points, and drift calculations execute in pure TypeScript using integer cents (`src/lib/money.ts` and `src/lib/reconcile.ts`) to prevent IEEE-754 floating-point drift.

```text
[ Document Image / PDF ]
           │
           ▼
┌───────────────────────────────────────────────┐
│  UNTRUSTED PERCEPTION LAYER                   │
│  Gemini 3.8 Flash Vision OCR                  │
│  • Entity extraction only (text, rates, qty)  │
│  • Zero arithmetic, zero hallucinated totals  │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│  RUNTIME VALIDATION & GUARDRAILS              │
│  Zod Schema Validation (ExtractedInvoice)     │
│  Confidence scoring & ambiguity reporting     │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│  TRUSTED DETERMINISTIC EXECUTION              │
│  Pure TypeScript Financial Engine             │
│  • Integer-cent math (zero float operations)  │
│  • Basis-point tax calculations (bps)         │
│  • Deterministic line-item reconciliation     │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│  AUDIT PROOF & OPERATOR COMPLIANCE            │
│  • RFC 4180 ERP-ready CSV export              │
│  • Cryptographic JSON Audit Proof             │
│  • Itemized Commercial Dispute Notices (.txt) │
│  • Human-in-the-loop variance approval        │
└───────────────────────────────────────────────┘
```

---

## Core Engineering Invariants

ClearMatch adheres to four strict architectural rules:

1. **The Deterministic Split**
   - The LLM extracts raw entities only (OCR text, descriptions, unit rates, quantities).
   - The LLM **never** computes totals, taxes, variances, or margins.
   - All financial logic resides in pure, isolated TypeScript domain functions.

2. **Integer-Only Financial Math**
   - Zero floating-point arithmetic for currency calculations.
   - All monetary amounts are stored and calculated as integer cents (e.g., `$10.50` &rarr; `1050`).
   - Tax rates use basis points (`10%` &rarr; `1000 bps`) with half-up integer rounding.

3. **Strict TypeScript & Zero Untyped Data**
   - Strict TypeScript mode enabled with zero `any`.
   - All external inputs and model extractions validate through strict schemas.

4. **Failure Defense & Auditing**
   - Every invoice extraction validates against a [Zod schema](src/lib/extraction/schemas.ts).
   - Extractions must return an `extraction_confidence` score and an `unresolved_ambiguities` audit array.

---

## Development Status & Roadmap

| Feature | Status | Notes |
| :--- | :---: | :--- |
| **Integer Currency Math Library** | ✅ Complete | Zero floating point, integer cents, basis points rounding (`src/lib/money.ts`) |
| **Deterministic Reconciliation Engine** | ✅ Complete | Line item matching, unit rate variance, quantity drift, 49 passing unit/route tests (`src/lib/reconcile.ts`) |
| **Gemini 3.8 Flash Vision OCR** | ✅ Complete | Multimodal entity extraction with structured output, confidence guardrails & Zod validation |
| **Reconciliation API & FinOps Guards** | ✅ Complete | `/api/reconcile` supports PDF/PNG/JPEG uploads with payload size (4MB), line-item (50), and token guards |
| **Utilitarian Workbench UI** | ✅ Complete | Staged upload state machine, Reinforced Ledger vs. raw Trust Boundary inspector, instant architecture benchmarks |
| **Compliance & ERP Audit Exports** | ✅ Complete | Client-side ERP CSV export and cryptographic-style JSON Audit Proofs (`untrustedVlmExtraction` + `trustedDeterministicLedger` + Trace ID) |
| **AP Dispute & Override Workflows** | ✅ Complete | Automated Commercial Dispute Notice generator (`src/lib/utils/disputeNotice.ts`) and human-in-the-loop variance approval overrides |
| **Dynamic PO Baseline Management** | 🔄 In Progress | Custom PO baseline switcher and interactive JSON/schema editor for arbitrary invoice testing |
| **Supabase Persistence & Audit Ledger** | 📋 Planned | Persistent PO storage, immutable reconciliation audit logs, historical tracking |
| **Configurable Tolerance Policies** | 📋 Planned | Organization-level and vendor-specific automatic variance approval thresholds |

---

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack) & [React 19](https://react.dev/)
- **Language**: [TypeScript 5](https://www.typescriptlang.org/) (Strict Mode)
- **AI / Multimodal OCR**: [@google/genai](https://www.npmjs.com/package/@google/genai) (Gemini 3.8 Flash)
- **Validation**: [Zod](https://zod.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Testing**: [Vitest](https://vitest.dev/)

---

## Getting Started

### Prerequisites

- **Node.js**: v20 or newer
- **npm**, **pnpm**, or **yarn**
- **Gemini API Key**: from [Google AI Studio](https://aistudio.google.com/)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/astukov56/clearmatch.git
   cd clearmatch
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local # or create .env.local
   ```
   Add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

### Running the Development Server

Start the local server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application workbench.

### Running Tests

Execute the unit and integration test suite:
```bash
npm test
```

Type-check without emitting:
```bash
npx tsc --noEmit
```

---

## Project Structure

```text
clearmatch/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── reconcile/           # POST endpoint: file/JSON extraction & matching
│   │   ├── layout.tsx
│   │   └── page.tsx                 # Interactive reconciliation workbench & audit trail
│   ├── components/
│   │   └── DisputeModal.tsx         # Plain-text dispute notice modal, .txt download & mailto
│   └── lib/
│       ├── extraction/              # Gemini Vision client & Zod extraction schemas
│       │   ├── gemini.ts            # Multimodal extraction caller with structured output
│       │   └── schemas.ts           # ExtractedInvoice runtime schema & confidence guards
│       ├── utils/
│       │   ├── disputeNotice.ts     # Commercial vendor dispute notice memo generator
│       │   └── export.ts            # ERP-ready CSV and cryptographic JSON audit proof exporters
│       ├── money.ts                 # Integer-only currency arithmetic (cents & bps)
│       └── reconcile.ts             # Deterministic line item matching engine
├── fixtures/                        # Test purchase orders and sample invoice payloads
└── vitest.config.mts                # Vitest configuration
```

---

## License

This project is currently private / in development. All rights reserved.