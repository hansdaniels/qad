import { quadroArticleCatalog, type ColourId, type FamilyId } from '@qad/model-core';

/** Display colours for the catalog's colour keys; approximations, not manufacturer values. */
const COLOURS: Readonly<Record<ColourId, string>> = {
  blue: '#1f5fbf',
  green: '#2e8b3d',
  yellow: '#f2c200',
  red: '#d22b2b',
  'pearl-white': '#efece4',
  'dark-grey': '#4a4d52',
  'dove-blue': '#8fa8c8',
  'moody-blue': '#3d4f7a',
  'may-green': '#9bc46a',
  'emerald-green': '#1f7a5c',
  'bunnys-nose': '#e8a0a8',
  'tawny-port': '#7a2e3a',
  black: '#262626',
  white: '#f5f5f5',
  transparent: '#cfe8ff',
  metallic: '#a8acb0',
};

/** Which tube colours the editor offers: the four classic ones, the newer ones, or all. */
export type ColourRange = 'both' | 'classic' | 'modern';

export const COLOUR_RANGES: readonly { readonly id: ColourRange; readonly name: string }[] = [
  { id: 'both', name: 'Klassisch und Modern' },
  { id: 'classic', name: 'Klassisch' },
  { id: 'modern', name: 'Modern' },
];

const CLASSIC: ReadonlySet<ColourId> = new Set(['red', 'green', 'blue', 'yellow']);

export function inRange(colour: ColourId, range: ColourRange): boolean {
  return range === 'both' || CLASSIC.has(colour) === (range === 'classic');
}

export interface ColourOption {
  readonly id: ColourId;
  readonly name: string;
}

const NAMES = new Map(quadroArticleCatalog.colours.map((c) => [c.id, c.name]));

export const colourName = (colour: ColourId | undefined): string => (colour && NAMES.get(colour)) ?? colour ?? '–';

/** Article entry standing for a family: a tube's standard variant, the plate or the slide. */
function familyEntry(familyId: FamilyId) {
  return quadroArticleCatalog.entries.find(
    (e) =>
      e.familyId === familyId &&
      ((e.category === 'tube' && e.drilling.kind === 'standard') || e.category === 'plate' || e.category === 'slide'),
  );
}

/** Colours a tube, plate or slide family comes in, within the range. */
export function familyColours(familyId: FamilyId, range: ColourRange): ColourOption[] {
  return (familyEntry(familyId)?.articles ?? [])
    .filter((a) => inRange(a.colour, range))
    .map((a) => ({ id: a.colour, name: colourName(a.colour) }));
}

/** The colour itself if the family offers it within the range, else the default or the first offered. */
export function fitColour(familyId: FamilyId, colour: ColourId, range: ColourRange): ColourId {
  const offered = familyColours(familyId, range).map((c) => c.id);
  const category = familyEntry(familyId)?.category;
  const fallback = (category && quadroArticleCatalog.defaultColours[category]) ?? 'red';
  return offered.includes(colour) ? colour : offered.includes(fallback) ? fallback : (offered[0] ?? colour);
}

export function displayColour(colour: ColourId | undefined): string {
  return (colour && COLOURS[colour]) ?? '#888888';
}
