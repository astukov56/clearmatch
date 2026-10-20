# ClearMatch

> **Deterministic Invoice & Purchase Order Reconciliation Engine**

[![Status: Work in Progress](https://img.shields.io/badge/status-work--in--progress-orange.svg)](https://github.com/astukov56/clearmatch)
[![Next.js 16](https://img.shields.io/badge/Next.js-16.4-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-vitest%20passing-brightgreen.svg)](https://vitest.dev/)

---

> [!WARNING]
> ### 🚧 Work in Progress (WIP)
> **ClearMatch is under active development and is not yet production-ready.**  
> Core architecture, API contracts, domain logic, and UI components are continuously being iterated. Features and schemas are subject to change.

---

## Overview

**ClearMatch** is an automated accounts payable reconciliation system designed to solve invoice drift, phantom charges, and quantity mismatches between vendor invoices and purchase orders (POs).

Unlike traditional solutions that rely on fuzzy LLM summaries or brittle regex parsers, ClearMatch enforces a **strict deterministic split**:
- **Multimodal AI (Gemini 3.8 Flash)** performs entity extraction and optical character recognition (OCR) directly from document images and PDFs.
- **Pure TypeScript Domain Logic** performs 100% of the mathematical calculations, tax verifications, discrepancy detections, and tolerance checks.

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
| **Deterministic Reconciliation Engine** | ✅ Complete | Line item matching, unit rate variance, quantity drift (`src/lib/reconcile.ts`) |
| **Gemini 3.8 Flash Vision OCR** | ✅ Complete | Multimodal entity extraction with structured output & Zod validation |
| **Reconciliation API Route** | ✅ Complete | `/api/reconcile` supports direct file uploads (PNG, JPEG, PDF) & JSON payloads |
| **Utilitarian Workbench UI** | 🔄 In Progress | Split-view PO vs. Invoice inspector, synthetic canvas invoice generator |
| **Supabase Integration & Persistence** | 🔄 In Progress | PO storage, reconciliation audit logs, historical tracking |
| **Multi-page & Batch Ingestion** | 📋 Planned | Asynchronous queue worker for high-volume invoice batches |
| **Configurable Tolerance Policies** | 📋 Planned | Organization-level and vendor-specific variance thresholds |

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

---

## Project Structure

```text
clearmatch/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── reconcile/       # POST endpoint: file/JSON extraction & matching
│   │   ├── layout.tsx
│   │   └── page.tsx             # Interactive reconciliation workbench
│   └── lib/
│       ├── extraction/          # Gemini Vision client & Zod extraction schemas
│       ├── money.ts             # Integer-only currency arithmetic (cents & bps)
│       └── reconcile.ts         # Deterministic line item matching engine
├── fixtures/                    # Test purchase orders and sample invoice payloads
└── vitest.config.mts            # Vitest configuration
```

---

## License

This project is currently private / in development. All rights reserved.