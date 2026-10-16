import type { GridDirection } from './article-catalog.js';
import type {
  AttachmentSite,
  ConnectionType,
  PartCatalog,
  PartType,
  PlateType,
  SlideType,
  TubeType,
} from './catalog.js';
import type { RealizationSolver, SolveOptions } from './core.js';
import type {
  ConstructionDesign,
  PlateIntent,
  PlateMountIntent,
  SlideIntent,
  TubeEndpoint,
  TubeIntent,
} from './design.js';
import type { Diagnostic, DiagnosticCode, Result, SubjectRef } from './diagnostics.js';
import type { Pose, Quaternion, Vector3 } from './geometry.js';
import type { IntentRef, JunctionId, PartId, PlateId, SiteId, SlideId, TubeEnd, TubeId } from './ids.js';
import {
  AXIS_ROTATIONS,
  compose,
  dot,
  inverse,
  length,
  qangle,
  qaxisAngle,
  qconj,
  qmul,
  rotate,
  scale,
  sub,
  vec,
  add,
} from './math.js';
import type { Connection, PartInstance, PlateMountResolution, Realization } from './realization.js';

/**
 * First solver stage (SPEC 6): straight and bent tubes on grid junctions with
 * automatically chosen connectors, angle adapters, closed rings, open tube ends
 * plates screwed into the holes of straight tubes, and slides hanging on tubes.
 */
export const realizationSolver: RealizationSolver = { solve: solveRealization };

const FLIP_Z = qaxisAngle(vec(1, 0, 0), Math.PI);
const X = vec(1, 0, 0);
const Z = vec(0, 0, 1);

type Params = Readonly<Record<string, number>>;

interface ConnectorChoice {
  readonly type: PartType;
  readonly rotation: Quaternion;
  /** Socket site per tube end at this junction. */
  readonly sockets: ReadonlyMap<string, AttachmentSite>;
}

interface EndRef {
  readonly tube: TubeIntent;
  readonly end: TubeEnd;
}

/** Angle adapter between a connector arm and an oblique tube end. */
interface AdapterChoice {
  readonly type: PartType;
  readonly sleeve: AttachmentSite;
  readonly spigot: AttachmentSite;
}

interface Earlier {
  readonly parts: ReadonlyMap<string, PartInstance>;
  readonly poses: ReadonlyMap<PartId, Pose>;
  readonly junctions: ReadonlyMap<JunctionId, Pose>;
  /** By site pair, as connection IDs are formed. */
  readonly connections: ReadonlyMap<string, Connection>;
  /** By the two parts, in either order. */
  readonly between: ReadonlyMap<string, readonly Connection[]>;
}

const partKey = (intent: IntentRef, role: string) => `${intent.kind}\u0000${intent.id}\u0000${role}`;
const pairKey = (x: PartId, y: PartId) => (x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`);

function index(previous: Realization): Earlier {
  const between = new Map<string, Connection[]>();
  for (const c of previous.connections) {
    const key = pairKey(c.a.partId, c.b.partId);
    between.set(key, [...(between.get(key) ?? []), c]);
  }
  return {
    parts: new Map(previous.parts.map((p) => [partKey(p.origin.intent, p.origin.role), p])),
    poses: new Map(previous.poses.map((p) => [p.partId, p.worldPose])),
    junctions: new Map(
      previous.intentPoses.flatMap((p) => (p.intent.kind === 'junction' ? [[p.intent.id, p.worldPose]] : [])),
    ),
    connections: new Map(
      previous.connections.map((c) => [`${c.a.partId}#${c.a.siteId}~${c.b.partId}#${c.b.siteId}`, c]),
    ),
    between,
  };
}

interface SlidePlacement {
  readonly slide: SlideIntent;
  readonly type: SlideType;
  readonly pose: Pose;
  readonly tube: TubeIntent;
  readonly middle: AttachmentSite;
  readonly hang: AttachmentSite;
  readonly connectionType: ConnectionType;
  readonly params: { readonly turnRad: number; readonly flipRad: number };
}

const GRID: Readonly<Record<GridDirection, Vector3>> = {
  '+x': vec(1, 0, 0),
  '-x': vec(-1, 0, 0),
  '+y': vec(0, 1, 0),
  '-y': vec(0, -1, 0),
  '+z': vec(0, 0, 1),
  '-z': vec(0, 0, -1),
};

/** A plate mount realised in a tube hole. */
interface MountFit {
  readonly plate: PlateIntent;
  readonly mount: PlateMountIntent;
  readonly hole: AttachmentSite;
  readonly turnRad: number;
}

/** Tube frame relative to the connector frame, with the parameters of each link. */
interface Chain {
  readonly tubeInConnector: Pose;
  readonly params: readonly Params[];
  /** Adapter frame relative to the connector frame. */
  readonly adapterInConnector?: Pose;
}

class Conflict extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

function conflict(
  code: DiagnosticCode,
  message: string,
  subjects: readonly SubjectRef[],
  details?: Diagnostic['details'],
): never {
  throw new Conflict(
    details ? { code, severity: 'error', message, subjects, details } : { code, severity: 'error', message, subjects },
  );
}

const tubeRef = (id: TubeId): SubjectRef => ({ kind: 'intent', ref: { kind: 'tube', id } });
const junctionRef = (id: JunctionId): SubjectRef => ({ kind: 'intent', ref: { kind: 'junction', id } });
const plateRef = (id: PlateId): SubjectRef => ({ kind: 'intent', ref: { kind: 'plate', id } });
const slideRef = (id: SlideId): SubjectRef => ({ kind: 'intent', ref: { kind: 'slide', id } });
const endKey = (e: EndRef) => `${e.tube.id}\u0000${e.end}`;

export function solveRealization(
  design: ConstructionDesign,
  catalog: PartCatalog,
  options: SolveOptions,
  previous?: Realization,
): Result<Realization> {
  try {
    return { ok: true, value: new Solver(design, catalog, options, previous).run(), diagnostics: [] };
  } catch (error) {
    if (error instanceof Conflict) return { ok: false, diagnostics: [error.diagnostic] };
    throw error;
  }
}

class Solver {
  private readonly types: Map<string, PartType>;
  private readonly ends = new Map<JunctionId, EndRef[]>();
  private readonly junctionPoses = new Map<JunctionId, Pose>();
  private readonly connectors = new Map<JunctionId, ConnectorChoice>();
  private readonly connectorPoses = new Map<JunctionId, Pose>();
  private readonly tubeTypes = new Map<TubeId, TubeType>();
  private readonly tubePoses = new Map<TubeId, Pose>();
  private readonly adapters = new Map<string, AdapterChoice>();
  /** Chosen chain per tube end on a connector: one link, or two via an adapter. */
  private readonly links = new Map<string, Chain>();
  private readonly plateTypes = new Map<PlateId, PlateType>();
  private readonly platePoses = new Map<PlateId, Pose>();
  private readonly mountFits: MountFit[] = [];
  private readonly slides: SlidePlacement[] = [];
  private readonly armOffset: number;
  /** The previous realization, indexed: the solver looks it up for every part. */
  private readonly earlier?: Earlier;

  constructor(
    private readonly design: ConstructionDesign,
    private readonly catalog: PartCatalog,
    private readonly options: SolveOptions,
    previous?: Realization,
  ) {
    this.types = new Map(catalog.partTypes.map((t) => [t.id, t]));
    if (previous) this.earlier = index(previous);
    const junctions = new Set(design.junctions.map((j) => j.id));
    for (const tube of design.tubes) {
      for (const end of ['a', 'b'] as const) {
        const junctionId = tube[end].junctionId;
        if (!junctions.has(junctionId)) {
          conflict('missing-reference', `Rohr ${tube.id} verweist auf unbekannten Verbindungspunkt ${junctionId}.`, [
            tubeRef(tube.id),
          ]);
        }
        this.ends.set(junctionId, [...(this.ends.get(junctionId) ?? []), { tube, end }]);
      }
    }
    // Distance from connector centre to arm shoulder, also used for open tube ends.
    const socket = catalog.partTypes
      .flatMap((t) => (t.kind === 'connector' ? t.sites : []))
      .find((s) => s.role === 'socket');
    this.armOffset = socket ? length(socket.frame.position) : 0;
  }

  run(): Realization {
    for (const tube of [...this.design.tubes].sort((a, b) => compare(a.id, b.id)))
      this.tubeTypes.set(tube.id, this.chooseTubeType(tube));
    for (const junction of [...this.design.junctions].sort((a, b) => compare(a.id, b.id)))
      this.chooseConnector(junction.id);
    for (const component of this.components()) this.place(component);
    this.placePlates();
    this.placeSlides();
    return this.realization();
  }

  // ------------------------------------------------------------ choices

  private chooseTubeType(tube: TubeIntent): TubeType {
    const family = this.catalog.partTypes.filter(
      (t): t is TubeType => t.kind === 'tube' && t.familyId === tube.familyId,
    );
    const variant = tube.variant;
    if (variant.mode === 'fixed') {
      const fixed = family.find((t) => t.id === variant.typeId);
      if (!fixed) {
        conflict(
          'fixed-variant-conflict',
          `Fixierte Variante ${variant.typeId} gehört nicht zur Familie ${tube.familyId}.`,
          [tubeRef(tube.id)],
        );
      }
      return fixed;
    }
    const previousType = this.previousPart({ kind: 'tube', id: tube.id }, 'body')?.typeId;
    const preferred = variant.preferredTypeId;
    const ranked = [...family].sort(
      (a, b) =>
        Number(b.id === previousType) - Number(a.id === previousType) ||
        Number(b.id === preferred) - Number(a.id === preferred) ||
        Number(b.standardVariant) - Number(a.standardVariant) ||
        compare(a.id, b.id),
    );
    const chosen = ranked[0];
    if (!chosen) conflict('no-realization', `Keine Rohre der Familie ${tube.familyId} im Katalog.`, [tubeRef(tube.id)]);
    return chosen;
  }

  /** Auto connector: exact arm count preferred, previous type and rotation kept when valid. */
  private chooseConnector(junctionId: JunctionId): void {
    const ends = this.ends.get(junctionId) ?? [];
    if (ends.length < 2) return;
    const tol = this.options.tolerance.angleRad;
    const axial = ends.map((e) => {
      const d = rotate(e.tube[e.end].orientation, Z);
      const axis = nearestAxis(d);
      return Math.acos(clamp(dot(d, axis))) <= tol ? axis : undefined;
    });
    const used = axial.filter((a): a is Vector3 => a !== undefined);
    const directions = ends.map((e, i) => {
      const axis = axial[i];
      if (axis) return axis;
      const d = rotate(e.tube[e.end].orientation, Z);
      const named = e.tube[e.end].adapterArm;
      const explicit = named && AXES[['+x', '-x', '+y', '-y', '+z', '-z'].indexOf(named)];
      const adapter = this.adapterFor(d, used, explicit ?? this.previousAdapterArm(junctionId, e));
      if (adapter && explicit && dot(adapter.arm, explicit) < 1 - 1e-9) {
        conflict(
          'junction-angle-unsupported',
          `Die Winkelkupplung für Rohr ${e.tube.id} passt an Verbindungspunkt ${junctionId} nicht auf den Arm ${named}.`,
          [junctionRef(junctionId), tubeRef(e.tube.id)],
          { arm: named! },
        );
      }
      if (!adapter) {
        const nearest = nearestAxis(d);
        conflict(
          'junction-angle-unsupported',
          `Rohr ${e.tube.id} trifft an Verbindungspunkt ${junctionId} in einem Winkel, den keine Kupplung und keine Winkelkupplung bietet.`,
          [junctionRef(junctionId), tubeRef(e.tube.id)],
          { deviationDeg: round(deg(Math.acos(clamp(dot(d, nearest))))) },
        );
      }
      used.push(adapter.arm);
      this.adapters.set(endKey(e), adapter.choice);
      return adapter.arm;
    });
    const previousPart = this.previousPart({ kind: 'junction', id: junctionId }, 'connector');
    const previousRotation = this.previousConnectorRotation(junctionId);
    const candidates = this.catalog.partTypes
      .filter((t) => t.kind === 'connector')
      .map((t) => ({ type: t, sockets: t.sites.filter((s) => s.role === 'socket') }))
      .filter((c) => c.sockets.length >= ends.length)
      .sort(
        (a, b) =>
          Number(b.type.id === previousPart?.typeId) - Number(a.type.id === previousPart?.typeId) ||
          a.sockets.length - b.sockets.length ||
          compare(a.type.id, b.type.id),
      );
    for (const candidate of candidates) {
      const rotations =
        previousRotation && candidate.type.id === previousPart?.typeId
          ? [previousRotation, ...AXIS_ROTATIONS]
          : AXIS_ROTATIONS;
      for (const rotation of rotations) {
        const assignment = new Map<string, AttachmentSite>();
        const used = new Set<string>();
        for (const [i, d] of directions.entries()) {
          const socket = candidate.sockets.find(
            (s) => !used.has(s.id) && dot(rotate(qmul(rotation, s.frame.orientation), Z), d) > 1 - 1e-9,
          );
          if (!socket) break;
          used.add(socket.id);
          assignment.set(endKey(ends[i]!), socket);
        }
        if (assignment.size === ends.length) {
          this.connectors.set(junctionId, { type: candidate.type, rotation, sockets: assignment });
          return;
        }
      }
    }
    conflict(
      'junction-angle-unsupported',
      `Keine Kupplung für die Rohrrichtungen an Verbindungspunkt ${junctionId}.`,
      [junctionRef(junctionId), ...ends.map((e) => tubeRef(e.tube.id))],
      { tubes: ends.length },
    );
  }

  /**
   * Arm direction and adapter whose spigot points along d. Arm frames are
   * axis-aligned and adapter parameters step in quarter turns, so a canonical
   * arm frame per axis decides feasibility for every connector.
   */
  private adapterFor(
    d: Vector3,
    used: readonly Vector3[],
    preferred: Vector3 | undefined,
  ): { arm: Vector3; choice: AdapterChoice } | undefined {
    const tol = this.options.tolerance.angleRad;
    const socket = this.catalog.partTypes
      .flatMap((t) => (t.kind === 'connector' ? t.sites : []))
      .find((s) => s.role === 'socket');
    if (!socket) return undefined;
    const adapters = this.catalog.partTypes.filter((t) => t.kind === 'adapter').sort((a, b) => compare(a.id, b.id));
    for (const type of adapters) {
      const sleeve = type.sites.find((s) => s.role === 'tube-end');
      const spigot = type.sites.find((s) => s.role === 'socket');
      if (!sleeve || !spigot) continue;
      const arms = preferred ? [preferred, ...AXES.filter((a) => dot(a, preferred) < 1 - 1e-9)] : AXES;
      for (const arm of arms) {
        if (used.some((u) => dot(u, arm) > 1 - 1e-9)) continue;
        const canonicalArm: AttachmentSite = {
          ...socket,
          frame: {
            position: vec(0, 0, 0),
            orientation: AXIS_ROTATIONS.find((r) => dot(rotate(r, Z), arm) > 1 - 1e-9)!,
          },
        };
        const choice = { type, sleeve, spigot };
        const reachable = this.adapterChains(canonicalArm, choice, undefined).some(
          (c) => angleBetween(rotate(compose(c.adapterInConnector!, spigot.frame).orientation, Z), d) <= tol,
        );
        if (reachable) return { arm, choice };
      }
    }
    return undefined;
  }

  // ------------------------------------------------------------ placement

  private components(): { readonly junctions: JunctionId[]; readonly tubes: TubeId[] }[] {
    const seen = new Set<JunctionId>();
    const result: { junctions: JunctionId[]; tubes: TubeId[] }[] = [];
    for (const junction of [...this.design.junctions].sort((a, b) => compare(a.id, b.id))) {
      if (seen.has(junction.id)) continue;
      const junctions: JunctionId[] = [];
      const tubes = new Set<TubeId>();
      const queue = [junction.id];
      seen.add(junction.id);
      while (queue.length > 0) {
        const current = queue.shift()!;
        junctions.push(current);
        for (const e of this.ends.get(current) ?? []) {
          tubes.add(e.tube.id);
          const other = e.tube[e.end === 'a' ? 'b' : 'a'].junctionId;
          if (!seen.has(other)) {
            seen.add(other);
            queue.push(other);
          }
        }
      }
      result.push({ junctions, tubes: [...tubes].sort(compare) });
    }
    return result;
  }

  private place(component: { readonly junctions: JunctionId[]; readonly tubes: TubeId[] }): void {
    const inside = (ref: IntentRef) =>
      ref.kind === 'junction'
        ? component.junctions.includes(ref.id)
        : ref.kind === 'tube'
          ? component.tubes.includes(ref.id)
          : false;
    const anchors = this.design.anchors.filter((a) => inside(a.target));
    if (anchors.length !== 1) {
      if (component.tubes.length === 0 && anchors.length === 0) return;
      conflict(
        'unresolved-placement',
        anchors.length === 0 ? 'Baugruppe hat keinen Anker.' : 'Baugruppe hat mehrere Anker.',
        component.junctions.map(junctionRef),
      );
    }
    const anchor = anchors[0]!;
    const queue: JunctionId[] = [];
    if (anchor.target.kind === 'junction') {
      this.placeJunction(anchor.target.id, anchor.worldPose);
      queue.push(anchor.target.id);
    } else {
      const tube = this.design.tubes.find((t) => t.id === anchor.target.id)!;
      const orientation = this.junctionOrientationFromTube(tube, anchor.worldPose);
      this.tubePoses.set(tube.id, anchor.worldPose);
      for (const end of ['a', 'b'] as const) {
        this.arrive(tube, end, orientation);
        queue.push(tube[end].junctionId);
      }
    }
    while (queue.length > 0) {
      const junctionId = queue.shift()!;
      const frame = this.junctionPoses.get(junctionId)!;
      for (const e of [...(this.ends.get(junctionId) ?? [])].sort((x, y) => compare(endKey(x), endKey(y)))) {
        if (this.tubePoses.has(e.tube.id)) {
          this.arrive(e.tube, e.end, frame.orientation);
          continue;
        }
        this.leave(e, frame);
        const otherEnd = e.end === 'a' ? 'b' : 'a';
        const otherJunction = e.tube[otherEnd].junctionId;
        const known = this.junctionPoses.has(otherJunction);
        this.arrive(e.tube, otherEnd, frame.orientation);
        if (!known) queue.push(otherJunction);
      }
    }
  }

  private placeJunction(junctionId: JunctionId, frame: Pose): void {
    this.junctionPoses.set(junctionId, frame);
    const choice = this.connectors.get(junctionId);
    if (choice)
      this.connectorPoses.set(junctionId, {
        position: frame.position,
        orientation: qmul(frame.orientation, choice.rotation),
      });
  }

  /** Places a tube from a placed junction, choosing connection parameters. */
  private leave(e: EndRef, junction: Pose): void {
    const type = this.tubeTypes.get(e.tube.id)!;
    const endSite = endSiteOf(type, e.end);
    const endpoint = e.tube[e.end];
    const expectedEnd = this.expectedEndFrame(junction.orientation, endpoint);
    const otherEnd = e.end === 'a' ? 'b' : 'a';
    const otherDirection = rotate(qmul(junction.orientation, e.tube[otherEnd].orientation), Z);
    const candidates = this.tubeCandidates(e, junction, type);
    const fitting = candidates.filter(({ pose }) => {
      const actualEnd = compose(pose, {
        position: endSite.frame.position,
        orientation: qmul(endSite.frame.orientation, FLIP_Z),
      });
      const other = compose(pose, endSiteOf(type, otherEnd).frame);
      // The other end leaves its junction pointing into the tube: site +Z points out.
      const otherInto = scale(rotate(other.orientation, Z), -1);
      return (
        this.endMatches(actualEnd.orientation, expectedEnd, endpoint) &&
        angleBetween(otherInto, otherDirection) <= this.options.tolerance.angleRad
      );
    });
    const chosen = fitting[0];
    if (!chosen) {
      conflict(
        'connection-misfit',
        `Rohr ${e.tube.id} lässt sich an Verbindungspunkt ${endpoint.junctionId} nicht in der gewünschten Lage anschließen.`,
        [tubeRef(e.tube.id), junctionRef(endpoint.junctionId)],
      );
    }
    this.tubePoses.set(e.tube.id, chosen.pose);
    if (chosen.chain) this.links.set(endKey(e), chosen.chain);
  }

  /** Candidate tube poses from the junction end, previous parameters first. */
  private tubeCandidates(e: EndRef, junction: Pose, type: TubeType): { pose: Pose; chain?: Chain }[] {
    const endSite = endSiteOf(type, e.end);
    const choice = this.connectors.get(e.tube[e.end].junctionId);
    const connectorPose = this.connectorPoses.get(e.tube[e.end].junctionId);
    if (!choice || !connectorPose) {
      // Open end: the end face sits one arm length from the junction point.
      const frames = this.openEndFrames(junction, e.tube[e.end]);
      return frames.map((frame) => ({ pose: compose(frame, inverse(endSite.frame)) }));
    }
    return this.chains(e, choice, endSite).map((chain) => ({
      pose: compose(connectorPose, chain.tubeInConnector),
      chain,
    }));
  }

  /** All ways from the connector to the tube end: directly or via the chosen adapter. */
  private chains(e: EndRef, choice: ConnectorChoice, endSite: AttachmentSite): Chain[] {
    const arm = choice.sockets.get(endKey(e))!;
    const adapter = this.adapters.get(endKey(e));
    if (adapter) return this.adapterChains(arm, adapter, { e, endSite, connectorTypeId: choice.type.id });
    const link = this.connectionBetween(arm, endSite, e);
    return this.parameterSets(link.type, e, choice.type.id).map((params) => ({
      tubeInConnector: compose(compose(arm.frame, this.armTo(link, params, e)), inverse(endSite.frame)),
      params: [params],
    }));
  }

  private adapterChains(
    arm: AttachmentSite,
    adapter: AdapterChoice,
    tube: { e: EndRef; endSite: AttachmentSite; connectorTypeId: string } | undefined,
  ): Chain[] {
    const e = tube?.e ?? { tube: this.design.tubes[0]!, end: 'a' as TubeEnd };
    const first = this.connectionBetween(arm, adapter.sleeve, e);
    const chains: Chain[] = [];
    for (const p1 of this.parameterSets(first.type, undefined, '')) {
      const adapterInConnector = compose(compose(arm.frame, this.armTo(first, p1, e)), inverse(adapter.sleeve.frame));
      if (!tube) {
        chains.push({ tubeInConnector: adapterInConnector, params: [p1], adapterInConnector });
        continue;
      }
      const second = this.connectionBetween(adapter.spigot, tube.endSite, e);
      for (const p2 of this.parameterSets(second.type, tube.e, tube.connectorTypeId)) {
        const tubeInConnector = compose(
          compose(compose(adapterInConnector, adapter.spigot.frame), this.armTo(second, p2, e)),
          inverse(tube.endSite.frame),
        );
        chains.push({ tubeInConnector, params: [p1, p2], adapterInConnector });
      }
    }
    return chains;
  }

  /** Frame of the far site in the arm site's frame for a link with the given parameters. */
  private armTo(link: { type: ConnectionType; armIsA: boolean }, params: Params, e: EndRef): Pose {
    const relative = this.evaluate(link.type, params, e);
    return link.armIsA ? relative : inverse(relative);
  }

  /** Places or verifies the junction at a tube end that is already placed. */
  private arrive(tube: TubeIntent, end: TubeEnd, orientation: Quaternion): void {
    const junctionId = tube[end].junctionId;
    const pose = this.tubePoses.get(tube.id)!;
    const type = this.tubeTypes.get(tube.id)!;
    const endSite = endSiteOf(type, end);
    const endWorld = compose(pose, endSite.frame);
    const e = { tube, end };
    const choice = this.connectors.get(junctionId);
    const tol = this.options.tolerance;
    if (!choice) {
      const centre = add(endWorld.position, scale(rotate(endWorld.orientation, Z), this.armOffset));
      const existing = this.junctionPoses.get(junctionId);
      if (existing && length(sub(existing.position, centre)) > tol.distanceMm) {
        conflict(
          'loop-closure-conflict',
          `Rohr ${tube.id} erreicht Verbindungspunkt ${junctionId} nicht.`,
          [tubeRef(tube.id), junctionRef(junctionId)],
          { offsetMm: round(length(sub(existing.position, centre))) },
        );
      }
      if (!existing) this.placeJunction(junctionId, { position: centre, orientation });
      return;
    }
    if (this.links.has(endKey(e))) return;
    const expectedOrientation = qmul(orientation, choice.rotation);
    const existing = this.connectorPoses.get(junctionId);
    let closest = Infinity;
    for (const chain of this.chains(e, choice, endSite)) {
      const connectorPose = compose(pose, inverse(chain.tubeInConnector));
      const turn = qangle(qmul(qconj(expectedOrientation), connectorPose.orientation));
      if (turn > tol.angleRad) continue;
      if (existing) {
        const offset = length(sub(existing.position, connectorPose.position));
        closest = Math.min(closest, offset);
        if (offset > tol.distanceMm) continue;
      } else {
        this.placeJunction(junctionId, { position: connectorPose.position, orientation });
      }
      this.links.set(endKey(e), chain);
      return;
    }
    if (existing && Number.isFinite(closest)) {
      conflict(
        'loop-closure-conflict',
        `Ring über Rohr ${tube.id} schließt an Verbindungspunkt ${junctionId} nicht.`,
        [tubeRef(tube.id), junctionRef(junctionId)],
        { offsetMm: round(closest) },
      );
    }
    conflict(
      'connection-misfit',
      `Rohr ${tube.id} trifft verdreht auf die Kupplung an Verbindungspunkt ${junctionId}.`,
      [tubeRef(tube.id), junctionRef(junctionId)],
    );
  }

  // ------------------------------------------------------------ slides

  /**
   * A slide hangs on the middle of a straight, horizontal tube and runs away from
   * it in its toward direction, upright in the frame of the tube's junction a.
   */
  private placeSlides(): void {
    for (const slide of [...this.design.slides].sort((a, b) => compare(a.id, b.id))) {
      const type = this.catalog.partTypes.find(
        (t): t is SlideType => t.kind === 'slide' && t.familyId === slide.familyId,
      );
      if (!type)
        conflict('no-realization', `Keine Rutsche der Familie ${slide.familyId} im Katalog.`, [slideRef(slide.id)]);
      const tube = this.design.tubes.find((t) => t.id === slide.tubeId);
      const tubeType = tube && this.tubeTypes.get(tube.id);
      const tubePose = tube && this.tubePoses.get(tube.id);
      const junction = tube && this.junctionPoses.get(tube.a.junctionId);
      if (!tube || !tubeType || !tubePose || !junction) {
        conflict('missing-reference', `Rutsche ${slide.id} hängt an Rohr ${slide.tubeId}, das keine Lage hat.`, [
          slideRef(slide.id),
          tubeRef(slide.tubeId),
        ]);
      }
      const middle = tubeType.sites.find((s) => s.role === 'hang');
      const hang = type.sites.find((s) => s.role === 'hang');
      const connectionType = middle && hang && this.slideConnectionType(middle, hang);
      if (tubeType.shape !== 'straight' || !middle || !hang || !connectionType) {
        conflict(
          'incompatible-attachment',
          `Rutsche ${slide.id}: An Rohr ${tube.id} lässt sich keine Rutsche hängen.`,
          [slideRef(slide.id), tubeRef(tube.id)],
        );
      }
      const tol = this.options.tolerance.angleRad;
      const up = rotate(junction.orientation, Z);
      const toward = rotate(junction.orientation, GRID[slide.toward]);
      const axis = rotate(tubePose.orientation, X);
      if (
        Math.abs(dot(axis, up)) > Math.sin(tol) ||
        Math.abs(dot(axis, toward)) > Math.sin(tol) ||
        Math.abs(dot(toward, up)) > Math.sin(tol)
      ) {
        conflict(
          'incompatible-attachment',
          `Rutsche ${slide.id} braucht ein waagerechtes Rohr quer zur Richtung ${slide.toward}.`,
          [slideRef(slide.id), tubeRef(tube.id)],
        );
      }
      const pose: Pose = {
        position: compose(tubePose, middle.frame).position,
        orientation: AXIS_ROTATIONS.reduce((best, r) =>
          dot(rotate(r, X), toward) + dot(rotate(r, Z), up) > dot(rotate(best, X), toward) + dot(rotate(best, Z), up)
            ? r
            : best,
        ),
      };
      const bInA = compose(inverse(compose(tubePose, middle.frame)), compose(pose, hang.frame));
      const evaluate =
        this.options.connectionEvaluators?.[
          connectionType.kinematics.kind === 'parametric' ? connectionType.kinematics.evaluatorKey : ''
        ];
      const params = evaluate
        ? [0, 0.5, 1, 1.5]
            .flatMap((t) => [0, 1].map((f) => ({ turnRad: t * Math.PI, flipRad: f * Math.PI })))
            .find((p) => qangle(qmul(qconj(evaluate(p).orientation), bInA.orientation)) < tol)
        : undefined;
      if (!params) {
        conflict('connection-misfit', `Rutsche ${slide.id} sitzt nicht passend an Rohr ${tube.id}.`, [
          slideRef(slide.id),
          tubeRef(tube.id),
        ]);
      }
      this.slides.push({ slide, type, pose, tube, middle, hang, connectionType, params });
    }
  }

  private slideConnectionType(middle: AttachmentSite, hang: AttachmentSite): ConnectionType | undefined {
    return this.catalog.connectionTypes.find(
      (c) => c.aInterfaceId === middle.interfaceId && c.bInterfaceId === hang.interfaceId,
    );
  }

  // ------------------------------------------------------------ plates

  /**
   * Plates sit at their logical place relative to a junction. Each tube carrying
   * plates then gets the variant and quarter-turn roll whose holes meet all its
   * mounts; straight tubes keep their axis, so nothing else moves (BAUBARKEIT 5).
   */
  private placePlates(): void {
    const byTube = new Map<TubeId, { plate: PlateIntent; mount: PlateMountIntent; frame: Pose }[]>();
    for (const plate of [...this.design.plates].sort((a, b) => compare(a.id, b.id))) {
      const type = this.choosePlateType(plate);
      const junction = this.junctionPoses.get(plate.placement.junctionId);
      if (!junction) {
        conflict(
          'unresolved-placement',
          `Platte ${plate.id} hängt an Verbindungspunkt ${plate.placement.junctionId}, der keine Lage hat.`,
          [plateRef(plate.id), junctionRef(plate.placement.junctionId)],
        );
      }
      const pose = compose(junction, plate.placement.pose);
      this.plateTypes.set(plate.id, type);
      this.platePoses.set(plate.id, pose);
      for (const siteId of type.requiredMounts) {
        const count = plate.mounts.filter((m) => m.plateSiteId === siteId).length;
        if (count !== 1) {
          conflict(
            'plate-mount-conflict',
            count === 0
              ? `Platte ${plate.id}: Befestigung ${siteId} fehlt.`
              : `Platte ${plate.id}: Befestigung ${siteId} ist mehrfach angegeben.`,
            [plateRef(plate.id)],
          );
        }
      }
      for (const mount of plate.mounts) {
        const site = type.sites.find((s) => s.id === mount.plateSiteId && s.role === 'mount');
        const tube = this.design.tubes.find((t) => t.id === mount.tubeId);
        if (!site || !tube || !this.tubePoses.has(tube.id)) {
          conflict(
            'missing-reference',
            `Platte ${plate.id}: Befestigung ${mount.plateSiteId} an Rohr ${mount.tubeId} gibt es nicht.`,
            [plateRef(plate.id), tubeRef(mount.tubeId)],
          );
        }
        byTube.set(tube.id, [...(byTube.get(tube.id) ?? []), { plate, mount, frame: compose(pose, site.frame) }]);
      }
    }
    for (const [tubeId, mounts] of [...byTube].sort(([a], [b]) => compare(a, b))) this.fitHoles(tubeId, mounts);
  }

  private choosePlateType(plate: PlateIntent): PlateType {
    const family = this.catalog.partTypes.filter(
      (t): t is PlateType => t.kind === 'plate' && t.familyId === plate.familyId,
    );
    const variant = plate.variant;
    const previousType = this.previousPart({ kind: 'plate', id: plate.id }, 'body')?.typeId;
    const preferred = variant.mode === 'fixed' ? variant.typeId : (variant.preferredTypeId ?? previousType);
    const chosen =
      variant.mode === 'fixed'
        ? family.find((t) => t.id === variant.typeId)
        : ([...family].sort(
            (a, b) => Number(b.id === preferred) - Number(a.id === preferred) || compare(a.id, b.id),
          )[0] as PlateType | undefined);
    if (!chosen) {
      conflict(
        variant.mode === 'fixed' ? 'fixed-variant-conflict' : 'no-realization',
        `Keine Platte der Familie ${plate.familyId} im Katalog.`,
        [plateRef(plate.id)],
      );
    }
    return chosen;
  }

  private fitHoles(tubeId: TubeId, mounts: readonly { plate: PlateIntent; mount: PlateMountIntent; frame: Pose }[]) {
    const tube = this.design.tubes.find((t) => t.id === tubeId)!;
    const current = this.tubeTypes.get(tubeId)!;
    const pose = this.tubePoses.get(tubeId)!;
    const tol = this.options.tolerance;
    const subjects = [tubeRef(tubeId), ...[...new Set(mounts.map((m) => m.plate.id))].map(plateRef)];
    if (current.shape !== 'straight') {
      conflict('plate-mount-conflict', `Platten an Bogenrohr ${tubeId} werden noch nicht unterstützt.`, subjects);
    }
    // The mount must lie on the tube axis at the station the design names.
    const start = compose(pose, endSiteOf(current, 'a').frame).position;
    const axis = rotate(pose.orientation, X);
    for (const { plate, mount, frame } of mounts) {
      const offset = sub(frame.position, start);
      const station = dot(offset, axis);
      const lateral = length(sub(offset, scale(axis, station)));
      if (lateral > tol.distanceMm || Math.abs(station - mount.stationMm) > tol.distanceMm) {
        conflict(
          'plate-mount-conflict',
          `Platte ${plate.id} liegt an Befestigung ${mount.plateSiteId} nicht auf Rohr ${tubeId}.`,
          [plateRef(plate.id), tubeRef(tubeId)],
          { lateralMm: round(lateral), stationMm: round(station) },
        );
      }
    }
    const family = this.catalog.partTypes.filter(
      (t): t is TubeType => t.kind === 'tube' && t.familyId === tube.familyId,
    );
    const variant = tube.variant;
    const types =
      variant.mode === 'fixed'
        ? [current]
        : [
            current,
            ...family
              .filter((t) => t.id !== current.id)
              .sort((a, b) => Number(b.standardVariant) - Number(a.standardVariant) || compare(a.id, b.id)),
          ];
    for (const type of types) {
      for (const quarter of [0, 1, 2, 3]) {
        const candidate = compose(pose, {
          position: vec(0, 0, 0),
          orientation: qaxisAngle(X, (quarter * Math.PI) / 2),
        });
        const fits = this.assignHoles(type, candidate, mounts);
        if (!fits) continue;
        this.tubeTypes.set(tubeId, type);
        this.tubePoses.set(tubeId, candidate);
        for (const end of ['a', 'b'] as const) this.relink({ tube, end }, type, candidate);
        this.mountFits.push(...fits);
        return;
      }
    }
    conflict(
      'plate-mount-conflict',
      variant.mode === 'fixed'
        ? `Rohr ${tubeId} (${current.id}) hat keine Bohrungen an den Befestigungen der Platten.`
        : `Keine Variante von Rohr ${tubeId} hat Bohrungen an allen Befestigungen der Platten.`,
      subjects,
      { mounts: mounts.length },
    );
  }

  /** Each mount in its own hole facing it, or undefined. */
  private assignHoles(
    type: TubeType,
    pose: Pose,
    mounts: readonly { plate: PlateIntent; mount: PlateMountIntent; frame: Pose }[],
  ): MountFit[] | undefined {
    const tol = this.options.tolerance;
    const used = new Set<SiteId>();
    const fits: MountFit[] = [];
    for (const { plate, mount, frame } of mounts) {
      const fixed = mount.hole.mode === 'fixed' ? mount.hole : undefined;
      if (fixed && fixed.tubeTypeId !== type.id) return undefined;
      const hole = type.sites.find((s) => {
        if (s.role !== 'hole' || used.has(s.id) || (fixed && fixed.siteId !== s.id)) return false;
        const world = compose(pose, s.frame);
        const facing = angleBetween(rotate(world.orientation, Z), scale(rotate(frame.orientation, Z), -1));
        return length(sub(world.position, frame.position)) <= tol.distanceMm && facing <= tol.angleRad;
      });
      if (!hole) return undefined;
      used.add(hole.id);
      const along = dot(rotate(compose(pose, hole.frame).orientation, X), rotate(frame.orientation, X));
      fits.push({ plate, mount, hole, turnRad: along > 0 ? 0 : Math.PI });
    }
    return fits;
  }

  /** Chain to the connector for a tube end after the tube turned about its axis. */
  private relink(e: EndRef, type: TubeType, pose: Pose): void {
    const before = this.links.get(endKey(e));
    const junctionId = e.tube[e.end].junctionId;
    const choice = this.connectors.get(junctionId);
    const connectorPose = this.connectorPoses.get(junctionId);
    if (!before || !choice || !connectorPose) return;
    const tol = this.options.tolerance;
    const matching = this.chains(e, choice, endSiteOf(type, e.end)).filter((chain) => {
      const at = compose(connectorPose, chain.tubeInConnector);
      return (
        length(sub(at.position, pose.position)) <= tol.distanceMm &&
        qangle(qmul(qconj(at.orientation), pose.orientation)) <= tol.angleRad
      );
    });
    const same = (chain: Chain) =>
      Object.entries(chain.params[0] ?? {}).every(([k, v]) => Math.abs((before.params[0]?.[k] ?? NaN) - v) < 1e-9);
    const chosen = matching.find(same) ?? matching[0];
    if (!chosen) {
      conflict(
        'connection-misfit',
        `Rohr ${e.tube.id} lässt sich für die Platten nicht auf Verbindungspunkt ${junctionId} drehen.`,
        [tubeRef(e.tube.id), junctionRef(junctionId)],
      );
    }
    this.links.set(endKey(e), chosen);
  }

  // ------------------------------------------------------------ helpers

  private expectedEndFrame(junction: Quaternion, endpoint: TubeEndpoint): Quaternion {
    const roll = endpoint.roll.mode === 'fixed' ? qaxisAngle(Z, endpoint.roll.radians) : undefined;
    return qmul(junction, roll ? qmul(endpoint.orientation, roll) : endpoint.orientation);
  }

  private endMatches(actual: Quaternion, expected: Quaternion, endpoint: TubeEndpoint): boolean {
    const tol = this.options.tolerance.angleRad;
    if (endpoint.roll.mode === 'fixed') return qangle(qmul(qconj(expected), actual)) <= tol;
    return angleBetween(rotate(actual, Z), rotate(expected, Z)) <= tol;
  }

  /** End-face frames of a tube at an open junction: site +Z points back to the junction. */
  private openEndFrames(junction: Pose, endpoint: TubeEndpoint): Pose[] {
    const into = this.expectedEndFrame(junction.orientation, endpoint);
    const direction = rotate(into, Z);
    const position = add(junction.position, scale(direction, this.armOffset));
    return [{ position, orientation: qmul(into, FLIP_Z) }];
  }

  private junctionOrientationFromTube(tube: TubeIntent, pose: Pose): Quaternion {
    const type = this.tubeTypes.get(tube.id)!;
    const site = endSiteOf(type, 'a');
    const into = qmul(compose(pose, site.frame).orientation, FLIP_Z);
    const roll = tube.a.roll.mode === 'fixed' ? qaxisAngle(Z, tube.a.roll.radians) : { x: 0, y: 0, z: 0, w: 1 };
    return qmul(into, qconj(qmul(tube.a.orientation, roll)));
  }

  private connectionBetween(
    arm: AttachmentSite,
    end: AttachmentSite,
    e: EndRef,
  ): { type: ConnectionType; armIsA: boolean } {
    for (const type of this.catalog.connectionTypes) {
      if (type.aInterfaceId === arm.interfaceId && type.bInterfaceId === end.interfaceId) return { type, armIsA: true };
      if (type.aInterfaceId === end.interfaceId && type.bInterfaceId === arm.interfaceId)
        return { type, armIsA: false };
    }
    return conflict(
      'incompatible-attachment',
      `Keine Verbindungsregel zwischen ${arm.interfaceId} und ${end.interfaceId}.`,
      [tubeRef(e.tube.id), junctionRef(e.tube[e.end].junctionId)],
    );
  }

  /** Discrete parameter sets, the previous choice for this tube end first. */
  private parameterSets(type: ConnectionType, e: EndRef | undefined, connectorTypeId: string): Params[] {
    if (type.kinematics.kind === 'fixed') return [{}];
    let sets: Record<string, number>[] = [{}];
    for (const parameter of type.kinematics.parameters) {
      const values = parameter.domain.kind === 'discrete' ? parameter.domain.values : [parameter.domain.min];
      sets = sets.flatMap((set) => values.map((v) => ({ ...set, [parameter.name]: v })));
    }
    const previous = e && this.previousLinkParameters(e, connectorTypeId);
    if (!previous) return sets;
    const same = (s: Params) => Object.keys(s).every((k) => Math.abs((s[k] ?? NaN) - (previous[k] ?? NaN)) < 1e-9);
    return [...sets.filter(same), ...sets.filter((s) => !same(s))];
  }

  private evaluate(type: ConnectionType, params: Params, e: EndRef): Pose {
    if (type.kinematics.kind === 'fixed') return type.kinematics.bInA;
    const evaluator = this.options.connectionEvaluators?.[type.kinematics.evaluatorKey];
    if (!evaluator) {
      conflict(
        'missing-catalog-data',
        `Für Verbindungen vom Typ ${type.id} fehlt der Auswerter ${type.kinematics.evaluatorKey}.`,
        [tubeRef(e.tube.id)],
        { evaluator: type.kinematics.evaluatorKey },
      );
    }
    return evaluator(params);
  }

  private previousPart(intent: IntentRef, role: string): PartInstance | undefined {
    return this.earlier?.parts.get(partKey(intent, role));
  }

  private previousConnectorRotation(junctionId: JunctionId): Quaternion | undefined {
    const part = this.previousPart({ kind: 'junction', id: junctionId }, 'connector');
    const frame = this.earlier?.junctions.get(junctionId);
    const pose = part && this.earlier?.poses.get(part.id);
    if (!frame || !pose) return undefined;
    const relative = qmul(qconj(frame.orientation), pose.orientation);
    return AXIS_ROTATIONS.find((r) => qangle(qmul(qconj(r), relative)) < 1e-6);
  }

  /** Arm that carried the angle adapter of this tube end before, in the junction frame. */
  private previousAdapterArm(junctionId: JunctionId, e: EndRef): Vector3 | undefined {
    const adapter = this.previousPart({ kind: 'junction', id: junctionId }, `angle-adapter:${e.tube.id}:${e.end}`);
    const connector = this.previousPart({ kind: 'junction', id: junctionId }, 'connector');
    const frame = this.earlier?.junctions.get(junctionId);
    const pose = connector && this.earlier?.poses.get(connector.id);
    const type = connector && this.types.get(connector.typeId);
    if (!adapter || !frame || !pose || !type) return undefined;
    const link = this.earlier?.between.get(pairKey(connector.id, adapter.id))?.[0];
    const siteId = link && (link.a.partId === connector.id ? link.a.siteId : link.b.siteId);
    const site = type.sites.find((s) => s.id === siteId);
    if (!site) return undefined;
    const world = rotate(compose(pose, site.frame).orientation, Z);
    return nearestAxis(rotate(qconj(frame.orientation), world));
  }

  private previousLinkParameters(e: EndRef, connectorTypeId: string): Params | undefined {
    if (!this.earlier) return undefined;
    const tube = this.previousPart({ kind: 'tube', id: e.tube.id }, 'body');
    const connector = this.previousPart({ kind: 'junction', id: e.tube[e.end].junctionId }, 'connector');
    if (!tube || !connector || connector.typeId !== connectorTypeId) return undefined;
    const type = this.types.get(tube.typeId);
    const siteId = type?.kind === 'tube' ? type.ends[e.end] : undefined;
    const link = this.earlier.between
      .get(pairKey(connector.id, tube.id))
      ?.find((c) => (c.b.partId === tube.id ? c.b.siteId : c.a.siteId) === siteId);
    return link?.parameters;
  }

  // ------------------------------------------------------------ output

  /** Connection record with the rule's a/b order; a previous ID is kept. */
  private connection(
    armRef: { partId: PartId; siteId: string },
    arm: AttachmentSite,
    endRef: { partId: PartId; siteId: string },
    end: AttachmentSite,
    parameters: Params,
    e: EndRef,
  ): Connection {
    const { type, armIsA } = this.connectionBetween(arm, end, e);
    const [a, b] = armIsA ? [armRef, endRef] : [endRef, armRef];
    const key = `${a.partId}#${a.siteId}~${b.partId}#${b.siteId}`;
    return { id: this.earlier?.connections.get(key)?.id ?? key, a, b, typeId: type.id, parameters };
  }

  private partId(intent: IntentRef, role: string): PartId {
    return this.previousPart(intent, role)?.id ?? `${intent.kind}:${intent.id}/${role}`;
  }

  private realization(): Realization {
    const parts: PartInstance[] = [];
    const poses: { partId: PartId; worldPose: Pose }[] = [];
    const connections: Connection[] = [];
    for (const [junctionId, choice] of this.connectors) {
      const pose = this.connectorPoses.get(junctionId);
      if (!pose) continue;
      const origin = { intent: { kind: 'junction', id: junctionId } as IntentRef, role: 'connector' };
      const id = this.partId(origin.intent, origin.role);
      parts.push({ id, typeId: choice.type.id, origin });
      poses.push({ partId: id, worldPose: pose });
    }
    for (const [tubeId, type] of this.tubeTypes) {
      const pose = this.tubePoses.get(tubeId);
      if (!pose) continue;
      const origin = { intent: { kind: 'tube', id: tubeId } as IntentRef, role: 'body' };
      const id = this.partId(origin.intent, origin.role);
      parts.push({ id, typeId: type.id, origin });
      poses.push({ partId: id, worldPose: pose });
      for (const end of ['a', 'b'] as const) {
        const e = { tube: this.design.tubes.find((t) => t.id === tubeId)!, end };
        const junctionId = e.tube[end].junctionId;
        const choice = this.connectors.get(junctionId);
        const chain = this.links.get(endKey(e));
        const connectorPose = this.connectorPoses.get(junctionId);
        if (!choice || !chain || !connectorPose) continue;
        const arm = choice.sockets.get(endKey(e))!;
        const endSite = endSiteOf(type, end);
        const connectorId = this.partId({ kind: 'junction', id: junctionId }, 'connector');
        const adapter = this.adapters.get(endKey(e));
        const tubeEnd = { partId: id, siteId: endSite.id };
        if (!adapter) {
          connections.push(
            this.connection({ partId: connectorId, siteId: arm.id }, arm, tubeEnd, endSite, chain.params[0]!, e),
          );
          continue;
        }
        const role = `angle-adapter:${tubeId}:${end}`;
        const adapterId = this.partId({ kind: 'junction', id: junctionId }, role);
        parts.push({
          id: adapterId,
          typeId: adapter.type.id,
          origin: { intent: { kind: 'junction', id: junctionId }, role },
        });
        poses.push({ partId: adapterId, worldPose: compose(connectorPose, chain.adapterInConnector!) });
        connections.push(
          this.connection(
            { partId: connectorId, siteId: arm.id },
            arm,
            { partId: adapterId, siteId: adapter.sleeve.id },
            adapter.sleeve,
            chain.params[0]!,
            e,
          ),
        );
        connections.push(
          this.connection(
            { partId: adapterId, siteId: adapter.spigot.id },
            adapter.spigot,
            tubeEnd,
            endSite,
            chain.params[1]!,
            e,
          ),
        );
      }
    }
    const plateMounts: PlateMountResolution[] = [];
    for (const [plateId, type] of this.plateTypes) {
      const origin = { intent: { kind: 'plate', id: plateId } as IntentRef, role: 'body' };
      const id = this.partId(origin.intent, origin.role);
      parts.push({ id, typeId: type.id, origin });
      poses.push({ partId: id, worldPose: this.platePoses.get(plateId)! });
    }
    for (const fit of this.mountFits) {
      const tube = this.design.tubes.find((t) => t.id === fit.mount.tubeId)!;
      const tubeId = this.partId({ kind: 'tube', id: tube.id }, 'body');
      const plateId = this.partId({ kind: 'plate', id: fit.plate.id }, 'body');
      const site = this.plateTypes.get(fit.plate.id)!.sites.find((s) => s.id === fit.mount.plateSiteId)!;
      const tubeHole = { partId: tubeId, siteId: fit.hole.id };
      const c = this.connection(
        tubeHole,
        fit.hole,
        { partId: plateId, siteId: site.id },
        site,
        { turnRad: fit.turnRad },
        {
          tube,
          end: 'a',
        },
      );
      connections.push(c);
      plateMounts.push({
        plateId: fit.plate.id,
        plateSiteId: site.id,
        tubeId: tube.id,
        tubeHole,
        connectionId: c.id,
      });
    }
    for (const { slide, type, pose, tube, middle, hang, connectionType, params } of this.slides) {
      const origin = { intent: { kind: 'slide', id: slide.id } as IntentRef, role: 'body' };
      const id = this.partId(origin.intent, origin.role);
      parts.push({ id, typeId: type.id, origin });
      poses.push({ partId: id, worldPose: pose });
      const a = { partId: this.partId({ kind: 'tube', id: tube.id }, 'body'), siteId: middle.id };
      const b = { partId: id, siteId: hang.id };
      const key = `${a.partId}#${a.siteId}~${b.partId}#${b.siteId}`;
      connections.push({
        id: this.earlier?.connections.get(key)?.id ?? key,
        a,
        b,
        typeId: connectionType.id,
        parameters: params,
      });
    }
    return {
      parts: parts.sort((x, y) => compare(x.id, y.id)),
      connections: connections.sort((x, y) => compare(x.id, y.id)),
      plateMounts: plateMounts.sort((x, y) => compare(x.plateId, y.plateId) || compare(x.plateSiteId, y.plateSiteId)),
      poses: poses.sort((x, y) => compare(x.partId, y.partId)),
      intentPoses: [...this.junctionPoses]
        .sort(([x], [y]) => compare(x, y))
        .map(([id, worldPose]) => ({ intent: { kind: 'junction', id }, worldPose })),
    };
  }
}

function endSiteOf(type: TubeType, end: TubeEnd): AttachmentSite {
  return type.sites.find((s) => s.id === type.ends[end])!;
}

const AXES: readonly Vector3[] = [
  vec(1, 0, 0),
  vec(-1, 0, 0),
  vec(0, 1, 0),
  vec(0, -1, 0),
  vec(0, 0, 1),
  vec(0, 0, -1),
];

function nearestAxis(d: Vector3): Vector3 {
  return AXES.reduce((best, a) => (dot(a, d) > dot(best, d) ? a : best));
}

function angleBetween(a: Vector3, b: Vector3): number {
  return Math.acos(clamp(dot(a, b) / (length(a) * length(b))));
}

function clamp(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
