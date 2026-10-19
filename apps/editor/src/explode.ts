import { math, quadroDisplayGeometry, type DisplayShape, type PartType, type Vector3 } from '@qad/model-core';

/** Scaling of a part about a point in its own frame, for the exploded view. */
export interface Shrink {
  readonly origin: Vector3;
  readonly scale: readonly [number, number, number];
}

/** How a part is drawn in the exploded view. */
export interface Exploded {
  readonly shapes: readonly DisplayShape[];
  readonly shrink?: Shrink;
  /** Drawn in this colour with a contour instead of the part's own, like a technical drawing. */
  readonly drawing?: { readonly colour: string; readonly outline: string; readonly lineMm: number };
}

/**
 * Schematic sizes: clear to read rather than true to size. Tubes end well short
 * of the connectors (an arm reaches 50 mm into a tube), so the arms show.
 */
const SCHEMATIC = { tubeGap: 70, tubeRadius: 9, armRadius: 6, armReach: 55, coreRadius: 15, plateGap: 60 };
/** Connectors white with black lines, so they stand out against coloured tubes. */
const DRAWING = { colour: '#ffffff', outline: '#1d1d1d', lineMm: 3 };

/** A small ball as hull points; one array, so all connector cores share one geometry. */
const CORE: readonly Vector3[] = [
  math.vec(0, 0, SCHEMATIC.coreRadius),
  math.vec(0, 0, -SCHEMATIC.coreRadius),
  ...Array.from({ length: 7 * 16 }, (_, k) => {
    const polar = (Math.PI * (Math.floor(k / 16) + 1)) / 8;
    const azimuth = (2 * Math.PI * (k % 16)) / 16;
    return math.scale(
      math.vec(Math.sin(polar) * Math.cos(azimuth), Math.sin(polar) * Math.sin(azimuth), Math.cos(polar)),
      SCHEMATIC.coreRadius,
    );
  }),
];

const rod = (a: Vector3, b: Vector3, radiusMm: number): DisplayShape => ({
  kind: 'pipe',
  a,
  b,
  radiusMm,
  innerRadiusMm: 0,
});

const cache = new Map<string, Exploded | undefined>();

/**
 * The exploded view of a part type, or undefined to draw it as usual: tubes as
 * thin rods ending short of the connectors, connectors as a small core with all
 * their arms, angle connectors as thin rods, both white with black lines, plates
 * shrunk in their plane.
 */
export function explodedOf(type: PartType | undefined, shapes: readonly DisplayShape[]): Exploded | undefined {
  if (!type) return undefined;
  if (!cache.has(type.id)) cache.set(type.id, schematic(type, shapes));
  return cache.get(type.id);
}

function schematic(type: PartType, shapes: readonly DisplayShape[]): Exploded | undefined {
  const { tubeGap, tubeRadius, armRadius, armReach, plateGap } = SCHEMATIC;
  if (type.kind === 'tube' && type.shape === 'straight') {
    const length = type.centerlineLengthMm;
    // Short tubes keep at least 40 % of their length.
    const gap = Math.min(tubeGap, 0.3 * length);
    return { shapes: [rod(math.vec(gap, 0, 0), math.vec(length - gap, 0, 0), tubeRadius)] };
  }
  if (type.kind === 'tube') {
    // Straight ends shorter than the gap go; the rest of the gap comes off the arc.
    const ends = shapes.filter((s) => s.kind === 'pipe');
    const straight = ends.length > 0 ? Math.min(...ends.map((p) => math.length(math.sub(p.b, p.a)))) : 0;
    return {
      shapes: shapes.flatMap((s): DisplayShape[] => {
        if (s.kind !== 'arc') return [];
        const trim = Math.max(0, tubeGap - straight) / s.radiusMm;
        return [{ ...s, tubeRadiusMm: tubeRadius, startRad: s.startRad + trim, endRad: s.endRad - trim }];
      }),
    };
  }
  if (type.kind === 'plate') {
    const [x, y] = type.cellMm;
    return {
      shapes,
      shrink: { origin: math.vec(0, 0, 0), scale: [(x - 2 * plateGap) / x, (y - 2 * plateGap) / y, 1] },
    };
  }
  const arms = (quadroDisplayGeometry.inserted?.(type.geometry.display) ?? []).flatMap((s) =>
    s.kind === 'pipe' ? [s] : [],
  );
  if (type.kind === 'connector') {
    // Arms shorter than real, from the middle, pointing where the tubes go.
    const reach = (b: Vector3) => math.scale(b, armReach / math.length(b));
    return {
      shapes: [{ kind: 'convex', points: CORE }, ...arms.map((a) => rod(math.vec(0, 0, 0), reach(a.b), armRadius))],
      drawing: DRAWING,
    };
  }
  if (type.kind === 'adapter') {
    const body = shapes.flatMap((s) => (s.kind === 'pipe' ? [rod(s.a, s.b, armRadius + 2)] : []));
    return { shapes: [...body, ...arms.map((a) => rod(a.a, a.b, armRadius))], drawing: DRAWING };
  }
  return undefined;
}
