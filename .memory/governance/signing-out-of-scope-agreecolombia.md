---
name: Signing Out of Scope — AgreeColombia Owns Execution
description: Contract signing inside Andromeda was aborted as a feature; Andromeda only produces work-item-scoped document content, signature/execution live with AgreeColombia
type: constraint
---

# Signing is not an Andromeda capability

Andromeda **generates documents and text scoped to a specific work item** — material the
lawyer copies and pastes. **Signature and execution live with the partner, agreecolombia.com.**

In-app contract signing was **aborted as a feature**. Any signing tables still present in the
schema (`document_signatures`, `document_signature_events`, `generic_signing_*`, signing edge
functions, OTP/HMAC/certificate-chain code) are **residue of an abandoned feature**, not
evidence of a live capability.

## Rules

- Do **not** delete residual signing rows, documents, clients or work items associated with
  them. Specifically the ERIKA signature record and its client/work item/documents stay as-is;
  the blocked delete transaction stays rolled back permanently.
- Do **not** investigate the signing flow, bilateral ordering, certificate chain, or HMAC.
  That line is closed.
- Do **not** propose retiring, cleaning or migrating the signing tables. It is not a task.
- If a future finding touches those tables incidentally, report it in **one sentence** and
  move on. Do not open it.

**Why:** the lawyer scoped signing out of the product. Re-deriving "the schema has signing
tables, therefore signing is a feature" is the exact mistake this note prevents.
