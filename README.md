# ClearMatch — Deterministic Accounts Payable Reconciliation & Audit Workbench

B2B Accounts Payable teams lose thousands of dollars to subtle vendor price creep, uncontracted seat overages, and IEEE 754 floating-point rounding errors. Worse, wrapping financial workflows directly around raw Large Language Models introduces non-deterministic calculation drift and hallucination risks directly into accounting ledgers.

**ClearMatch** solves this by enforcing a strict **Trust Boundary** between non-deterministic document extraction and deterministic financial computation. Vision-Language Models (VLMs) are restricted exclusively to unstructured OCR entity extraction, while all currency normalization, line-item math, basis-point tax validation, and contract variance checks execute inside a pure, integer-cent TypeScript reconciliation engine backed by an immutable PostgreSQL audit ledger.

---

## The Trust Boundary Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│  1. UNTRUSTED INGESTION LAYER (Multi-Model VLM Cascade)                    │
│     • Parses unstructured vendor PDF & image invoices via Google Gemini    │
│     • Automated multi-model fallback routing for resilient extraction      │
│     • Emits raw line-item strings, unit prices, & confidence telemetry     │
│     • Strictly prohibited from computing subtotals, taxes, or variances    │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │ Raw Untrusted JSON Payload
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  2. CRYPTOGRAPHIC & SCHEMA GATEKEEPER (Zod Boundary Validation)            │
│     • Enforces strict runtime schema contracts prior to financial execution│
│     • Rejects malformed payloads and strips hallucinated total fields      │
│     • Trips automated OCR Confidence Guardrail (< 0.85 → MANUAL_REVIEW)    │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │ Validated Domain Entities
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  3. DETERMINISTIC INTEGER-CENT ENGINE (Pure TypeScript Financial Core)     │
│     • Normalizes all currency values into integer cents ($12.79 → 1279¢)   │
│     • Computes line-item extensions, basis-point taxes, & PO variances     │
│     • Guarantees zero IEEE 754 floating-point drift across all ledgers     │
│     • Evaluates Straight-Through Processing (STP) tolerance policies       │
└────────────────────────────────────────────────────────────────────────────┘
```

### 1. Untrusted Ingestion Layer (Multi-Model VLM Cascade)
Unstructured vendor invoices (PDFs and scanned images) are ingested through a fault-tolerant Google Gemini VLM cascade (`gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-1.5-flash`) with deterministic PDF text-stream fallback. The extraction layer captures raw line-item descriptions, quantities, unit rates, extraction confidence scores, and unresolved ambiguities—never calculated totals.

### 2. Cryptographic & Schema Gatekeeper (Zod)
Every extracted payload must pass a strict runtime Zod boundary contract (`RawExtractionSchema`) before touching the financial engine. If an invoice scan exhibits degraded legibility (`extraction_confidence < 0.85`) or unresolved structural ambiguities, ClearMatch automatically trips an **OCR Confidence Guardrail**, routing the reconciliation to `MANUAL_REVIEW` before a single cent is approved.

### 3. Deterministic Integer-Cent Engine (TypeScript)
All monetary values are converted to integer cents (`$12.79` → `1279` cents) and basis points (`10%` → `1000` bps) prior to arithmetic. Line-item totals, contract rate comparisons against Purchase Orders, quantity deltas, and tolerance thresholds are computed deterministically—eliminating binary floating-point representation errors (`0.1 + 0.2 !== 0.30000000000000004`).

---

## Core Production Capabilities

### Straight-Through Processing (STP) Policy Engine
Real-time Accounts Payable triage across configurable corporate tolerance thresholds without re-running VLM extraction:
- **Strict ($0.00 / 0 bps)**: Zero-tolerance contract enforcement; flags even a `$0.01` variance.
- **Standard AP ($1.00 / 100¢)**: Absorbs sub-dollar rounding variance while blocking real unit-price creep or uncontracted seat overages.
- **High-Volume ($5.00 / 500¢)**: Streamlines minor billing discrepancies for high-throughput vendor queues.

### Automated Dispute Notice & Short-Pay PDF Generation
For `FLAGGED_DRIFT` and `MANUAL_REVIEW` reconciliations, operators can generate formal, executive-ready **Notices of Invoice Discrepancy & Short-Pay Adjustment** in a single click:
- **Printable Corporate PDF Export (`pdf-lib`)**: Generates a formatted single-page corporate dispute PDF complete with Trace ID, vendor contract metadata, financial variance summary boxes, itemized line-item discrepancy tables, and authorized short-pay remittance amounts.
- **Documented Human Override Workflow**: Allows authorized operators to approve variance exceptions with mandatory justification notes persisted directly to the audit trail.

### Immutable PostgreSQL Audit Ledger (Supabase)
Every reconciliation run and operator action is permanently recorded in Supabase PostgreSQL with Row-Level Security (RLS):
- **`reconciliation_audit_logs`**: Stores the cryptographic `trace_id`, untrusted VLM extraction payload, deterministic integer-cent ledger output, active STP policy, and variance status.
- **`audit_resolution_events`**: Tracks every formal Dispute Notice dispatch (`DISPUTED`) and documented exception approval (`OVERRIDDEN_APPROVED`) linked to its parent reconciliation trace.
- **Passwordless Operator Attribution**: Integrated Supabase Magic Link email authentication attributes every reconciliation run, dispute memo, and override decision to the verified operator's corporate identity (`operator_email` / `operator_id`), while preserving instant Sandbox access for unauthenticated evaluation.

### Keyboard-First Operator Triage HUD
Engineered for high-velocity Accounts Payable operators with single-key bindings across the entire workbench:
- **`1` / `2` / `3`**: Execute deterministic financial benchmarks (Clean Match, `$2,500` Cloud Seat Overage, and `$0.01` IEEE 754 Floating-Point Penny Trap).
- **`Q` / `W` / `E`**: Stage synthetic vendor PDF invoices into the live VLM ingestion pipeline.
- **`S`**: Cycle active Straight-Through Processing (STP) tolerance policies in real time.
- **`T`**: Toggle the Split-Screen Trust Boundary Inspector comparing raw untrusted VLM JSON against the deterministic integer-cent ledger.
- **`H`**: Open the live Supabase PostgreSQL Audit Ledger drawer.
- **`D` / `K`**: Toggle persistent Light/Dark operator themes and collapsible HUD mode.

---

## Technology Stack

| Layer | Technology | Role in Architecture |
| :--- | :--- | :--- |
| **Application Framework** | Next.js (App Router) & React 19 | Full-stack serverless routing & reactive operator workbench |
| **Financial Core** | Strict TypeScript (Integer-Cent Domain) | Pure, deterministic financial arithmetic & variance engine |
| **Boundary Validation** | Zod | Runtime schema enforcement & OCR guardrail checks |
| **Document Ingestion** | Google Gemini VLM API (`@google/genai`) | Multi-model vision cascade for unstructured invoice extraction |
| **Document Generation** | `pdf-lib` | Client-side corporate PDF Dispute Notice & Short-Pay export |
| **Audit Database & Auth** | Supabase (PostgreSQL + Magic Link Auth) | Immutable RLS audit ledger & passwordless operator attribution |
| **Styling & UI** | Tailwind CSS | High-contrast Light/Dark adaptive financial terminal UI |
| **Deployment** | Vercel | Edge-cached production hosting & serverless API execution |
