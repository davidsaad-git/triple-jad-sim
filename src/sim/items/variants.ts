import { HL_VARIANT_BASE, QY_VARIANT_BASE } from '../data/generated/variants'

/** scim: ornament/charged variants -> base id. */
export function canonicalItemId(id: number): number {
  return HL_VARIANT_BASE[id] ?? id
}

/** scim: catalog variant -> base id. */
export function catalogBaseId(id: number): number {
  return QY_VARIANT_BASE[id] ?? id
}
