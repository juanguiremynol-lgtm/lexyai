---
name: Fingerprint Immutability Rule
description: No identity component is ever added to an existing fingerprint; new components require a versioned fingerprint computed and compared alongside the old one
type: constraint
---

# Fingerprint immutability (KN2, final decision by the doctor)

**Rule.** No identity component is added to an existing fingerprint. Not now,
not later, not "as an improvement".

Adding a component retroactively re-identifies every stored row: it is not a
migration, it is a silent duplication of the whole table.

If a new component is ever genuinely required, it is a **new fingerprint
version**, with both the old and the new computed and compared during the
transition — never a redefinition of the old one.

## Instancia — the case that settled it

`instancia` (and `despacho`, `radicado_23`, `radicado_base_21`) arrive from GCP
on `/historico`. They are **store-and-display only**:

- nullable columns, mapper carries them verbatim
- they do NOT participate in the publicaciones or acts fingerprint
- a second-instance projection keyed on `instancia` is a later, separate,
  read-only change over the stored value

## Related: no silent discards

A row that cannot be parsed is emitted and recorded with a reason
(`FECHA_NO_PARSEABLE`, `FECHA_AUSENTE`), never dropped with a bare `continue`,
and nothing is truncated before it is parsed.
