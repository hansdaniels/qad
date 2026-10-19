import type { CollisionGeometryProvider, CollisionShape } from './buildability.js';
import type { ConnectionEvaluator } from './core.js';
import type {
  AccessoryType,
  AttachmentSite,
  ConnectionType,
  DisplayGeometryProvider,
  DisplayShape,
  PartCatalog,
  NurbsShape,
  PartType,
  PlateEdge,
  PlateType,
  SlideType,
  TubeHole,
  TubeType,
} from './catalog.js';
import type { Pose, Quaternion, Vector3 } from './geometry.js';
import type {
  ConnectorArticle,
  GridDirection,
  PlateArticle,
  SlideArticle,
  TubeArticle,
  TubeDrilling,
} from './article-catalog.js';
import { add, qaxisAngle, qmul, rotate, scale, vec } from './math.js';
import { nurbsPoint, nurbsRange } from './nurbs.js';
import { quadroArticleCatalog } from './quadro-articles.js';
import { CURVED_SLIDE_SURFACE, MODULAR_SLIDE_SURFACE, RUNOUT_SURFACE } from './quadro-slide-surfaces.js';

/**
 * Provisional QUADRO geometry from the 2006 design program (GEOMETRIE.md).
 * Not measured on parts. Tube holes and plate flanges follow the information in
 * GEOMETRIE.md, section 5; the drilling of special tubes is a hypothesis.
 * Part type IDs equal the article catalog IDs, except for half plate variants (entryId).
 */

const ARM_SHOULDER = 25;
const TUBE_RADIUS = 25;
const ROLL_STEPS = [0, 0.5, 1, 1.5].map((f) => f * Math.PI);

const ARM = 'quadro-arm';
const TUBE_END = 'quadro-tube-end';
const TUBE_HOLE = 'quadro-tube-hole';
const PLATE_MOUNT = 'quadro-plate-mount';
const TUBE_MIDDLE = 'quadro-tube-middle';
const SLIDE_HANG = 'quadro-slide-hang';

/** Hole centre from the tube end face (GEOMETRIE.md, section 5). */
const HOLE_FROM_END = 25;
/** Plate: underside and flange faces 25.12 from the tube axes, flanges down to z = -22, 3 thick. */
const PLATE = { lift: 25.12, flangeDepth: 22, thickness: 3 };
/**
 * Hole panel: 3 × 3 round holes in a square grid. Pitch and diameter are read off
 * the manufacturer's product picture against the plate width, not measured.
 */
const PERFORATION = { grid: 3, pitch: 107, diameter: 57 };
/** Segments of the rounded corner notches of plates, for display. */
const NOTCH_STEPS = 8;
/**
 * Modular slide body: hangs on a 35 cm tube and drops two storeys over three
 * grid cells to a parallel tube (client's account); its surface is estimated
 * from the runout's profile (quadro-slide-surfaces.ts).
 */
const SLIDE = { run: 1200, drop: 800 };
/**
 * Curved slide body (GEOMETRIE.md, section 7): it turns left by 90° and rests on
 * a tube across its own, 600 ahead, 600 to the left and 800 down, where the runout
 * hangs on. The program draws two plate screws at the top and two slide screws at
 * that end, as in the manufacturer's screw set for it.
 */
const CURVED = { lowerEnd: vec(600, 600, -800) };

const X = vec(1, 0, 0);
const Y = vec(0, 1, 0);
const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Site orientation with +Z along the direction. Opposite directions differ by a
 * half turn about local y, so a straight chain arm–tube–arm arrives untwisted.
 */
const Z_TO: Readonly<Record<GridDirection, Quaternion>> = {
  '+x': qaxisAngle(Y, Math.PI / 2),
  '-x': qaxisAngle(Y, -Math.PI / 2),
  '+y': qaxisAngle(X, -Math.PI / 2),
  '-y': qmul(qaxisAngle(X, -Math.PI / 2), qaxisAngle(Y, Math.PI)),
  '+z': IDENTITY,
  '-z': qaxisAngle(Y, Math.PI),
};
const UNIT: Readonly<Record<GridDirection, Vector3>> = {
  '+x': vec(1, 0, 0),
  '-x': vec(-1, 0, 0),
  '+y': vec(0, 1, 0),
  '-y': vec(0, -1, 0),
  '+z': vec(0, 0, 1),
  '-z': vec(0, 0, -1),
};

const site = (id: string, role: AttachmentSite['role'], frame: Pose, interfaceId: string): AttachmentSite => ({
  id,
  role,
  frame,
  interfaceId,
  capacity: 1,
});

function connectorType(article: ConnectorArticle): AccessoryType {
  return {
    kind: 'connector',
    id: article.id,
    familyId: article.familyId,
    name: article.name,
    geometry: { display: { key: article.id }, collision: { key: 'quadro-connector-body' } },
    sites: (article.armDirections ?? []).map((d) =>
      site(d, 'socket', { position: scale(UNIT[d], ARM_SHOULDER), orientation: Z_TO[d] }, ARM),
    ),
  };
}

/** Straight tube: origin at the end a face, +x along the tube. */
function straightTube(article: TubeArticle): TubeType {
  const length = (article.nominalLengthCm ?? 0) * 10;
  const drilled = drilledHoles(article.drilling, length);
  return {
    kind: 'tube',
    id: article.id,
    familyId: article.familyId,
    name: article.name,
    geometry: { display: { key: article.id }, collision: { key: `quadro-tube-${length}` } },
    sites: [
      site('a', 'tube-end', { position: vec(0, 0, 0), orientation: Z_TO['-x'] }, TUBE_END),
      site('b', 'tube-end', { position: vec(length, 0, 0), orientation: Z_TO['+x'] }, TUBE_END),
      // A slide hangs here; a tube can carry one on either side.
      {
        ...site('middle', 'hang', { position: vec(length / 2, 0, 0), orientation: Z_TO['+x'] }, TUBE_MIDDLE),
        capacity: 2,
      },
      ...drilled.sites,
    ],
    shape: 'straight',
    nominalLengthMm: length,
    centerlineLengthMm: length,
    ends: { a: 'a', b: 'b' },
    holes: drilled.holes,
    standardVariant: article.drilling.kind === 'standard',
  };
}

/**
 * Holes per end as angles about the tube axis, measured from local +z (HERSTELLERREGELN.md,
 * section 4, hypothesis): standard one per end on the same side; 180° a through hole;
 * 90° two at right angles; 135° two at end a, one at end b.
 */
function holeAngles(drilling: TubeDrilling): { a: number[]; b: number[] } {
  if (drilling.kind === 'standard') return { a: [0], b: [0] };
  const second = (drilling.designationDeg * Math.PI) / 180;
  return drilling.holes === 3 ? { a: [0, second], b: [0] } : { a: [0, second], b: [0, second] };
}

/** Hole sites on the axis at the hole's station; +Z points radially out through the hole. */
function drilledHoles(drilling: TubeDrilling, length: number): { sites: AttachmentSite[]; holes: TubeHole[] } {
  const sites: AttachmentSite[] = [];
  const holes: TubeHole[] = [];
  const angles = holeAngles(drilling);
  for (const [end, station] of [
    ['a', HOLE_FROM_END],
    ['b', length - HOLE_FROM_END],
  ] as const) {
    for (const angle of angles[end]) {
      const id = `hole-${end}-${Math.round((angle * 180) / Math.PI)}`;
      sites.push(site(id, 'hole', { position: vec(station, 0, 0), orientation: qaxisAngle(X, angle) }, TUBE_HOLE));
      holes.push({ siteId: id, stationMm: station });
    }
  }
  return { sites, holes };
}

/**
 * Plate in its grid cell: origin between the four junctions, z = 0 in the plane of
 * the tube axes, the plate above. Flanges run along x on the tubes at y = ±y/2 and
 * hold two screws each, 50 from the junction centres (GEOMETRIE.md, section 5).
 * Mount sites sit on those tube axes, +Z towards the tube.
 *
 * Half plates have their flanges on the long or on the short sides (client's
 * account). With flanges on the short sides, the tab at a flange end can be bent
 * by 90° where a level plate meets the upright half plate (HERSTELLERREGELN 1);
 * those variants share the article and the mounts.
 */
function plateTypes(article: PlateArticle): PlateType[] {
  if (!article.tubeGridCm) return [];
  const [x, y] = article.tubeGridCm.map((cm) => cm * 10 + 2 * ARM_SHOULDER) as [number, number];
  const flat = plateType(article, article.id, [x, y], []);
  if (x === y) return [flat];
  const across = plateType(article, `${article.id}/short`, [y, x], []);
  const bent: (readonly PlateEdge[])[] = [['-x'], ['+x'], ['-x', '+x']];
  return [
    flat,
    across,
    ...bent.map((edges) => ({
      ...plateType(article, `${across.id}/fold${edges.join('')}`, [y, x], edges),
      folded: { base: across.id, edges },
    })),
  ];
}

function plateType(
  article: PlateArticle,
  id: string,
  [x, y]: readonly [number, number],
  edges: readonly PlateEdge[],
): PlateType {
  const reach = x / 2 - ARM_SHOULDER - HOLE_FROM_END;
  const sites: AttachmentSite[] = [];
  for (const sy of [1, -1]) {
    for (const sx of [1, -1]) {
      const siteId = `mount${sx > 0 ? '+' : '-'}x${sy > 0 ? '+' : '-'}y`;
      const toward = qaxisAngle(X, sy > 0 ? -Math.PI / 2 : Math.PI / 2);
      sites.push(
        site(siteId, 'mount', { position: vec(sx * reach, (sy * y) / 2, 0), orientation: toward }, PLATE_MOUNT),
      );
    }
  }
  const across = x < y ? ', Flansche an den kurzen Seiten' : '';
  const bent = edges.length === 0 ? '' : edges.length === 1 ? ', eine Lasche geknickt' : ', beide Laschen geknickt';
  return {
    kind: 'plate',
    id,
    familyId: article.familyId,
    name: `${article.name}${across}${bent}`,
    ...(id === article.id ? {} : { entryId: article.id }),
    geometry: {
      display: { key: id },
      collision: { key: `quadro-plate-${x}x${y}${edges.length > 0 ? `-fold${edges.join('')}` : ''}` },
    },
    sites,
    cellMm: [x, y],
    requiredMounts: sites.map((s) => s.id),
  };
}

/** Quarter bend: 50 straight, radius 325, 50 straight; end b face at (375, 375). */
const BEND = { straight: 50, radius: 325 };
function curvedTube(article: TubeArticle): TubeType {
  const reach = BEND.straight + BEND.radius;
  return {
    kind: 'tube',
    id: article.id,
    familyId: article.familyId,
    name: article.name,
    geometry: { display: { key: article.id }, collision: { key: 'quadro-curved-tube' } },
    sites: [
      site('a', 'tube-end', { position: vec(0, 0, 0), orientation: Z_TO['-x'] }, TUBE_END),
      site('b', 'tube-end', { position: vec(reach, reach, 0), orientation: Z_TO['+y'] }, TUBE_END),
    ],
    shape: 'bent',
    nominalLengthMm: 0,
    centerlineLengthMm: 2 * BEND.straight + (Math.PI / 2) * BEND.radius,
    ends: { a: 'a', b: 'b' },
    holes: [],
    standardVariant: article.drilling.kind === 'standard',
  };
}

/**
 * Angle connector 45°. Frame: origin at the sleeve's open face on the arm
 * shoulder, +x along the arm. The sleeve takes an arm like a tube end; the
 * spigot is an arm of a virtual connector 36 behind the axis crossing at 108.3
 * from the connector centre (GEOMETRIE.md, section 3).
 */
const ANGLE = { crossing: 108.3, virtual: 36, sleeve: 70 };
const SPIGOT_DIRECTION = vec(-Math.SQRT1_2, Math.SQRT1_2, 0);
const VIRTUAL_CENTRE = add(vec(ANGLE.crossing - ARM_SHOULDER, 0, 0), scale(SPIGOT_DIRECTION, ANGLE.virtual));
const SPIGOT_SHOULDER = add(VIRTUAL_CENTRE, scale(SPIGOT_DIRECTION, ARM_SHOULDER));

function angleConnector(article: ConnectorArticle): AccessoryType {
  // +Z along the spigot: turn +Z onto +x, then 135° about z.
  const spigot = qmul(qaxisAngle(vec(0, 0, 1), (3 * Math.PI) / 4), Z_TO['+x']);
  return {
    kind: 'adapter',
    id: article.id,
    familyId: article.familyId,
    name: article.name,
    geometry: { display: { key: article.id }, collision: { key: 'quadro-angle-connector' } },
    sites: [
      site('sleeve', 'tube-end', { position: vec(0, 0, 0), orientation: Z_TO['-x'] }, TUBE_END),
      site('spigot', 'socket', { position: SPIGOT_SHOULDER, orientation: spigot }, ARM),
    ],
  };
}

function partTypes(): PartType[] {
  const types: PartType[] = [];
  for (const entry of quadroArticleCatalog.entries) {
    if (entry.category === 'connector' && entry.armDirections) types.push(connectorType(entry));
    else if (entry.category === 'connector' && entry.connector === 'angle') types.push(angleConnector(entry));
    else if (entry.category === 'tube' && entry.shape === 'straight') types.push(straightTube(entry));
    else if (entry.category === 'tube' && entry.shape === 'bent') types.push(curvedTube(entry));
    else if (entry.category === 'plate' && (entry.plate === 'solid' || entry.plate === 'perforated')) {
      types.push(...plateTypes(entry));
    } else if (entry.category === 'slide') types.push(slideType(entry));
  }
  return types;
}

/** Tube end on an arm: end face on the shoulder, turned in 90° steps (provisional). */
const ARM_TUBE: ConnectionType = {
  id: 'quadro-arm-tube',
  aInterfaceId: ARM,
  bInterfaceId: TUBE_END,
  kinematics: {
    kind: 'parametric',
    evaluatorKey: 'quadro-arm-tube',
    parameters: [{ name: 'rollRad', unit: 'radian', domain: { kind: 'discrete', values: ROLL_STEPS } }],
  },
};

/**
 * Plate screw through a flange into a tube hole: the mount faces the hole and lies
 * along the tube one way or the other.
 */
const TUBE_PLATE: ConnectionType = {
  id: 'quadro-tube-plate',
  aInterfaceId: TUBE_HOLE,
  bInterfaceId: PLATE_MOUNT,
  kinematics: {
    kind: 'parametric',
    evaluatorKey: 'quadro-tube-plate',
    parameters: [{ name: 'turnRad', unit: 'radian', domain: { kind: 'discrete', values: [0, Math.PI] } }],
  },
};

/**
 * Slide on the middle of a tube: its hang site lies along the tube one way or the
 * other, turned about the tube axis in 90° steps.
 */
const TUBE_SLIDE: ConnectionType = {
  id: 'quadro-tube-slide',
  aInterfaceId: TUBE_MIDDLE,
  bInterfaceId: SLIDE_HANG,
  kinematics: {
    kind: 'parametric',
    evaluatorKey: 'quadro-tube-slide',
    parameters: [
      { name: 'turnRad', unit: 'radian', domain: { kind: 'discrete', values: ROLL_STEPS } },
      { name: 'flipRad', unit: 'radian', domain: { kind: 'discrete', values: [0, Math.PI] } },
    ],
  },
};

export const quadroPartCatalog: PartCatalog = {
  ref: { id: 'quadro-provisional', version: '2006-1' },
  partTypes: partTypes(),
  connectionTypes: [ARM_TUBE, TUBE_PLATE, TUBE_SLIDE],
};

/** Site b faces site a (half turn about x), then turns by rollRad about its axis. */
export const quadroConnectionEvaluators: Readonly<Record<string, ConnectionEvaluator>> = {
  'quadro-arm-tube': (parameters) => ({
    position: vec(0, 0, 0),
    orientation: qmul(qaxisAngle(X, Math.PI), qaxisAngle(vec(0, 0, 1), parameters.rollRad ?? 0)),
  }),
  'quadro-tube-plate': (parameters) => ({
    position: vec(0, 0, 0),
    orientation: qmul(qaxisAngle(X, Math.PI), qaxisAngle(vec(0, 0, 1), parameters.turnRad ?? 0)),
  }),
  'quadro-tube-slide': (parameters) => ({
    position: vec(0, 0, 0),
    orientation: qmul(qaxisAngle(vec(0, 0, 1), parameters.turnRad ?? 0), qaxisAngle(Y, parameters.flipRad ?? 0)),
  }),
};

/** Slide body or runout; its hang site has +Z along the tube it hangs on. */
function slideType(article: SlideArticle): SlideType {
  const shape = article.slide === 'modular-body' ? 'body' : article.slide === 'curved-body' ? 'curved' : 'runout';
  const lowerEnd =
    shape === 'body'
      ? { point: vec(SLIDE.run, 0, -SLIDE.drop), tubeAxis: Y, onward: X, screws: { plate: 1, joint: 1 } }
      : shape === 'curved'
        ? { point: CURVED.lowerEnd, tubeAxis: X, onward: Y, screws: { plate: 2, joint: 2 } }
        : undefined;
  return {
    kind: 'slide',
    id: article.id,
    familyId: article.familyId,
    name: article.name,
    geometry: { display: { key: article.id }, collision: { key: `quadro-slide-${shape}` } },
    sites: [site('hang', 'hang', { position: vec(0, 0, 0), orientation: Z_TO['+y'] }, SLIDE_HANG)],
    shape,
    tubeLengthMm: 350,
    ...(lowerEnd ? { lowerEnd } : {}),
  };
}

/**
 * Collision shapes of a moulded slide: hulls between rows of surface points
 * along u, from where it leaves the tube it hooks over to where it meets the next
 * one, so the hooks themselves do not count against those tubes.
 */
function surfaceHulls(surface: NurbsShape, from: number, to: number, steps: number): CollisionShape[] {
  const [v0, v1] = nurbsRange(surface.knotsV, surface.degreeV);
  const row = (u: number) => Array.from({ length: 17 }, (_, j) => nurbsPoint(surface, u, v0 + ((v1 - v0) * j) / 16));
  const rows = Array.from({ length: steps + 1 }, (_, i) => row(from + ((to - from) * i) / steps));
  return rows.slice(1).map((r, i) => ({ kind: 'convex', points: [...rows[i]!, ...r] }));
}

const slideHulls = new Map<string, CollisionShape[]>();
/** Hulls of the curved body and the runout, computed once. */
function mouldedShapes(key: 'body' | 'curved' | 'runout'): CollisionShape[] {
  if (!slideHulls.has(key))
    slideHulls.set(
      key,
      key === 'body'
        ? // From 30 in front of the tube on, as with the curved body: the walls reach round the posts there.
          surfaceHulls(MODULAR_SLIDE_SURFACE, 1.15, 5, 16)
        : key === 'curved'
          ? surfaceHulls(CURVED_SLIDE_SURFACE, 1, 3, 12)
          : surfaceHulls(RUNOUT_SURFACE, 1.08, 1.92, 4),
    );
  return slideHulls.get(key)!;
}

function arcCapsules(): CollisionShape[] {
  const shapes: CollisionShape[] = [];
  const centre = vec(BEND.straight, BEND.radius, 0);
  const point = (angle: number) => add(centre, vec(BEND.radius * Math.sin(angle), -BEND.radius * Math.cos(angle), 0));
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * (Math.PI / 2);
    const a1 = ((i + 1) / steps) * (Math.PI / 2);
    shapes.push({ kind: 'capsule', a: point(a0), b: point(a1), radiusMm: TUBE_RADIUS });
  }
  const reach = BEND.straight + BEND.radius;
  shapes.push({ kind: 'capsule', a: vec(TUBE_RADIUS, 0, 0), b: vec(BEND.straight, 0, 0), radiusMm: TUBE_RADIUS });
  shapes.push({
    kind: 'capsule',
    a: vec(reach, BEND.radius, 0),
    b: vec(reach, reach - TUBE_RADIUS, 0),
    radiusMm: TUBE_RADIUS,
  });
  return shapes;
}

/** Polygonal cylinder: 12 points per end on the circle of the given radius. */
function cylinderPoints(a: Vector3, b: Vector3, radius: number): Vector3[] {
  const axis = vec(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = Math.hypot(axis.x, axis.y, axis.z);
  const u = vec(0, 0, 1);
  const w = vec(axis.y * u.z - axis.z * u.y, axis.z * u.x - axis.x * u.z, axis.x * u.y - axis.y * u.x);
  const wl = Math.hypot(w.x, w.y, w.z) || 1;
  const n1 = scale(w, 1 / wl);
  const n2 = scale(
    vec(axis.y * n1.z - axis.z * n1.y, axis.z * n1.x - axis.x * n1.z, axis.x * n1.y - axis.y * n1.x),
    1 / len,
  );
  const points: Vector3[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    const offset = add(scale(n1, Math.cos(angle) * radius), scale(n2, Math.sin(angle) * radius));
    points.push(add(a, offset), add(b, offset));
  }
  return points;
}

/** Outer hulls only: inserted arms and spigots are not part of the collision shape. */
export const quadroCollisionGeometry: CollisionGeometryProvider = {
  shapes(ref) {
    if (ref.key === 'quadro-connector-body') {
      return [{ kind: 'box', center: vec(0, 0, 0), halfExtents: vec(ARM_SHOULDER, ARM_SHOULDER, ARM_SHOULDER) }];
    }
    if (ref.key === 'quadro-curved-tube') return arcCapsules();
    if (ref.key === 'quadro-angle-connector') {
      // Body: cylinder Ø 50 along the spigot axis from the sleeve end (x = 70) to
      // the shoulder. Only 42 long, so a capsule would reach into the tube.
      const crossing = vec(ANGLE.crossing - ARM_SHOULDER, 0, 0);
      const from = add(
        crossing,
        scale(SPIGOT_DIRECTION, (ANGLE.crossing - ARM_SHOULDER - ANGLE.sleeve) / Math.SQRT1_2),
      );
      return [
        { kind: 'capsule', a: vec(TUBE_RADIUS, 0, 0), b: vec(ANGLE.sleeve - TUBE_RADIUS, 0, 0), radiusMm: TUBE_RADIUS },
        { kind: 'convex', points: cylinderPoints(from, SPIGOT_SHOULDER, TUBE_RADIUS) },
      ];
    }
    const plate = /^quadro-plate-(\d+)x(\d+)(?:-fold((?:[-+]x)+))?$/.exec(ref.key);
    if (plate) {
      const [x, y] = [Number(plate[1]), Number(plate[2])];
      const edges = (plate[3]?.match(/[-+]x/g) ?? []) as PlateEdge[];
      const { lift, thickness } = PLATE;
      const [lo, hi] = plateEnds(x, edges);
      // Corners are cut out around the junctions, so upright tubes fit (GEOMETRIE.md,
      // section 5); two crossing boxes cover the rest.
      const z = lift + thickness / 2;
      const box = (from: number, to: number, halfY: number): CollisionShape => ({
        kind: 'box',
        center: vec((from + to) / 2, 0, z),
        halfExtents: vec((to - from) / 2, halfY, thickness / 2),
      });
      return [
        box(Math.max(lo, -x / 2 + lift), Math.min(hi, x / 2 - lift), y / 2),
        box(lo, hi, y / 2 - lift),
        ...plateFlanges(x, y),
        ...plateTabs(x, y, edges),
      ];
    }
    if (ref.key === 'quadro-slide-body') return mouldedShapes('body');
    if (ref.key === 'quadro-slide-curved') return mouldedShapes('curved');
    if (ref.key === 'quadro-slide-runout') return mouldedShapes('runout');
    const tube = /^quadro-tube-(\d+)$/.exec(ref.key);
    if (tube) {
      const length = Number(tube[1]);
      return [
        { kind: 'capsule', a: vec(TUBE_RADIUS, 0, 0), b: vec(length - TUBE_RADIUS, 0, 0), radiusMm: TUBE_RADIUS },
      ];
    }
    return undefined;
  },
};

/** Flanges along x on the tubes at y = ±y/2. */
function plateFlanges(x: number, y: number): CollisionShape[] {
  const { lift, flangeDepth, thickness } = PLATE;
  // Flanges end a plate thickness short of the crossing tubes, so an outward wall
  // plate clears a floor plate lying inside on the same tube (platform).
  return [1, -1].map((side) => ({
    kind: 'box',
    center: vec(0, side * (y / 2 - lift - thickness / 2), (lift - flangeDepth) / 2),
    halfExtents: vec(x / 2 - lift - thickness, thickness / 2, (lift + flangeDepth) / 2),
  }));
}

/**
 * Tab at a flange end, bent by 90° inwards: how far it reaches from the flange.
 * Read off the manufacturer's safety instructions (1.4), not measured.
 */
const TAB_LENGTH = 20;

/**
 * Plate x where the slab ends. At a bent edge the plate stands on the level plate
 * below, so it ends where the flanges end, on that plate's top.
 */
function plateEnds(x: number, edges: readonly PlateEdge[]): [number, number] {
  const cut = PLATE.lift + PLATE.thickness;
  return [edges.includes('-x') ? -x / 2 + cut : -x / 2, edges.includes('+x') ? x / 2 - cut : x / 2];
}

/** Bent tabs at the flange ends of the given edges: flat on the level plate, pointing inwards. */
function plateTabs(x: number, y: number, edges: readonly PlateEdge[]): CollisionShape[] {
  const { lift, flangeDepth, thickness } = PLATE;
  return edges.flatMap((edge) => {
    const sx = edge === '-x' ? -1 : 1;
    return [1, -1].map((sy) => ({
      kind: 'box' as const,
      center: vec(
        sx * (x / 2 - lift - (3 * thickness) / 2),
        sy * (y / 2 - lift - thickness - TAB_LENGTH / 2),
        (lift - flangeDepth) / 2,
      ),
      halfExtents: vec(thickness / 2, TAB_LENGTH / 2, (lift + flangeDepth) / 2),
    }));
  });
}

/**
 * Lines on the top face along both flanges, between the screws, like the marks
 * on the real plates (manufacturer's safety instructions 1.3): they show which
 * way a plate is screwed.
 */
function plateMarks(x: number, y: number): DisplayShape[] {
  const { lift, thickness } = PLATE;
  const reach = x / 2 - ARM_SHOULDER - HOLE_FROM_END;
  // Over the strip just inside the flange.
  const across = y / 2 - lift - thickness - MARK_INSET;
  return [1, -1].map((side) => ({
    kind: 'mark' as const,
    a: vec(-reach, side * across, lift + thickness),
    b: vec(reach, side * across, lift + thickness),
  }));
}

/** Distance of the flange marks from the inner face of the flange. */
const MARK_INSET = 15;

/**
 * Mark of a bent edge: a line across the whole plate along its straight end, on
 * the face side, so the bend shows from where one looks at the plate.
 */
function plateFolds(x: number, y: number, edges: readonly PlateEdge[]): DisplayShape[] {
  const { lift, thickness } = PLATE;
  const [lo, hi] = plateEnds(x, edges);
  return edges.map((edge) => {
    const fx = edge === '-x' ? lo : hi;
    return { kind: 'fold' as const, a: vec(fx, -y / 2, lift + thickness), b: vec(fx, y / 2, lift + thickness) };
  });
}

/**
 * Tube bore: the connector arm (Ø 41.7, GEOMETRIE.md, section 2) slides in, so
 * the tube is about 4 mm thick. Not measured.
 */
const TUBE_BORE_RADIUS = 21;

/** A straight tube from a to b, hollow. */
const pipe = (a: Vector3, b: Vector3): DisplayShape => ({
  kind: 'pipe',
  a,
  b,
  radiusMm: TUBE_RADIUS,
  innerRadiusMm: TUBE_BORE_RADIUS,
});

/** Display shapes of tubes and connectors; undefined for other parts. */
function tubeOrConnectorShapes(key: string): DisplayShape[] | undefined {
  const type = quadroPartCatalog.partTypes.find((t) => t.id === key);
  if (type?.kind === 'tube' && type.shape === 'straight')
    return [pipe(vec(0, 0, 0), vec(type.centerlineLengthMm, 0, 0))];
  if (type?.kind === 'tube') {
    const reach = BEND.straight + BEND.radius;
    return [
      pipe(vec(0, 0, 0), vec(BEND.straight, 0, 0)),
      {
        kind: 'arc',
        center: vec(BEND.straight, BEND.radius, 0),
        radiusMm: BEND.radius,
        tubeRadiusMm: TUBE_RADIUS,
        startRad: -Math.PI / 2,
        endRad: 0,
      },
      pipe(vec(reach, BEND.radius, 0), vec(reach, reach, 0)),
    ];
  }
  if (type?.kind === 'connector') {
    // Flush with the tubes and bulging outwards: the convex hull of a ball in the
    // middle and the tube-thick rim at the shoulder of every arm. Opposite arms
    // give a straight cylinder through.
    const points: Vector3[] = [vec(0, 0, TUBE_RADIUS), vec(0, 0, -TUBE_RADIUS)];
    for (let i = 1; i < 8; i++) {
      const polar = (Math.PI * i) / 8;
      for (let j = 0; j < 16; j++) {
        const azimuth = (2 * Math.PI * j) / 16;
        const unit = vec(Math.sin(polar) * Math.cos(azimuth), Math.sin(polar) * Math.sin(azimuth), Math.cos(polar));
        points.push(scale(unit, TUBE_RADIUS));
      }
    }
    for (const s of type.sites) {
      for (let j = 0; j < 32; j++) {
        const t = (2 * Math.PI * j) / 32;
        // The site's local x and y span the rim; its +Z points along the arm.
        const rim = vec(TUBE_RADIUS * Math.cos(t), TUBE_RADIUS * Math.sin(t), 0);
        points.push(add(s.frame.position, rotate(s.frame.orientation, rim)));
      }
    }
    return [{ kind: 'convex', points }];
  }
  if (type?.kind === 'adapter') {
    // Closed sleeve on the arm, then the body along the spigot axis up to its shoulder.
    const crossing = vec(ANGLE.crossing - ARM_SHOULDER, 0, 0);
    const from = add(crossing, scale(SPIGOT_DIRECTION, (ANGLE.crossing - ARM_SHOULDER - ANGLE.sleeve) / Math.SQRT1_2));
    return [
      { kind: 'pipe', a: vec(0, 0, 0), b: vec(ANGLE.sleeve, 0, 0), radiusMm: TUBE_RADIUS, innerRadiusMm: 0 },
      { kind: 'pipe', a: from, b: SPIGOT_SHOULDER, radiusMm: TUBE_RADIUS, innerRadiusMm: 0 },
    ];
  }
  return undefined;
}

/**
 * How parts look, where that differs from their collision shapes: tubes are
 * hollow, connectors flush with them and bulging outwards, plates one slab with cut-out corners, the hole
 * panel with its holes.
 */
export const quadroDisplayGeometry: DisplayGeometryProvider = {
  shapes(ref) {
    // The same shapes for every part of a type, so renderers can share what they build from them.
    if (!displayCache.has(ref.key)) displayCache.set(ref.key, displayShapes(ref.key));
    return displayCache.get(ref.key);
  },
};

const displayCache = new Map<string, readonly DisplayShape[] | undefined>();

function displayShapes(key: string): readonly DisplayShape[] | undefined {
  const own = tubeOrConnectorShapes(key);
  if (own) return own;
  const type = quadroPartCatalog.partTypes.find((t) => t.id === key);
  const article = quadroArticleCatalog.entries.find((e) => e.id === (type?.entryId ?? key));
  if (article?.category === 'slide')
    return [
      article.slide === 'modular-body'
        ? MODULAR_SLIDE_SURFACE
        : article.slide === 'curved-body'
          ? CURVED_SLIDE_SURFACE
          : RUNOUT_SURFACE,
    ];
  if (article?.category !== 'plate' || type?.kind !== 'plate') return undefined;
  const [x, y] = type.cellMm;
  const edges = type.folded?.edges ?? [];
  const { lift, thickness } = PLATE;
  const [hx, hy] = [x / 2, y / 2];
  const [lo, hi] = plateEnds(x, edges);
  // Counter-clockwise; each corner is a quarter-circle notch around the junction,
  // turning clockwise about it from the edge arriving there (at angle start) to
  // the edge leaving it. A bent edge ends straight, short of the notches.
  const corners = [
    { x: hx, y: -hy, start: Math.PI },
    { x: hx, y: hy, start: -Math.PI / 2 },
    { x: -hx, y: hy, start: 0 },
    { x: -hx, y: -hy, start: Math.PI / 2 },
  ];
  const outline = corners.flatMap(({ x: cx, y: cy, start }) =>
    (cx > 0 ? hi < hx : lo > -hx)
      ? [{ x: cx > 0 ? hi : lo, y: cy }]
      : Array.from({ length: NOTCH_STEPS + 1 }, (_, k) => {
          const t = start - (Math.PI / 2) * (k / NOTCH_STEPS);
          return { x: cx + lift * Math.cos(t), y: cy + lift * Math.sin(t) };
        }),
  );
  const { grid, pitch, diameter } = PERFORATION;
  const steps = Array.from({ length: grid }, (_, i) => (i - (grid - 1) / 2) * pitch);
  const holes =
    article.plate === 'perforated'
      ? steps.flatMap((cy) => steps.map((cx) => ({ x: cx, y: cy, radiusMm: diameter / 2 })))
      : [];
  const slab: DisplayShape = { kind: 'slab', outline, holes, bottomZ: lift, thicknessMm: thickness };
  return [slab, ...plateFlanges(x, y), ...plateTabs(x, y, edges), ...plateMarks(x, y), ...plateFolds(x, y, edges)];
}
