import type { FamilyId } from '@qad/model-core';

/** Which parts the palette offers: the common ones, or every part the editor can place. */
export type Assortment = 'common' | 'all';

export const ASSORTMENTS: readonly { readonly id: Assortment; readonly name: string }[] = [
  { id: 'common', name: 'Gängige' },
  { id: 'all', name: 'Alle' },
];

/** Families that are rarely used, after the client's account; hidden unless all parts are shown. */
const UNCOMMON: ReadonlySet<FamilyId> = new Set([
  'tube-10cm',
  'tube-20cm',
  'tube-25cm',
  'tube-52cm',
  'panel-30-30cm',
  'hole-panel-40-40cm',
]);

export function inAssortment(familyId: FamilyId, assortment: Assortment): boolean {
  return assortment === 'all' || !UNCOMMON.has(familyId);
}
