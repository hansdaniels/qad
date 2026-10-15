import type {
  BuildabilityChecker, BuildabilityFinding, BuildabilityOptions, BuildabilityReport,
  CheckStage, ClosureResidual, CollisionGeometryProvider, EditContext,
} from './buildability.js';
import type { AttachmentSite, ConnectionType, PartCatalog, PartType, TubeType } from './catalog.js';
import type { ConstructionSnapshot } from './core.js';
import type { Diagnostic, DiagnosticCode, SubjectRef } from './diagnostics.js';
import type { GeometryRef, GeometryTolerance, Pose, Quaternion, Vector3 } from './geometry.js';
import type { ConnectionId, IntentRef, PartId } from './ids.js';
import {
  AXIS_ROTATIONS, compose, cross, dot, inverse, qangle, qaxisAngle, qconj, qmul, qnorm, rotate,
  sub, length, tiltTwist, transformPoint, vec,
} from './math.js';
import type { Connection, PartInstance } from './realization.js';
import { containsPoint, segmentParameters, separation, toWorld, type WorldShape } from './collision.js';

const STAGES: readonly CheckStage[] = ['structure', 'closure', 'junction-angles', 'collision', 'plate-mounts'];
const FLIP_Z = qaxisAngle(vec(1, 0, 0), Math.PI);
const NORM_TOLERANCE = 1e-6;

/** Agreed default tolerances: 1 mm and 1°. */
export const DEFAULT_TOLERANCE: GeometryTolerance = { distanceMm: 1, angleRad: Math.PI / 180 };

/** Reported as missing data while plate mounts (stage 5) are not checked. */
export const PLATE_MOUNTS_PENDING: GeometryRef = { key: 'stage:plate-mounts' };

/** Role of the part that realises a junction at its logical point (SPEC 3.2). */
export const CONNECTOR_ROLE = 'connector';
/** Role of the part that realises a tube or plate intent as a whole. */
export const BODY_ROLE = 'body';

interface Context {
  readonly snapshot: ConstructionSnapshot;
  readonly catalog: PartCatalog;
  readonly options: BuildabilityOptions;
  readonly findings: BuildabilityFinding[];
  readonly missing: Map<string, GeometryRef>;
  readonly types: Map<string, PartType>;
  readonly connectionTypes: Map<string, ConnectionType>;
  readonly parts: Map<PartId, PartInstance>;
  /** Parts and connections that failed structure checks; their components are skipped. */
  readonly brokenParts: Set<PartId>;
  readonly brokenConnections: Set<ConnectionId>;
  readonly brokenAnchors: Set<string>;
  /** Poses recomputed in stage 2. */
  readonly poses: Map<PartId, Pose>;
  /** Parts of components that failed stage 2; later stages skip them. */
  readonly failedParts: Set<PartId>;
}

export const buildabilityChecker: BuildabilityChecker = { check: checkBuildability };

/**
 * Read-only verification of a snapshot (BAUBARKEIT.md). Stages 1 to 4 are
 * implemented. Plate mounts (stage 5) follow once the drilling data is known;
 * until then a design with plates is undetermined, never buildable.
 */
export function checkBuildability(
  snapshot: ConstructionSnapshot,
  catalog: PartCatalog,
  geometry: CollisionGeometryProvider,
  options: BuildabilityOptions,
  edit?: EditContext,
): BuildabilityReport {
  const ctx: Context = {
    snapshot, catalog, options,
    findings: [],
    missing: new Map(),
    types: new Map(catalog.partTypes.map((t) => [t.id, t])),
    connectionTypes: new Map(catalog.connectionTypes.map((t) => [t.id, t])),
    parts: new Map(snapshot.realization.parts.map((p) => [p.id, p])),
    brokenParts: new Set(),
    brokenConnections: new Set(),
    brokenAnchors: new Set(),
    poses: new Map(),
    failedParts: new Set(),
  };
  const components = checkStructure(ctx);
  let cycles = 0;
  for (const component of components) cycles += checkClosure(ctx, component, edit);
  checkDesignAgreement(ctx);
  checkJunctionAngles(ctx);
  const collisionPairsTested = checkCollisions(ctx, geometry, edit);
  // Stage 5 needs the tube drilling patterns; until then plates cannot be confirmed.
  if (snapshot.design.plates.length > 0) ctx.missing.set(PLATE_MOUNTS_PENDING.key, PLATE_MOUNTS_PENDING);

  const findings = sortFindings(ctx.findings);
  const hasError = findings.some((f) => f.diagnostic.severity === 'error');
  return {
    verdict: hasError ? 'not-buildable' : ctx.missing.size > 0 ? 'undetermined' : 'buildable',
    findings,
    missingCatalogData: [...ctx.missing.values()].sort((a, b) => compareIds(a.key, b.key)),
    stats: {
      parts: snapshot.realization.parts.length,
      connections: snapshot.realization.connections.length,
      cycles,
      collisionPairsTested,
    },
  };
}

// ---------------------------------------------------------------- findings

function report(
  ctx: Context, stage: CheckStage, code: DiagnosticCode, message: string,
  subjects: readonly SubjectRef[], details?: Diagnostic['details'], closure?: ClosureResidual,
): void {
  const diagnostic: Diagnostic = details
    ? { code, severity: code === 'clearance' ? 'warning' : 'error', message, subjects, details }
    : { code, severity: code === 'clearance' ? 'warning' : 'error', message, subjects };
  ctx.findings.push(closure ? { stage, diagnostic, closure, remedies: [] } : { stage, diagnostic, remedies: [] });
}

const part = (id: PartId): SubjectRef => ({ kind: 'part', id });
const connection = (id: ConnectionId): SubjectRef => ({ kind: 'connection', id });
const intent = (ref: IntentRef): SubjectRef => ({ kind: 'intent', ref });

function subjectKey(s: SubjectRef): string {
  switch (s.kind) {
    case 'part': return `part:${s.id}`;
    case 'connection': return `connection:${s.id}`;
    case 'intent': return `intent:${s.ref.kind}:${s.ref.id}`;
    case 'attachment': return `attachment:${s.ref.partId}:${s.ref.siteId}`;
  }
}

function sortFindings(findings: BuildabilityFinding[]): BuildabilityFinding[] {
  const key = (f: BuildabilityFinding) => f.diagnostic.subjects.map(subjectKey).join('|');
  return [...findings].sort((a, b) =>
    STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || compareIds(key(a), key(b))
    || compareIds(a.diagnostic.code, b.diagnostic.code));
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------- stage 1

function checkStructure(ctx: Context): readonly Component[] {
  const { snapshot: { design, realization }, catalog } = ctx;
  const stage = 'structure';

  if (design.catalog.id !== catalog.ref.id || design.catalog.version !== catalog.ref.version) {
    report(ctx, stage, 'catalog-mismatch', 'Katalog des Modells passt nicht zum geladenen Katalog.', [], {
      expected: `${catalog.ref.id}@${catalog.ref.version}`, actual: `${design.catalog.id}@${design.catalog.version}`,
    });
  }

  const duplicates = (kind: string, ids: readonly string[], subject: (id: string) => SubjectRef) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) report(ctx, stage, 'duplicate-id', `Doppelte ID ${id} (${kind}).`, [subject(id)]);
      seen.add(id);
    }
  };
  duplicates('Rohr', design.tubes.map((t) => t.id), (id) => intent({ kind: 'tube', id }));
  duplicates('Verbindungspunkt', design.junctions.map((j) => j.id), (id) => intent({ kind: 'junction', id }));
  duplicates('Platte', design.plates.map((p) => p.id), (id) => intent({ kind: 'plate', id }));
  const anchorIds = new Set<string>();
  for (const anchor of design.anchors) {
    if (anchorIds.has(anchor.id)) report(ctx, stage, 'duplicate-id', `Doppelte ID ${anchor.id} (Anker).`, [intent(anchor.target)]);
    anchorIds.add(anchor.id);
  }
  duplicates('Teil', realization.parts.map((p) => p.id), part);
  duplicates('Verbindung', realization.connections.map((c) => c.id), connection);

  const junctions = new Set(design.junctions.map((j) => j.id));
  const exists = (ref: IntentRef) =>
    ref.kind === 'junction' ? junctions.has(ref.id)
      : ref.kind === 'tube' ? design.tubes.some((t) => t.id === ref.id)
        : design.plates.some((p) => p.id === ref.id);

  for (const tube of design.tubes) {
    for (const end of [tube.a, tube.b]) {
      if (!junctions.has(end.junctionId)) {
        report(ctx, stage, 'missing-reference', `Rohr ${tube.id} verweist auf unbekannten Verbindungspunkt ${end.junctionId}.`,
          [intent({ kind: 'tube', id: tube.id })]);
      }
      checkQuaternion(ctx, end.orientation, [intent({ kind: 'tube', id: tube.id })]);
    }
  }
  for (const anchor of design.anchors) {
    if (!exists(anchor.target)) {
      report(ctx, stage, 'missing-reference', `Anker ${anchor.id} verweist auf ein unbekanntes Objekt.`, [intent(anchor.target)]);
    }
    if (!checkPose(ctx, anchor.worldPose, [intent(anchor.target)])) ctx.brokenAnchors.add(anchor.id);
  }

  for (const p of realization.parts) {
    if (!ctx.types.has(p.typeId)) {
      report(ctx, stage, 'missing-reference', `Teil ${p.id} hat unbekannten Typ ${p.typeId}.`, [part(p.id)]);
      ctx.brokenParts.add(p.id);
    }
    if (!exists(p.origin.intent)) {
      report(ctx, stage, 'missing-reference', `Teil ${p.id} gehört zu einem unbekannten Objekt.`, [part(p.id)]);
      ctx.brokenParts.add(p.id);
    }
  }
  for (const p of realization.poses) {
    if (!ctx.parts.has(p.partId)) {
      report(ctx, stage, 'missing-reference', `Lage für unbekanntes Teil ${p.partId}.`, [part(p.partId)]);
    }
    checkPose(ctx, p.worldPose, [part(p.partId)]);
  }
  for (const p of realization.intentPoses) checkPose(ctx, p.worldPose, [intent(p.intent)]);

  checkConnections(ctx);
  checkDuplicateTubes(ctx);
  return buildComponents(ctx);
}

/** Reports and returns false for non-finite positions or non-unit orientations. */
function checkPose(ctx: Context, pose: Pose, subjects: readonly SubjectRef[]): boolean {
  const { x, y, z } = pose.position;
  const finite = [x, y, z].every(Number.isFinite);
  if (!finite) report(ctx, 'structure', 'invalid-data', 'Position enthält ungültige Zahlen.', subjects);
  return checkQuaternion(ctx, pose.orientation, subjects) && finite;
}

function checkQuaternion(ctx: Context, q: Quaternion, subjects: readonly SubjectRef[]): boolean {
  const n = qnorm(q);
  const unit = Number.isFinite(n) && Math.abs(n - 1) <= NORM_TOLERANCE;
  if (!unit) report(ctx, 'structure', 'invalid-data', 'Orientierung ist kein Einheitsquaternion.', subjects, { norm: n });
  return unit;
}

function site(ctx: Context, partId: PartId, siteId: string): AttachmentSite | undefined {
  const p = ctx.parts.get(partId);
  return p && ctx.types.get(p.typeId)?.sites.find((s) => s.id === siteId);
}

function checkConnections(ctx: Context): void {
  const stage = 'structure';
  const occupancy = new Map<string, { site: AttachmentSite; refs: ConnectionId[] }>();
  const pairs = new Map<string, ConnectionId>();
  for (const c of ctx.snapshot.realization.connections) {
    const broken = () => ctx.brokenConnections.add(c.id);
    const type = ctx.connectionTypes.get(c.typeId);
    if (!type) {
      report(ctx, stage, 'missing-reference', `Verbindung ${c.id} hat unbekannten Typ ${c.typeId}.`, [connection(c.id)]);
      broken();
    }
    for (const [side, ref] of [['a', c.a], ['b', c.b]] as const) {
      if (!ctx.parts.has(ref.partId)) {
        report(ctx, stage, 'missing-reference', `Verbindung ${c.id} verweist auf unbekanntes Teil ${ref.partId}.`, [connection(c.id)]);
        broken();
        continue;
      }
      const s = site(ctx, ref.partId, ref.siteId);
      if (!s) {
        if (!ctx.brokenParts.has(ref.partId)) {
          report(ctx, stage, 'missing-reference', `Teil ${ref.partId} hat keine Anschlussstelle ${ref.siteId}.`,
            [connection(c.id), { kind: 'attachment', ref }]);
        }
        broken();
        continue;
      }
      if (type && s.interfaceId !== (side === 'a' ? type.aInterfaceId : type.bInterfaceId)) {
        report(ctx, stage, 'incompatible-attachment',
          `Anschluss ${ref.partId}/${ref.siteId} passt nicht zur Verbindung ${c.id}.`,
          [connection(c.id), { kind: 'attachment', ref }],
          { expected: side === 'a' ? type.aInterfaceId : type.bInterfaceId, actual: s.interfaceId });
        broken();
      }
      const key = `${ref.partId}\u0000${ref.siteId}`;
      const entry = occupancy.get(key) ?? { site: s, refs: [] };
      entry.refs.push(c.id);
      occupancy.set(key, entry);
    }
    if (type) checkParameters(ctx, c, type);
    const ends = [`${c.a.partId}\u0000${c.a.siteId}`, `${c.b.partId}\u0000${c.b.siteId}`].sort().join('\u0001');
    const previous = pairs.get(ends);
    if (previous !== undefined) {
      report(ctx, stage, 'duplicate-member', `Verbindung ${c.id} verbindet dieselben Stellen wie ${previous}.`,
        [connection(previous), connection(c.id)]);
      broken();
    } else {
      pairs.set(ends, c.id);
    }
  }
  for (const [key, { site: s, refs }] of occupancy) {
    if (refs.length > s.capacity) {
      const [partId = '', siteId = ''] = key.split('\u0000');
      report(ctx, stage, 'attachment-occupied', `Anschluss ${partId}/${siteId} ist mehrfach belegt.`,
        [{ kind: 'attachment', ref: { partId, siteId } }, ...refs.map(connection)],
        { capacity: s.capacity, used: refs.length });
      for (const id of refs) ctx.brokenConnections.add(id);
    }
  }
}

function checkParameters(ctx: Context, c: Connection, type: ConnectionType): void {
  const declared = type.kinematics.kind === 'parametric' ? type.kinematics.parameters : [];
  for (const name of Object.keys(c.parameters)) {
    if (!declared.some((p) => p.name === name)) {
      report(ctx, 'structure', 'invalid-data', `Verbindung ${c.id} hat unbekannten Parameter ${name}.`, [connection(c.id)]);
      ctx.brokenConnections.add(c.id);
    }
  }
  for (const p of declared) {
    const value = c.parameters[p.name];
    const inDomain = value !== undefined && Number.isFinite(value) && (p.domain.kind === 'interval'
      ? value >= p.domain.min && value <= p.domain.max
      : p.domain.values.some((v) => Math.abs(v - value) <= 1e-9));
    if (!inDomain) {
      report(ctx, 'structure', 'invalid-data', `Parameter ${p.name} der Verbindung ${c.id} fehlt oder liegt außerhalb des Wertebereichs.`,
        [connection(c.id)], value === undefined ? { parameter: p.name } : { parameter: p.name, value });
      ctx.brokenConnections.add(c.id);
    }
  }
}

function checkDuplicateTubes(ctx: Context): void {
  const tubes = ctx.snapshot.design.tubes;
  const tol = ctx.options.tolerance.angleRad;
  for (let i = 0; i < tubes.length; i++) {
    for (let j = i + 1; j < tubes.length; j++) {
      const s = tubes[i]!;
      const t = tubes[j]!;
      const same = (x: typeof s.a, y: typeof s.a) => x.junctionId === y.junctionId
        && Math.acos(clamp(dotZ(x.orientation, y.orientation))) <= tol;
      if ((same(s.a, t.a) && same(s.b, t.b)) || (same(s.a, t.b) && same(s.b, t.a))) {
        report(ctx, 'structure', 'duplicate-member', `Rohre ${s.id} und ${t.id} liegen doppelt zwischen denselben Verbindungspunkten.`,
          [intent({ kind: 'tube', id: s.id }), intent({ kind: 'tube', id: t.id })]);
      }
    }
  }
}

function dotZ(a: Quaternion, b: Quaternion): number {
  const za = rotate(a, vec(0, 0, 1));
  const zb = rotate(b, vec(0, 0, 1));
  return za.x * zb.x + za.y * zb.y + za.z * zb.z;
}

function clamp(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

// ---------------------------------------------------------------- components and anchors

interface Component {
  readonly parts: readonly PartId[];
  /** Structurally valid connections only. */
  readonly connections: readonly Connection[];
  /** A part or connection failed stage 1; later stages skip the component. */
  readonly broken: boolean;
  readonly root?: { readonly partId: PartId; readonly pose: Pose };
}

function primaryPart(ctx: Context, target: IntentRef): PartInstance | undefined {
  const role = target.kind === 'junction' ? CONNECTOR_ROLE : BODY_ROLE;
  const candidates = ctx.snapshot.realization.parts
    .filter((p) => p.origin.intent.kind === target.kind && p.origin.intent.id === target.id)
    .sort((a, b) => Number(b.origin.role === role) - Number(a.origin.role === role) || compareIds(a.id, b.id));
  return candidates[0];
}

function buildComponents(ctx: Context): Component[] {
  const { realization, design } = ctx.snapshot;
  const parent = new Map<PartId, PartId>(realization.parts.map((p) => [p.id, p.id]));
  const find = (x: PartId): PartId => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const linking = realization.connections.filter((c) => ctx.parts.has(c.a.partId) && ctx.parts.has(c.b.partId));
  for (const c of linking) {
    const a = find(c.a.partId);
    const b = find(c.b.partId);
    if (a !== b) parent.set(compareIds(a, b) < 0 ? b : a, compareIds(a, b) < 0 ? a : b);
  }
  const groups = new Map<PartId, PartId[]>();
  for (const p of [...realization.parts].sort((a, b) => compareIds(a.id, b.id))) {
    const r = find(p.id);
    groups.set(r, [...(groups.get(r) ?? []), p.id]);
  }

  const anchorsByRoot = new Map<PartId, { anchorId: string; partId: PartId; pose: Pose; broken: boolean }[]>();
  for (const anchor of design.anchors) {
    const p = primaryPart(ctx, anchor.target);
    if (!p) {
      report(ctx, 'structure', 'unresolved-placement', `Anker ${anchor.id} trifft kein realisiertes Teil.`, [intent(anchor.target)]);
      continue;
    }
    const pose = anchorPose(ctx, anchor.target, anchor.worldPose, p);
    const r = find(p.id);
    anchorsByRoot.set(r, [...(anchorsByRoot.get(r) ?? []), { anchorId: anchor.id, partId: p.id, pose, broken: ctx.brokenAnchors.has(anchor.id) }]);
  }

  const components: Component[] = [];
  for (const [r, members] of groups) {
    const anchors = anchorsByRoot.get(r) ?? [];
    const memberSet = new Set(members);
    const inside = linking.filter((c) => memberSet.has(c.a.partId)).sort((a, b) => compareIds(a.id, b.id));
    const connections = inside.filter((c) => !ctx.brokenConnections.has(c.id));
    const broken = members.some((m) => ctx.brokenParts.has(m)) || connections.length < inside.length;
    if (anchors.length !== 1) {
      report(ctx, 'structure', anchors.length === 0 ? 'unresolved-placement' : 'duplicate-member',
        anchors.length === 0 ? 'Baugruppe hat keinen Anker.' : 'Baugruppe hat mehrere Anker.',
        members.map(part), { anchors: anchors.map((a) => a.anchorId).join(',') });
      components.push({ parts: members, connections, broken });
      continue;
    }
    const [anchor] = anchors;
    components.push({ parts: members, connections, broken: broken || anchor!.broken, root: { partId: anchor!.partId, pose: anchor!.pose } });
  }
  // The anchor's component first, then by smallest part ID.
  return components.sort((a, b) => Number(!a.root) - Number(!b.root) || compareIds(a.parts[0] ?? '', b.parts[0] ?? ''));
}

/**
 * Pose of the anchored part. Tubes and plates: their body frame is the intent
 * frame. Junctions: the connector sits on the junction point, turned by the axis
 * rotation chosen in the realization (snapped, not trusted continuously).
 */
function anchorPose(ctx: Context, target: IntentRef, world: Pose, p: PartInstance): Pose {
  if (target.kind !== 'junction' || p.origin.role !== CONNECTOR_ROLE) return world;
  const stored = ctx.snapshot.realization.poses.find((x) => x.partId === p.id)?.worldPose;
  if (!stored) return world;
  const relative = qmul(qconj(world.orientation), stored.orientation);
  return { position: world.position, orientation: qmul(world.orientation, nearestAxisRotation(relative).rotation) };
}

function nearestAxisRotation(q: Quaternion): { rotation: Quaternion; angle: number } {
  let best = { rotation: AXIS_ROTATIONS[0]!, angle: Infinity };
  for (const r of AXIS_ROTATIONS) {
    const angle = qangle(qmul(qconj(r), q));
    if (angle < best.angle) best = { rotation: r, angle };
  }
  return best;
}

// ---------------------------------------------------------------- stage 2

/** Relative frame of site b in site a, or undefined when catalog data is missing. */
function bInA(ctx: Context, c: Connection): Pose | undefined {
  const type = ctx.connectionTypes.get(c.typeId)!;
  if (type.kinematics.kind === 'fixed') return type.kinematics.bInA;
  const evaluator = ctx.options.connectionEvaluators?.[type.kinematics.evaluatorKey];
  if (!evaluator) {
    const key = `evaluator:${type.kinematics.evaluatorKey}`;
    ctx.missing.set(key, { key });
    return undefined;
  }
  return evaluator(c.parameters);
}

/** Poses of the component, or undefined when it cannot be placed. Returns closed cycles. */
function checkClosure(ctx: Context, component: Component, edit?: EditContext): number {
  if (!component.root || component.broken) return 0;
  const before = ctx.findings.length;

  const deferred = new Set(edit?.addedConnectionIds ?? []);
  const adjacency = new Map<PartId, Connection[]>();
  for (const c of component.connections) {
    adjacency.set(c.a.partId, [...(adjacency.get(c.a.partId) ?? []), c]);
    adjacency.set(c.b.partId, [...(adjacency.get(c.b.partId) ?? []), c]);
  }

  // Spanning forest without the deferred edges, by ascending IDs, root first.
  const tree = new Set<ConnectionId>();
  const visited = new Set<PartId>();
  const treeOf = new Map<PartId, PartId>();
  const starts = [component.root.partId, ...component.parts.filter((p) => p !== component.root!.partId)];
  for (const start of starts) {
    if (visited.has(start)) continue;
    visited.add(start);
    treeOf.set(start, start);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const c of adjacency.get(current) ?? []) {
        if (deferred.has(c.id)) continue;
        const other = c.a.partId === current ? c.b.partId : c.a.partId;
        if (visited.has(other)) continue;
        visited.add(other);
        treeOf.set(other, start);
        tree.add(c.id);
        queue.push(other);
      }
    }
  }
  const parent = new Map(treeOf);
  const find = (x: PartId): PartId => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const c of component.connections.filter((x) => deferred.has(x.id))) {
    const a = find(c.a.partId);
    const b = find(c.b.partId);
    if (a !== b) {
      parent.set(b, a);
      tree.add(c.id);
    }
  }

  // Poses from the anchor over tree edges.
  const poses = new Map<PartId, Pose>([[component.root.partId, component.root.pose]]);
  const via = new Map<PartId, { from: PartId; connectionId: ConnectionId }>();
  const queue = [component.root.partId];
  let undetermined = false;
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const c of adjacency.get(current) ?? []) {
      if (!tree.has(c.id)) continue;
      const other = c.a.partId === current ? c.b.partId : c.a.partId;
      if (poses.has(other)) continue;
      const relative = bInA(ctx, c);
      if (!relative) {
        undetermined = true;
        continue;
      }
      poses.set(other, propagate(ctx, c, current, poses.get(current)!, relative));
      via.set(other, { from: current, connectionId: c.id });
      queue.push(other);
    }
  }
  if (undetermined) return 0;

  // Closing edges: residual at site b in the axes of site a.
  let cycles = 0;
  for (const c of component.connections) {
    if (tree.has(c.id)) continue;
    cycles++;
    const relative = bInA(ctx, c);
    const ta = poses.get(c.a.partId);
    const tb = poses.get(c.b.partId);
    if (!relative || !ta || !tb) continue;
    const sa = compose(ta, site(ctx, c.a.partId, c.a.siteId)!.frame);
    const expected = compose(sa, relative);
    const actual = compose(tb, site(ctx, c.b.partId, c.b.siteId)!.frame);
    const r = compose(inverse(expected), actual);
    const q = relative.orientation;
    const deltaP = rotate(q, r.position);
    const deltaQ = qmul(qmul(q, r.orientation), qconj(q));
    const { tiltRad, twistRad } = tiltTwist(deltaQ);
    const residual: ClosureResidual = {
      connectionId: c.id,
      cycle: cyclePath(via, c.a.partId, c.b.partId),
      axialMm: deltaP.z,
      lateralMm: Math.hypot(deltaP.x, deltaP.y),
      tiltRad,
      twistRad,
    };
    const tol = ctx.options.tolerance;
    if (Math.abs(residual.axialMm) > tol.distanceMm || residual.lateralMm > tol.distanceMm
      || residual.tiltRad > tol.angleRad || residual.twistRad > tol.angleRad) {
      report(ctx, 'closure', 'loop-closure-conflict', `Ring über Verbindung ${c.id} schließt nicht.`,
        [connection(c.id), ...residual.cycle.map(part)],
        { axialMm: round(residual.axialMm), lateralMm: round(residual.lateralMm),
          tiltDeg: round(deg(residual.tiltRad)), twistDeg: round(deg(residual.twistRad)) },
        residual);
    }
  }

  // Stored poses are a cache: a deviation is a data error.
  for (const id of component.parts) {
    const computed = poses.get(id);
    const stored = ctx.snapshot.realization.poses.find((p) => p.partId === id)?.worldPose;
    if (!computed) continue;
    if (!stored) {
      report(ctx, 'closure', 'invalid-data', `Für Teil ${id} fehlt die gespeicherte Lage.`, [part(id)]);
      continue;
    }
    const distance = length(sub(stored.position, computed.position));
    const angle = qangle(qmul(qconj(computed.orientation), stored.orientation));
    if (distance > ctx.options.tolerance.distanceMm || angle > ctx.options.tolerance.angleRad) {
      report(ctx, 'closure', 'invalid-data', `Gespeicherte Lage von Teil ${id} weicht von der berechneten ab.`, [part(id)],
        { distanceMm: round(distance), angleDeg: round(deg(angle)) });
    }
  }
  for (const [id, pose] of poses) ctx.poses.set(id, pose);
  if (ctx.findings.length > before) for (const id of component.parts) ctx.failedParts.add(id);
  return cycles;
}

function propagate(ctx: Context, c: Connection, from: PartId, pose: Pose, relative: Pose): Pose {
  const sa = site(ctx, c.a.partId, c.a.siteId)!.frame;
  const sb = site(ctx, c.b.partId, c.b.siteId)!.frame;
  return from === c.a.partId
    ? compose(compose(compose(pose, sa), relative), inverse(sb))
    : compose(compose(compose(pose, sb), inverse(relative)), inverse(sa));
}

function cyclePath(via: Map<PartId, { from: PartId }>, a: PartId, b: PartId): PartId[] {
  const pathToRoot = (x: PartId) => {
    const path = [x];
    for (let step = via.get(x); step; step = via.get(step.from)) path.push(step.from);
    return path;
  };
  const pa = pathToRoot(a);
  const pb = pathToRoot(b);
  const inB = new Set(pb);
  const meet = pa.find((x) => inB.has(x));
  if (meet === undefined) return [a, b];
  return [...pa.slice(0, pa.indexOf(meet) + 1), ...pb.slice(0, pb.indexOf(meet)).reverse()];
}

// ---------------------------------------------------------------- design agreement (stage 2)

/** Tube directions and fixed choices in the realization must match the design. */
function checkDesignAgreement(ctx: Context): void {
  const { poses } = ctx;
  const { design, realization } = ctx.snapshot;
  const tol = ctx.options.tolerance;
  const junctionPose = (id: string) =>
    realization.intentPoses.find((p) => p.intent.kind === 'junction' && p.intent.id === id)?.worldPose;

  for (const anchor of design.anchors) {
    const stored = realization.intentPoses.find((p) => p.intent.kind === anchor.target.kind && p.intent.id === anchor.target.id);
    if (stored && !sameFrame(stored.worldPose, anchor.worldPose, tol)) {
      report(ctx, 'closure', 'invalid-data', `Gespeicherter Rahmen weicht vom Anker ${anchor.id} ab.`, [intent(anchor.target)]);
    }
  }

  for (const p of realization.parts) {
    const pose = poses.get(p.id);
    if (!pose || p.origin.intent.kind !== 'junction' || p.origin.role !== CONNECTOR_ROLE) continue;
    const frame = junctionPose(p.origin.intent.id);
    if (!frame) {
      report(ctx, 'closure', 'invalid-data', `Für Verbindungspunkt ${p.origin.intent.id} fehlt der Rahmen.`, [intent(p.origin.intent)]);
      continue;
    }
    const offset = length(sub(pose.position, frame.position));
    const turn = nearestAxisRotation(qmul(qconj(frame.orientation), pose.orientation)).angle;
    if (offset > tol.distanceMm || turn > tol.angleRad) {
      report(ctx, 'closure', 'connection-misfit', `Kupplung ${p.id} sitzt nicht achsparallel auf Verbindungspunkt ${p.origin.intent.id}.`,
        [part(p.id), intent(p.origin.intent)], { offsetMm: round(offset), angleDeg: round(deg(turn)) });
    }
  }

  for (const tube of design.tubes) {
    const body = realization.parts.find((p) => p.origin.intent.kind === 'tube' && p.origin.intent.id === tube.id && p.origin.role === BODY_ROLE);
    if (!body) continue;
    const type = ctx.types.get(body.typeId);
    if (tube.variant.mode === 'fixed' && tube.variant.typeId !== body.typeId) {
      report(ctx, 'closure', 'fixed-variant-conflict', `Rohr ${tube.id} ist auf ${tube.variant.typeId} fixiert, realisiert ist ${body.typeId}.`,
        [intent({ kind: 'tube', id: tube.id }), part(body.id)]);
    }
    if (type && type.familyId !== tube.familyId) {
      report(ctx, 'closure', 'invalid-data', `Rohr ${tube.id} ist mit einem Teil einer anderen Familie realisiert.`,
        [intent({ kind: 'tube', id: tube.id }), part(body.id)], { expected: tube.familyId, actual: type.familyId });
    }
    const pose = poses.get(body.id);
    if (!pose || type?.kind !== 'tube') continue;
    for (const end of ['a', 'b'] as const) {
      const endpoint = tube[end];
      const frame = junctionPose(endpoint.junctionId);
      const s = (type as TubeType).sites.find((x) => x.id === (type as TubeType).ends[end]);
      if (!frame || !s) continue;
      // Site +Z points out of the tube; the design's end frame points into it.
      const actual = compose(pose, { position: s.frame.position, orientation: qmul(s.frame.orientation, FLIP_Z) });
      const roll = endpoint.roll.mode === 'fixed' ? qaxisAngle(vec(0, 0, 1), endpoint.roll.radians) : undefined;
      const expected = qmul(frame.orientation, roll ? qmul(endpoint.orientation, roll) : endpoint.orientation);
      const direction = Math.acos(clamp(dotZ(expected, actual.orientation)));
      const full = roll ? qangle(qmul(qconj(expected), actual.orientation)) : direction;
      if (direction > tol.angleRad || full > tol.angleRad) {
        report(ctx, 'closure', 'connection-misfit',
          roll ? `Rohr ${tube.id}, Ende ${end}: Richtung oder Drehstellung weicht vom Entwurf ab.`
            : `Rohr ${tube.id}, Ende ${end}: Richtung weicht vom Entwurf ab.`,
          [intent({ kind: 'tube', id: tube.id }), intent({ kind: 'junction', id: endpoint.junctionId })],
          { directionDeg: round(deg(direction)), angleDeg: round(deg(full)) });
      }
    }
  }
}

// ---------------------------------------------------------------- stage 3

/** Outward socket directions of every connector type in the catalog. */
function connectorSockets(ctx: Context): { typeId: string; directions: Vector3[] }[] {
  return ctx.catalog.partTypes
    .filter((t) => t.kind === 'connector')
    .map((t) => ({
      typeId: t.id,
      directions: t.sites.filter((s) => s.role === 'socket').map((s) => rotate(s.frame.orientation, vec(0, 0, 1))),
    }))
    .filter((t) => t.directions.length > 0);
}

interface AngleFit {
  readonly typeId: string;
  readonly worst: number;
  readonly deviations: readonly number[];
}

/**
 * Best mapping of the desired directions onto distinct sockets by one rotation.
 * Candidate rotations align the first direction with each socket and the first
 * non-parallel direction with each other socket; remaining directions take the
 * nearest free socket.
 */
function bestAngleFit(desired: readonly Vector3[], sockets: readonly Vector3[], typeId: string): AngleFit | undefined {
  if (desired.length > sockets.length || desired.length === 0) return undefined;
  const u0 = desired[0]!;
  const u1 = desired.find((u) => length(cross(u, u0)) > 1e-6);
  let best: AngleFit | undefined;
  for (const k of sockets.keys()) {
    const partners = u1 ? [...sockets.keys()].filter((m) => m !== k) : [-1];
    for (const m of partners) {
      const rotation = frameAlign(u0, u1, sockets[k]!, m >= 0 ? sockets[m] : undefined);
      const free = new Set(sockets.keys());
      const deviations: number[] = [];
      for (const u of desired) {
        const r = rotate(rotation, u);
        let pick = -1;
        let angle = Infinity;
        for (const i of free) {
          const a = Math.acos(clamp(dot(r, sockets[i]!)));
          if (a < angle) { angle = a; pick = i; }
        }
        free.delete(pick);
        deviations.push(angle);
      }
      const worst = Math.max(...deviations);
      if (!best || worst < best.worst) best = { typeId, worst, deviations };
    }
  }
  return best;
}

/** Rotation taking u0 to d0 and the plane (u0, u1) to the plane (d0, d1). */
function frameAlign(u0: Vector3, u1: Vector3 | undefined, d0: Vector3, d1: Vector3 | undefined): Quaternion {
  const basis = (a: Vector3, b: Vector3 | undefined) => {
    const x = normalize(a);
    let helper = b && length(cross(x, b)) > 1e-6 ? b : Math.abs(x.x) < 0.9 ? vec(1, 0, 0) : vec(0, 1, 0);
    const z = normalize(cross(x, helper));
    helper = cross(z, x);
    return [x, helper, z] as const;
  };
  const [ux, uy, uz] = basis(u0, u1);
  const [dx, dy, dz] = basis(d0, d1);
  return matrixToQuaternion([
    [dx.x * ux.x + dy.x * uy.x + dz.x * uz.x, dx.x * ux.y + dy.x * uy.y + dz.x * uz.y, dx.x * ux.z + dy.x * uy.z + dz.x * uz.z],
    [dx.y * ux.x + dy.y * uy.x + dz.y * uz.x, dx.y * ux.y + dy.y * uy.y + dz.y * uz.y, dx.y * ux.z + dy.y * uy.z + dz.y * uz.z],
    [dx.z * ux.x + dy.z * uy.x + dz.z * uz.x, dx.z * ux.y + dy.z * uy.y + dz.z * uz.y, dx.z * ux.z + dy.z * uy.z + dz.z * uz.z],
  ]);
}

function matrixToQuaternion(m: number[][]): Quaternion {
  const [[a, b, c], [d, e, f], [g, h, i]] = m as [[number, number, number], [number, number, number], [number, number, number]];
  const trace = a + e + i;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return { w: s / 4, x: (h - f) / s, y: (c - g) / s, z: (d - b) / s };
  }
  if (a > e && a > i) {
    const s = Math.sqrt(1 + a - e - i) * 2;
    return { w: (h - f) / s, x: s / 4, y: (b + d) / s, z: (c + g) / s };
  }
  if (e > i) {
    const s = Math.sqrt(1 + e - a - i) * 2;
    return { w: (c - g) / s, x: (b + d) / s, y: s / 4, z: (f + h) / s };
  }
  const s = Math.sqrt(1 + i - a - e) * 2;
  return { w: (d - b) / s, x: (c + g) / s, y: (f + h) / s, z: s / 4 };
}

function normalize(v: Vector3): Vector3 {
  const n = length(v);
  return vec(v.x / n, v.y / n, v.z / n);
}

/**
 * Explains junctions whose tube directions no connector type supports. Junctions
 * realised with additional parts such as angle adapters are not covered yet.
 */
function checkJunctionAngles(ctx: Context): void {
  const { design, realization } = ctx.snapshot;
  const types = connectorSockets(ctx);
  const tol = ctx.options.tolerance.angleRad;
  for (const junction of [...design.junctions].sort((a, b) => compareIds(a.id, b.id))) {
    const ends = design.tubes.flatMap((t) => (['a', 'b'] as const)
      .filter((e) => t[e].junctionId === junction.id)
      .map((e) => ({ tubeId: t.id, direction: rotate(t[e].orientation, vec(0, 0, 1)) })));
    if (ends.length < 2) continue;
    const adapted = realization.parts.some((p) => p.origin.intent.kind === 'junction'
      && p.origin.intent.id === junction.id && p.origin.role !== CONNECTOR_ROLE);
    if (adapted) continue;
    const fits = types
      .map((t) => bestAngleFit(ends.map((e) => e.direction), t.directions, t.typeId))
      .filter((f): f is AngleFit => f !== undefined)
      .sort((a, b) => a.worst - b.worst || compareIds(a.typeId, b.typeId));
    const best = fits[0];
    if (best && best.worst <= tol) continue;
    const details: Record<string, string | number> = { tubes: ends.length };
    if (best) {
      details.closestConnector = best.typeId;
      ends.forEach((e, i) => { details[`deviationDeg:${e.tubeId}`] = round(deg(best.deviations[i]!)); });
    }
    const worstEnd = best ? ends[best.deviations.indexOf(best.worst)] : undefined;
    report(ctx, 'junction-angles', 'junction-angle-unsupported',
      best && worstEnd
        ? `Keine Kupplung für Verbindungspunkt ${junction.id}: Rohr ${worstEnd.tubeId} weicht ${round(deg(best.worst))}° von der nächsten Muffe ab.`
        : `Keine Kupplung mit genügend Muffen für Verbindungspunkt ${junction.id}.`,
      [intent({ kind: 'junction', id: junction.id }), ...ends.map((e) => intent({ kind: 'tube', id: e.tubeId }))],
      details);
  }
}

// ---------------------------------------------------------------- stage 4

interface Placed {
  readonly part: PartInstance;
  readonly type: PartType;
  readonly pose: Pose;
  readonly shapes: readonly WorldShape[];
  readonly min: Vector3;
  readonly max: Vector3;
}

function checkCollisions(ctx: Context, geometry: CollisionGeometryProvider, edit?: EditContext): number {
  const tol = ctx.options.tolerance.distanceMm;
  const margin = Math.max(ctx.options.minClearanceMm, tol);
  const placed: Placed[] = [];
  for (const p of [...ctx.snapshot.realization.parts].sort((a, b) => compareIds(a.id, b.id))) {
    const pose = ctx.poses.get(p.id);
    const type = ctx.types.get(p.typeId);
    if (!pose || !type || ctx.failedParts.has(p.id)) continue;
    const local = geometry.shapes(type.geometry.collision);
    if (!local) {
      ctx.missing.set(type.geometry.collision.key, type.geometry.collision);
      continue;
    }
    const shapes = local.map((s) => toWorld(s, pose));
    if (shapes.length === 0) continue;
    placed.push({
      part: p, type, pose, shapes,
      min: vec(Math.min(...shapes.map((s) => s.min.x)), Math.min(...shapes.map((s) => s.min.y)), Math.min(...shapes.map((s) => s.min.z))),
      max: vec(Math.max(...shapes.map((s) => s.max.x)), Math.max(...shapes.map((s) => s.max.y)), Math.max(...shapes.map((s) => s.max.z))),
    });
  }
  const affected = edit?.affectedParts ? new Set(edit.affectedParts) : undefined;
  const links = new Map<string, Connection[]>();
  for (const c of ctx.snapshot.realization.connections) {
    if (ctx.brokenConnections.has(c.id)) continue;
    const key = pairKey(c.a.partId, c.b.partId);
    links.set(key, [...(links.get(key) ?? []), c]);
  }

  // Sweep along x over the bounding boxes.
  const sorted = [...placed].sort((a, b) => a.min.x - b.min.x || compareIds(a.part.id, b.part.id));
  let tested = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.min.x > a.max.x + margin) break;
      if (b.min.y > a.max.y + margin || a.min.y > b.max.y + margin
        || b.min.z > a.max.z + margin || a.min.z > b.max.z + margin) continue;
      if (affected && !affected.has(a.part.id) && !affected.has(b.part.id)) continue;
      tested++;
      const [first, second] = compareIds(a.part.id, b.part.id) < 0 ? [a, b] : [b, a];
      checkPair(ctx, first, second, links.get(pairKey(first.part.id, second.part.id)) ?? [], geometry);
    }
  }
  return tested;
}

function pairKey(a: PartId, b: PartId): string {
  return compareIds(a, b) < 0 ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function checkPair(ctx: Context, a: Placed, b: Placed, links: readonly Connection[], geometry: CollisionGeometryProvider): void {
  const tol = ctx.options.tolerance.distanceMm;
  let distance = Infinity;
  for (const sa of a.shapes) for (const sb of b.shapes) distance = Math.min(distance, separation(sa, sb));
  const subjects = [part(a.part.id), part(b.part.id)];

  if (distance < -tol) {
    const crossing = tubeCrossing(ctx, a, b);
    if (crossing && links.length === 0) {
      report(ctx, 'collision', 'crossing',
        `Rohre ${a.part.id} und ${b.part.id} kreuzen sich ohne gemeinsamen Verbindungspunkt.`, subjects,
        { stationAMm: round(crossing.stationA), stationBMm: round(crossing.stationB) });
      return;
    }
    if (links.length > 0 && overlapAllowed(ctx, a, b, links, geometry)) return;
    report(ctx, 'collision', 'collision', `Teile ${a.part.id} und ${b.part.id} durchdringen sich.`, subjects,
      { depthMm: round(-distance) });
    return;
  }
  if (links.length === 0 && distance < ctx.options.minClearanceMm) {
    report(ctx, 'collision', 'clearance', `Teile ${a.part.id} und ${b.part.id} liegen sehr dicht beieinander.`, subjects,
      { distanceMm: round(Math.max(0, distance)) });
  }
}

/** Intersecting centerlines of two straight tubes, as stations from end a. */
function tubeCrossing(ctx: Context, a: Placed, b: Placed): { stationA: number; stationB: number } | undefined {
  if (a.type.kind !== 'tube' || b.type.kind !== 'tube' || a.type.shape !== 'straight' || b.type.shape !== 'straight') return undefined;
  const line = (p: Placed & { type: TubeType }) => {
    const start = p.type.sites.find((s) => s.id === p.type.ends.a)!.frame.position;
    const end = p.type.sites.find((s) => s.id === p.type.ends.b)!.frame.position;
    return [transformPoint(p.pose, start), transformPoint(p.pose, end)] as const;
  };
  const [p1, q1] = line(a as Placed & { type: TubeType });
  const [p2, q2] = line(b as Placed & { type: TubeType });
  const { s, t, distance } = segmentParameters(p1, q1, p2, q2);
  if (distance > ctx.options.tolerance.distanceMm || s <= 0 || s >= 1 || t <= 0 || t >= 1) return undefined;
  return { stationA: s * length(sub(q1, p1)), stationB: t * length(sub(q2, p2)) };
}

/** Every sampled point of the overlap must lie in an allowed volume of a linking connection. */
function overlapAllowed(ctx: Context, a: Placed, b: Placed, links: readonly Connection[], geometry: CollisionGeometryProvider): boolean {
  const tol = ctx.options.tolerance.distanceMm;
  const allowed: WorldShape[] = [];
  for (const c of links) {
    const ref = ctx.connectionTypes.get(c.typeId)?.allowedOverlap;
    if (!ref) continue;
    const shapes = geometry.shapes(ref);
    if (!shapes) {
      ctx.missing.set(ref.key, ref);
      return true;
    }
    const siteA = site(ctx, c.a.partId, c.a.siteId);
    const owner = c.a.partId === a.part.id ? a : b;
    if (!siteA) continue;
    const frame = compose(owner.pose, siteA.frame);
    allowed.push(...shapes.map((s) => toWorld(s, frame)));
  }
  if (allowed.length === 0) return false;
  const inside = (shapes: readonly WorldShape[], p: Vector3, slack: number) => shapes.some((s) => containsPoint(s, p, slack));
  for (const [x, y] of [[a, b], [b, a]] as const) {
    for (const shape of x.shapes) {
      for (const p of shape.samples()) {
        if (inside(y.shapes, p, -tol) && !inside(allowed, p, tol)) return false;
      }
    }
  }
  return true;
}

function sameFrame(a: Pose, b: Pose, tol: { distanceMm: number; angleRad: number }): boolean {
  return length(sub(a.position, b.position)) <= tol.distanceMm
    && qangle(qmul(qconj(a.orientation), b.orientation)) <= tol.angleRad;
}

function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
