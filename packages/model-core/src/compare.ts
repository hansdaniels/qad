import type { ArticleCatalog } from './article-catalog.js';
import { billOfMaterials, type BillLine } from './bill-of-materials.js';
import type { PartCatalog, PartType } from './catalog.js';
import type { ConstructionSnapshot } from './core.js';
import type { Pose } from './geometry.js';
import type { PartId, PartTypeId } from './ids.js';
import { transformPoint, vec } from './math.js';

/** What happens to a physical part between two states of a model. */
export type ChangeKind = 'kept' | 'added' | 'removed' | 'swapped' | 'moved';

export interface PartState {
  readonly partId: PartId;
  readonly typeId: PartTypeId;
  readonly worldPose: Pose;
}

/** One part, or one place, compared between before and after. */
export interface PartChange {
  readonly kind: ChangeKind;
  /** Missing for added parts. */
  readonly before?: PartState;
  /** Missing for removed parts. */
  readonly after?: PartState;
}

/** Article count that differs: positive means more is needed after, negative that some is left over. */
export interface BillDifference {
  readonly line: BillLine;
  readonly difference: number;
}

export interface Comparison {
  readonly changes: readonly PartChange[];
  readonly bill: readonly BillDifference[];
}

/**
 * Compares two states of a model by what stands where, so the two may come from
 * separate files: the same article at the same place is kept, another type of the
 * same kind at the same place is swapped, e.g. a connector with more arms.
 * Parts found in both under the same ID but elsewhere moved, e.g. with a moved
 * assembly; everything else is added or removed.
 */
export function compareConstructions(
  before: ConstructionSnapshot,
  after: ConstructionSnapshot,
  catalog: PartCatalog,
  articles: ArticleCatalog,
): Comparison {
  const types = new Map(catalog.partTypes.map((t) => [t.id, t]));
  const states = (s: ConstructionSnapshot) => {
    const poses = new Map(s.realization.poses.map((p) => [p.partId, p.worldPose]));
    return s.realization.parts.flatMap((p) => {
      const worldPose = poses.get(p.id);
      return worldPose ? [{ partId: p.id, typeId: p.typeId, worldPose }] : [];
    });
  };
  const place = (state: PartState) => placeKey(state, types.get(state.typeId));
  // A bent half plate is still the same article.
  const entry = (state: PartState) => types.get(state.typeId)?.entryId ?? state.typeId;
  const old = states(before);
  const now = states(after);
  const changes: PartChange[] = [];

  // Same place and type: kept. Same place, other type of the same kind: swapped.
  const byPlace = new Map<string, PartState[]>();
  for (const s of old) byPlace.set(place(s), [...(byPlace.get(place(s)) ?? []), s]);
  const unmatched: PartState[] = [];
  for (const s of now) {
    const candidates = byPlace.get(place(s)) ?? [];
    const same = candidates.findIndex((c) => entry(c) === entry(s));
    const index = same >= 0 ? same : candidates.length > 0 ? 0 : -1;
    if (index < 0) {
      unmatched.push(s);
      continue;
    }
    const [match] = candidates.splice(index, 1);
    changes.push({ kind: entry(match!) === entry(s) ? 'kept' : 'swapped', before: match!, after: s });
  }
  // The same part elsewhere: moved.
  const left = new Map([...byPlace.values()].flat().map((s) => [s.partId, s]));
  for (const s of unmatched) {
    const match = left.get(s.partId);
    if (match && entry(match) === entry(s)) {
      left.delete(s.partId);
      changes.push({ kind: 'moved', before: match, after: s });
    } else changes.push({ kind: 'added', after: s });
  }
  for (const s of left.values()) changes.push({ kind: 'removed', before: s });

  const count = (s: ConstructionSnapshot) => billOfMaterials(s, articles, catalog);
  const was = new Map(count(before).map((l) => [l.key, l]));
  const bill: BillDifference[] = [];
  for (const line of count(after)) {
    const difference = line.quantity - (was.get(line.key)?.quantity ?? 0);
    was.delete(line.key);
    if (difference !== 0) bill.push({ line, difference });
  }
  for (const line of was.values()) bill.push({ line, difference: -line.quantity });
  return { changes, bill };
}

/**
 * Where a part stands, independent of IDs and of turning a tube about its own
 * axis: its kind and a few points of it in world coordinates.
 */
function placeKey(state: PartState, type: PartType | undefined): string {
  const local =
    type?.kind === 'tube'
      ? type.sites.filter((s) => s.role === 'tube-end').map((s) => s.frame.position)
      : type?.kind === 'plate' || type?.kind === 'slide'
        ? [vec(0, 0, 0), vec(100, 0, 0), vec(0, 0, 100)]
        : [vec(0, 0, 0)];
  const points = local
    .map((p) => transformPoint(state.worldPose, p))
    // Grid places are multiples of 5 mm; rounding to them absorbs computing noise.
    .map((p) => [p.x, p.y, p.z].map((v) => Math.round(v / 5) * 5 + 0).join(','))
    .sort();
  return `${type?.kind ?? state.typeId}|${points.join('|')}`;
}
