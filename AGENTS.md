# ClearMatch Engineering Invariants

1. THE DETERMINISTIC SPLIT:
   - LLMs extract entities only (raw OCR text, descriptions, unit rates).
   - The LLM NEVER calculates totals, taxes, variances, or margins.
   - All financial logic must reside in pure TypeScript domain functions.

2. INTEGER-ONLY FINANCIAL MATH:
   - Zero floating-point operations for money.
   - All currency values must be stored and calculated as integer cents (e.g., $10.50 -> 1050).
   - Tax rates must use basis points (e.g., 10% -> 1000 bps).

3. STRICT TYPESCRIPT:
   - Strict mode enabled, zero `any`, zero untyped API responses.
   - Database queries must use types generated from `supabase gen types typescript`.

4. FAILURE DEFENSE:
   - Every invoice extraction must validate against Zod and return `extraction_confidence`
     and an `unresolved_ambiguities` array.