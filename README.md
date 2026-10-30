# ClearMatch

> **Deterministic Accounts Payable Invoice & Purchase Order Reconciliation Engine**

[![Next.js 16](https://img.shields.io/badge/Next.js-16.4-black.svg)](https://nextjs.org/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5.x%20Strict-blue.svg)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Auth-3ecf8e.svg)](https://supabase.com/)
[![Tests](https://img.shields.io/badge/Vitest-128%20passing-brightgreen.svg)](https://vitest.dev/)

---

## Overview

**ClearMatch** is a high-density Accounts Payable (AP) reconciliation workbench and financial audit engine designed to detect vendor rate drift, uncontracted seat creep, and quantity mismatches between incoming vendor invoices and authorized Purchase Order (PO) baselines.

Rather than delegating financial arithmetic to probabilistic LLMs, ClearMatch enforces a strict **Trust Boundary** between **non-deterministic perception** (multimodal VLM entity extraction) and **deterministic execution** (pure TypeScript integer-cent financial math).

---

## System Architecture & Trust Boundary

```text
[ Vendor Invoice PDF / PNG / JPEG ]
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  1. UNTRUSTED PERCEPTION LAYER                          │
│  Multi-Model Gemini VLM Cascade + Local PDF Fallback    │
│  • Extracts raw entities only (descriptions, qty, rate) │
│  • Strictly prohibited from computing financial totals  │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  2. RUNTIME SCHEMA & CONFIDENCE GUARDRAILS              │
│  Zod Boundary Schema (`ExtractedInvoiceSchema`)         │
│  • Enforces `extraction_confidence` & ambiguity arrays  │
│  • Routes low-confidence (< 0.85) scans to review       │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  3. TRUSTED DETERMINISTIC FINANCIAL ENGINE              │
│  Pure TypeScript Integer-Cent Math (`src/lib/money.ts`) │
│  • Zero IEEE 754 floating-point operations for money    │
│  • Integer cents ($10.50 -> 1050¢) & basis points (bps) │
│  • Dual-gate STP Tolerance Policy evaluation            │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  4. OPERATOR TRIAGE, DISPUTE & AUDIT LEDGER             │
│  • Itemized Formal Dispute Notice & Short-Pay Generator │
│  • Documented Human Override (`APPROVED_WITH_OVERRIDE`) │
│  • Supabase PostgreSQL Immutable Audit Trail + RLS      │
│  • Passwordless Operator Attribution (Magic Link Auth)  │
└─────────────────────────────────────────────────────────┘
```

### Core Engineering Invariants

1. **The Deterministic Split (`src/lib/extraction/gemini.ts` vs `src/lib/reconcile.ts`)**:
   - Vision Language Models extract raw document entities only (`invoice_number`, `po_number`, `vendor_name`, `raw_description`, `quantity`, `unit_price`).
   - The LLM **never** calculates line subtotals, tax amounts, net variances, or short-pay remittances.
   - All financial comparisons execute inside pure, deterministic TypeScript domain functions.

2. **Integer-Only Financial Math (`src/lib/money.ts`)**:
   - Floating-point arithmetic (`0.1 + 0.2 !== 0.3` or `10 * 12.79 + 4 * 44.15 = 304.50000000000006`) is eliminated at the boundary via string-parsed integer cent conversion (`dollarsToCents`).
   - All currency values are stored and reconciled as integer cents (`125000` = `$1,250.00`).
   - Tax rates and relative variance thresholds are evaluated in integer basis points (`1000 bps` = `10.00%`) with deterministic half-up rounding.

3. **Strict TypeScript & Zod Runtime Validation (`src/lib/extraction/schemas.ts`)**:
   - Strict TypeScript mode (`noImplicitAny`, `strictNullChecks`) with zero `any` types across API routes, domain logic, and UI components.
   - Every extraction payload is validated against `ExtractedInvoiceSchema` and must include `extraction_confidence` (`0.0`–`1.0`) and `unresolved_ambiguities`.

---

## Core Capabilities

- **Resilient Multi-Model VLM Cascade & Deterministic Fallback (`src/lib/extraction/gemini.ts`, `src/app/api/reconcile/route.ts`)**:
  - Cascades across verified Gemini models (`gemini-3.5-flash` &rarr; `gemini-flash-lite-latest` &rarr; `gemini-4-argon` &rarr; `gemini-pro-latest` &rarr; `gemini-flash-latest`) with per-attempt `AbortController` timeouts.
  - Includes a deterministic local PDF stream/zlib parser fallback so verification workflows remain 100% operational even during upstream API outages.
- **Straight-Through Processing (STP) Tolerance Policies (`src/lib/types/tolerance.ts`)**:
  - Configurable dual-gate governance presets (`Strict $0.00 / 0 bps`, `Standard AP $1.00 / 100 bps`, `High-Volume $5.00 / 200 bps`) enforcing both absolute cent caps and basis-point thresholds alongside strict quantity matching.
- **Automated Formal Dispute Notice & Printable PDF Generator (`src/lib/disputeGenerator.ts`, `src/lib/disputePdfGenerator.ts`)**:
  - Deterministically formats executive-ready `"NOTICE OF INVOICE DISCREPANCY & SHORT-PAY ADJUSTMENT"` memos with itemized line-by-line cent/dollar deltas, authorized short-pay remittance figures, and live operator signature attribution.
  - Exports printable single-page corporate PDF dispute notices via `pdf-lib` (`[ 📄 Export Official PDF ]`) alongside plain-text `.txt` and clipboard copy workflows.
- **Immutable Audit Ledger & Resolution Event Trail (`src/lib/services/auditService.ts`)**:
  - Persists reconciliation runs to `public.reconciliations` and operator resolution actions (`DISPUTE_NOTICE_GENERATED`, `HUMAN_OVERRIDE`) to `public.audit_resolution_events` in Supabase PostgreSQL.
  - Supports one-click state hydration from the slide-over `Audit Ledger History` drawer, RFC 4180 ERP CSV exports, and cryptographic-style JSON Audit Proofs.
- **Passwordless Operator Attribution & Keyboard-First Triage HUD (`src/lib/supabaseAuth.ts`, `src/lib/hooks/useOperatorHotkeys.ts`)**:
  - Integrates Supabase Email Magic Link authentication (`signInWithOtp`) to attribute reconciliations, overrides, and dispute memos to the signed-in operator (`operator_email`), with instant `"All Runs"` vs. `"My Runs"` ledger filtering and frictionless Guest Sandbox fallback.
  - Global single-key operator shortcuts (`[1-3]` presets, `[Q/W]` sample PDFs, `[E]` extract, `[S]` cycle STP policy, `[T]` toggle Trust Boundary inspector, `[H]` audit history, `[D]` Light/Dark theme, `[K]` collapsible HUD, `[?]` shortcut reference) with automatic input-focus guards.

---

## Local Quickstart & Test Suite

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local` and populate your credentials (ClearMatch also runs gracefully in local offline/sandbox mode if keys are omitted):

```bash
cp .env.example .env.local
```

```env
# Google Gemini API Key for live PDF/Image VLM extraction
GEMINI_API_KEY=your_gemini_api_key_here

# Supabase Project Credentials for Audit Ledger & Magic Link Auth
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_publishable_key_here
```

### 3. Generate Synthetic Verification PDFs

Generate the sample invoice PDFs (`vertex-clean-match-inv-2026-4401.pdf` and `vertex-seat-creep-drift-inv-2026-4402.pdf`) in `public/synthetic-invoices/`:

```bash
npm run generate:invoices
```

### 4. Run Unit & Integration Tests

Run the full Vitest suite (14 test suites, 127 tests covering integer money math, reconciliation engine, dispute memo generation, hotkey dispatching, Supabase auth/audit persistence, and API route resilience):

```bash
npm test
```

Run strict TypeScript verification and production build:

```bash
npx tsc --noEmit
npm run build
```

### 5. Start the Development Workbench

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to launch the ClearMatch operator workbench.

---

## Project Structure

```text
clearmatch/
├── public/
│   └── synthetic-invoices/          # Generated sample PDFs for live ingestion verification
├── scripts/
│   └── generate-synthetic-invoices.ts
├── src/
│   ├── app/
│   │   ├── api/reconcile/           # POST /api/reconcile route & multi-model fallback tests
│   │   ├── globals.css              # Light & Carbon-Slate Dark theme styling rules
│   │   ├── layout.tsx
│   │   └── page.tsx                 # Main ClearMatch Operator Workbench
│   ├── components/
│   │   ├── AuditLedgerDrawer.tsx    # Historical audit trail slide-over & "My Runs" filter
│   │   ├── DisputeModal.tsx         # Expandable vendor dispute notice modal
│   │   ├── DisputeResolutionPanel.tsx # Inline dispute notice preview & human override form
│   │   ├── KeyboardHudBar.tsx       # Collapsible 1-line keyboard HUD & [?] reference modal
│   │   ├── OperatorAuthModal.tsx    # Passwordless Supabase Magic Link sign-in modal
│   │   └── PoBaselineModal.tsx      # Interactive PO baseline switcher & JSON contract editor
│   └── lib/
│       ├── constants/               # Authorized Purchase Order baseline presets
│       ├── extraction/              # Gemini multi-model cascade & Zod boundary schemas
│       ├── hooks/                   # Global keyboard shortcut dispatcher (`useOperatorHotkeys`)
│       ├── services/                # Supabase audit persistence (`auditService.ts`)
│       ├── supabase/                # Singleton Supabase client with offline/test guards
│       ├── types/                   # STP Tolerance Policy definitions (`tolerance.ts`)
│       ├── utils/                   # RFC 4180 CSV & JSON Audit Proof exporters
│       ├── disputeGenerator.ts      # Deterministic Dispute Notice & Short-Pay memo generator
│       ├── disputePdfGenerator.ts   # Printable single-page corporate PDF Dispute Notice generator (`pdf-lib`)
│       ├── money.ts                 # Pure integer-cent & basis-point financial arithmetic
│       ├── reconcile.ts             # Deterministic PO vs. Invoice reconciliation engine
│       └── supabaseAuth.ts          # Passwordless Magic Link auth helpers & session hook
└── .env.example                     # Environment variable template
```
