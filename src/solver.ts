import type { AttachmentSite, ConnectionType, PartCatalog, PartType, TubeType } from './catalog.js';
import type { RealizationSolver, SolveOptions } from './core.js';
import type { ConstructionDesign, TubeEndpoint, TubeIntent } from './design.js';
import type { Diagnostic, DiagnosticCode, Result, SubjectRef } from './diagnostics.js';
import type { Pose, Quaternion, Vector3 } from './geometry.js';
import type { IntentRef, JunctionId, PartId, TubeEnd, TubeId } from './ids.js';
import {
  AXIS_ROTATIONS, compose, dot, inverse, length, qangle, qaxisAngle, qconj, qmul, rotate, scale, sub, vec, add,
} from './math.js';
import type { Connection, PartInstance, Realization } from './realization.js';

/**
 * First solver stage (SPEC 6): straight and bent tubes on grid junctions with
 * automatically chosen connectors, closed rings and open tube ends. Angle
 * adapters and plates are not realised yet and lead to a conflict.
 */
export const realizationSolver: RealizationSolver = { solve: solveRealization };

const FLIP_Z = qaxisAngle(vec(1, 0, 0), Math.PI);
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

class Conflict extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

function conflict(code: DiagnosticCode, message: string, subjects: readonly SubjectRef[], details?: Diagnostic['details']): never {
  throw new Conflict(details ? { code, severity: 'error', message, subjects, details } : { code, severity: 'error', message, subjects });
}

const tubeRef = (id: TubeId): SubjectRef => ({ kind: 'intent', ref: { kind: 'tube', id } });
const junctionRef = (id: JunctionId): SubjectRef => ({ kind: 'intent', ref: { kind: 'junction', id } });
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
  /** Connection parameters per tube end on a connector. */
  private readonly links = new Map<string, Params>();
  private readonly armOffset: number;

  constructor(
    private readonly design: ConstructionDesign,
    private readonly catalog: PartCatalog,
    private readonly options: SolveOptions,
    private readonly previous?: Realization,
  ) {
    this.types = new Map(catalog.partTypes.map((t) => [t.id, t]));
    const junctions = new Set(design.junctions.map((j) => j.id));
    for (const tube of design.tubes) {
      for (const end of ['a', 'b'] as const) {
        const junctionId = tube[end].junctionId;
        if (!junctions.has(junctionId)) {
          conflict('missing-reference', `Rohr ${tube.id} verweist auf unbekannten Verbindungspunkt ${junctionId}.`, [tubeRef(tube.id)]);
        }
        this.ends.set(junctionId, [...(this.ends.get(junctionId) ?? []), { tube, end }]);
      }
    }
    // Distance from connector centre to arm shoulder, also used for open tube ends.
    const socket = catalog.partTypes.flatMap((t) => (t.kind === 'connector' ? t.sites : [])).find((s) => s.role === 'socket');
    this.armOffset = socket ? length(socket.frame.position) : 0;
  }

  run(): Realization {
    if (this.design.plates.length > 0) {
      conflict('no-realization', 'Platten werden noch nicht realisiert.', this.design.plates.map((p) => ({ kind: 'intent', ref: { kind: 'plate', id: p.id } }) as SubjectRef));
    }
    for (const tube of [...this.design.tubes].sort((a, b) => compare(a.id, b.id))) this.tubeTypes.set(tube.id, this.chooseTubeType(tube));
    for (const junction of [...this.design.junctions].sort((a, b) => compare(a.id, b.id))) this.chooseConnector(junction.id);
    for (const component of this.components()) this.place(component);
    return this.realization();
  }

  // ------------------------------------------------------------ choices

  private chooseTubeType(tube: TubeIntent): TubeType {
    const family = this.catalog.partTypes.filter((t): t is TubeType => t.kind === 'tube' && t.familyId === tube.familyId);
    const variant = tube.variant;
    if (variant.mode === 'fixed') {
      const fixed = family.find((t) => t.id === variant.typeId);
      if (!fixed) {
        conflict('fixed-variant-conflict', `Fixierte Variante ${variant.typeId} gehört nicht zur Familie ${tube.familyId}.`, [tubeRef(tube.id)]);
      }
      return fixed;
    }
    const previousType = this.previousPart({ kind: 'tube', id: tube.id }, 'body')?.typeId;
    const preferred = variant.preferredTypeId;
    const ranked = [...family].sort((a, b) =>
      Number(b.id === previousType) - Number(a.id === previousType)
      || Number(b.id === preferred) - Number(a.id === preferred)
      || Number(b.standardVariant) - Number(a.standardVariant)
      || compare(a.id, b.id));
    const chosen = ranked[0];
    if (!chosen) conflict('no-realization', `Keine Rohre der Familie ${tube.familyId} im Katalog.`, [tubeRef(tube.id)]);
    return chosen;
  }

  /** Auto connector: exact arm count preferred, previous type and rotation kept when valid. */
  private chooseConnector(junctionId: JunctionId): void {
    const ends = this.ends.get(junctionId) ?? [];
    if (ends.length < 2) return;
    const tol = this.options.tolerance.angleRad;
    const directions = ends.map((e) => {
      const d = rotate(e.tube[e.end].orientation, Z);
      const axis = nearestAxis(d);
      if (Math.acos(clamp(dot(d, axis))) > tol) {
        conflict('junction-angle-unsupported',
          `Rohr ${e.tube.id} trifft nicht achsparallel auf Verbindungspunkt ${junctionId}; Winkelkupplungen werden noch nicht gewählt.`,
          [junctionRef(junctionId), tubeRef(e.tube.id)], { deviationDeg: round(deg(Math.acos(clamp(dot(d, axis))))) });
      }
      return axis;
    });
    const previousPart = this.previousPart({ kind: 'junction', id: junctionId }, 'connector');
    const previousRotation = this.previousConnectorRotation(junctionId);
    const candidates = this.catalog.partTypes
      .filter((t) => t.kind === 'connector')
      .map((t) => ({ type: t, sockets: t.sites.filter((s) => s.role === 'socket') }))
      .filter((c) => c.sockets.length >= ends.length)
      .sort((a, b) => Number(b.type.id === previousPart?.typeId) - Number(a.type.id === previousPart?.typeId)
        || a.sockets.length - b.sockets.length || compare(a.type.id, b.type.id));
    for (const candidate of candidates) {
      const rotations = previousRotation && candidate.type.id === previousPart?.typeId
        ? [previousRotation, ...AXIS_ROTATIONS] : AXIS_ROTATIONS;
      for (const rotation of rotations) {
        const assignment = new Map<string, AttachmentSite>();
        const used = new Set<string>();
        for (const [i, d] of directions.entries()) {
          const socket = candidate.sockets.find((s) => !used.has(s.id)
            && dot(rotate(qmul(rotation, s.frame.orientation), Z), d) > 1 - 1e-9);
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
    conflict('junction-angle-unsupported', `Keine Kupplung für die Rohrrichtungen an Verbindungspunkt ${junctionId}.`,
      [junctionRef(junctionId), ...ends.map((e) => tubeRef(e.tube.id))], { tubes: ends.length });
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
          if (!seen.has(other)) { seen.add(other); queue.push(other); }
        }
      }
      result.push({ junctions, tubes: [...tubes].sort(compare) });
    }
    return result;
  }

  private place(component: { readonly junctions: JunctionId[]; readonly tubes: TubeId[] }): void {
    const inside = (ref: IntentRef) => (ref.kind === 'junction' ? component.junctions.includes(ref.id)
      : ref.kind === 'tube' ? component.tubes.includes(ref.id) : false);
    const anchors = this.design.anchors.filter((a) => inside(a.target));
    if (anchors.length !== 1) {
      if (component.tubes.length === 0 && anchors.length === 0) return;
      conflict('unresolved-placement', anchors.length === 0 ? 'Baugruppe hat keinen Anker.' : 'Baugruppe hat mehrere Anker.',
        component.junctions.map(junctionRef));
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
    if (choice) this.connectorPoses.set(junctionId, { position: frame.position, orientation: qmul(frame.orientation, choice.rotation) });
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
      const actualEnd = compose(pose, { position: endSite.frame.position, orientation: qmul(endSite.frame.orientation, FLIP_Z) });
      const other = compose(pose, endSiteOf(type, otherEnd).frame);
      // The other end leaves its junction pointing into the tube: site +Z points out.
      const otherInto = scale(rotate(other.orientation, Z), -1);
      return this.endMatches(actualEnd.orientation, expectedEnd, endpoint) && angleBetween(otherInto, otherDirection) <= this.options.tolerance.angleRad;
    });
    const chosen = fitting[0];
    if (!chosen) {
      conflict('connection-misfit', `Rohr ${e.tube.id} lässt sich an Verbindungspunkt ${endpoint.junctionId} nicht in der gewünschten Lage anschließen.`,
        [tubeRef(e.tube.id), junctionRef(endpoint.junctionId)]);
    }
    this.tubePoses.set(e.tube.id, chosen.pose);
    if (chosen.params) this.links.set(endKey(e), chosen.params);
  }

  /** Candidate tube poses from the junction end, previous parameters first. */
  private tubeCandidates(e: EndRef, junction: Pose, type: TubeType): { pose: Pose; params?: Params }[] {
    const endSite = endSiteOf(type, e.end);
    const choice = this.connectors.get(e.tube[e.end].junctionId);
    const connectorPose = this.connectorPoses.get(e.tube[e.end].junctionId);
    if (!choice || !connectorPose) {
      // Open end: the end face sits one arm length from the junction point.
      const frames = this.openEndFrames(junction, e.tube[e.end]);
      return frames.map((frame) => ({ pose: compose(frame, inverse(endSite.frame)) }));
    }
    const arm = choice.sockets.get(endKey(e))!;
    const { type: connection, armIsA } = this.connectionBetween(arm, endSite, e);
    return this.parameterSets(connection, e, choice.type.id).map((params) => {
      const relative = this.evaluate(connection, params, e);
      const armWorld = compose(connectorPose, arm.frame);
      const endWorld = armIsA ? compose(armWorld, relative) : compose(armWorld, inverse(relative));
      return { pose: compose(endWorld, inverse(endSite.frame)), params };
    });
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
        conflict('loop-closure-conflict', `Rohr ${tube.id} erreicht Verbindungspunkt ${junctionId} nicht.`,
          [tubeRef(tube.id), junctionRef(junctionId)], { offsetMm: round(length(sub(existing.position, centre))) });
      }
      if (!existing) this.placeJunction(junctionId, { position: centre, orientation });
      return;
    }
    if (this.links.has(endKey(e))) return;
    const arm = choice.sockets.get(endKey(e))!;
    const { type: connection, armIsA } = this.connectionBetween(arm, endSite, e);
    const expectedOrientation = qmul(orientation, choice.rotation);
    const existing = this.connectorPoses.get(junctionId);
    let closest = Infinity;
    for (const params of this.parameterSets(connection, e, choice.type.id)) {
      const relative = this.evaluate(connection, params, e);
      const armWorld = armIsA ? compose(endWorld, inverse(relative)) : compose(endWorld, relative);
      const connectorPose = compose(armWorld, inverse(arm.frame));
      const turn = qangle(qmul(qconj(expectedOrientation), connectorPose.orientation));
      if (turn > tol.angleRad) continue;
      if (existing) {
        const offset = length(sub(existing.position, connectorPose.position));
        closest = Math.min(closest, offset);
        if (offset > tol.distanceMm) continue;
      } else {
        this.placeJunction(junctionId, { position: connectorPose.position, orientation });
      }
      this.links.set(endKey(e), params);
      return;
    }
    if (existing && Number.isFinite(closest)) {
      conflict('loop-closure-conflict', `Ring über Rohr ${tube.id} schließt an Verbindungspunkt ${junctionId} nicht.`,
        [tubeRef(tube.id), junctionRef(junctionId)], { offsetMm: round(closest) });
    }
    conflict('connection-misfit', `Rohr ${tube.id} trifft verdreht auf die Kupplung an Verbindungspunkt ${junctionId}.`,
      [tubeRef(tube.id), junctionRef(junctionId)]);
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

  private connectionBetween(arm: AttachmentSite, end: AttachmentSite, e: EndRef): { type: ConnectionType; armIsA: boolean } {
    for (const type of this.catalog.connectionTypes) {
      if (type.aInterfaceId === arm.interfaceId && type.bInterfaceId === end.interfaceId) return { type, armIsA: true };
      if (type.aInterfaceId === end.interfaceId && type.bInterfaceId === arm.interfaceId) return { type, armIsA: false };
    }
    return conflict('incompatible-attachment', `Keine Verbindungsregel zwischen ${arm.interfaceId} und ${end.interfaceId}.`,
      [tubeRef(e.tube.id), junctionRef(e.tube[e.end].junctionId)]);
  }

  /** Discrete parameter sets, the previous choice for this tube end first. */
  private parameterSets(type: ConnectionType, e: EndRef, connectorTypeId: string): Params[] {
    if (type.kinematics.kind === 'fixed') return [{}];
    let sets: Record<string, number>[] = [{}];
    for (const parameter of type.kinematics.parameters) {
      const values = parameter.domain.kind === 'discrete' ? parameter.domain.values : [parameter.domain.min];
      sets = sets.flatMap((set) => values.map((v) => ({ ...set, [parameter.name]: v })));
    }
    const previous = this.previousLinkParameters(e, connectorTypeId);
    if (!previous) return sets;
    const same = (s: Params) => Object.keys(s).every((k) => Math.abs((s[k] ?? NaN) - (previous[k] ?? NaN)) < 1e-9);
    return [...sets.filter(same), ...sets.filter((s) => !same(s))];
  }

  private evaluate(type: ConnectionType, params: Params, e: EndRef): Pose {
    if (type.kinematics.kind === 'fixed') return type.kinematics.bInA;
    const evaluator = this.options.connectionEvaluators?.[type.kinematics.evaluatorKey];
    if (!evaluator) {
      conflict('missing-catalog-data', `Für Verbindungen vom Typ ${type.id} fehlt der Auswerter ${type.kinematics.evaluatorKey}.`,
        [tubeRef(e.tube.id)], { evaluator: type.kinematics.evaluatorKey });
    }
    return evaluator(params);
  }

  private previousPart(intent: IntentRef, role: string): PartInstance | undefined {
    return this.previous?.parts.find((p) => p.origin.intent.kind === intent.kind && p.origin.intent.id === intent.id && p.origin.role === role);
  }

  private previousConnectorRotation(junctionId: JunctionId): Quaternion | undefined {
    const part = this.previousPart({ kind: 'junction', id: junctionId }, 'connector');
    const frame = this.previous?.intentPoses.find((p) => p.intent.kind === 'junction' && p.intent.id === junctionId)?.worldPose;
    const pose = part && this.previous?.poses.find((p) => p.partId === part.id)?.worldPose;
    if (!frame || !pose) return undefined;
    const relative = qmul(qconj(frame.orientation), pose.orientation);
    return AXIS_ROTATIONS.find((r) => qangle(qmul(qconj(r), relative)) < 1e-6);
  }

  private previousLinkParameters(e: EndRef, connectorTypeId: string): Params | undefined {
    if (!this.previous) return undefined;
    const tube = this.previousPart({ kind: 'tube', id: e.tube.id }, 'body');
    const connector = this.previousPart({ kind: 'junction', id: e.tube[e.end].junctionId }, 'connector');
    if (!tube || !connector || connector.typeId !== connectorTypeId) return undefined;
    const type = this.types.get(tube.typeId);
    const siteId = type?.kind === 'tube' ? type.ends[e.end] : undefined;
    const link = this.previous.connections.find((c) =>
      (c.a.partId === connector.id && c.b.partId === tube.id && c.b.siteId === siteId)
      || (c.b.partId === connector.id && c.a.partId === tube.id && c.a.siteId === siteId));
    return link?.parameters;
  }

  // ------------------------------------------------------------ output

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
        const choice = this.connectors.get(e.tube[end].junctionId);
        const params = this.links.get(endKey(e));
        if (!choice || !params) continue;
        const arm = choice.sockets.get(endKey(e))!;
        const endSite = endSiteOf(type, end);
        const { type: connection, armIsA } = this.connectionBetween(arm, endSite, e);
        const connectorId = this.partId({ kind: 'junction', id: e.tube[end].junctionId }, 'connector');
        const armRef = { partId: connectorId, siteId: arm.id };
        const endRef = { partId: id, siteId: endSite.id };
        const [a, b] = armIsA ? [armRef, endRef] : [endRef, armRef];
        const previousId = this.previous?.connections.find((c) =>
          c.a.partId === a.partId && c.a.siteId === a.siteId && c.b.partId === b.partId && c.b.siteId === b.siteId)?.id;
        connections.push({ id: previousId ?? `${a.partId}#${a.siteId}~${b.partId}#${b.siteId}`, a, b, typeId: connection.id, parameters: params });
      }
    }
    return {
      parts: parts.sort((x, y) => compare(x.id, y.id)),
      connections: connections.sort((x, y) => compare(x.id, y.id)),
      plateMounts: [],
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

function nearestAxis(d: Vector3): Vector3 {
  const axes = [vec(1, 0, 0), vec(-1, 0, 0), vec(0, 1, 0), vec(0, -1, 0), vec(0, 0, 1), vec(0, 0, -1)];
  return axes.reduce((best, a) => (dot(a, d) > dot(best, d) ? a : best));
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
