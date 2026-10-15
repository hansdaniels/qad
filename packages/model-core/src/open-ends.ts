import type { ConstructionDesign } from './design.js';
import type { JunctionId, TubeEndRef } from './ids.js';

/** A tube end whose junction has no other tube end; the editor highlights it. */
export interface OpenEnd extends TubeEndRef {
  readonly junctionId: JunctionId;
}

/**
 * Tube ends without a counterpart. Connectors derive their arms from the tubes
 * attached (auto connector), so free connector arms do not occur; only tube ends
 * can be open. A connector fixed explicitly (later, SPEC 9) may add free arms. Not a buildability finding: intermediate states may be open.
 * Ordered by tube ID, then end a before b. The highlight position is the
 * junction's entry in Realization.intentPoses.
 */
export function findOpenEnds(design: ConstructionDesign): OpenEnd[] {
  const endsPerJunction = new Map<JunctionId, number>();
  for (const tube of design.tubes) {
    for (const endpoint of [tube.a, tube.b]) {
      endsPerJunction.set(endpoint.junctionId, (endsPerJunction.get(endpoint.junctionId) ?? 0) + 1);
    }
  }
  const open: OpenEnd[] = [];
  for (const tube of [...design.tubes].sort((x, y) => compare(x.id, y.id))) {
    for (const end of ['a', 'b'] as const) {
      const junctionId = tube[end].junctionId;
      if (endsPerJunction.get(junctionId) === 1) open.push({ tubeId: tube.id, end, junctionId });
    }
  }
  return open;
}

function compare(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}
