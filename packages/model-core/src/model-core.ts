import { checkBuildability } from './buildability-checker.js';
import type { BuildabilityOptions } from './buildability.js';
import type { PartCatalog } from './catalog.js';
import type { DesignOperation, EditCommand } from './commands.js';
import type {
  ConstructionSnapshot,
  EditPreview,
  ModelCore,
  ModelCoreFactory,
  ModelCoreOptions,
  VariantChange,
} from './core.js';
import type { ConstructionDesign } from './design.js';
import type { Diagnostic, DiagnosticCode, Result, SubjectRef } from './diagnostics.js';
import type { IntentRef, PartId } from './ids.js';
import { length, qangle, qconj, qmul, sub } from './math.js';
import type { Realization } from './realization.js';
import { solveRealization } from './solver.js';

/**
 * Consistency boundary (SPEC 8): apply a command to a copy of the design, solve,
 * verify independently, commit only a buildable result.
 */
export const modelCoreFactory: ModelCoreFactory = { create: createModelCore };

export function createModelCore(
  design: ConstructionDesign,
  catalog: PartCatalog,
  options: ModelCoreOptions,
): Result<ModelCore> {
  const errors = validateDesign(design, catalog);
  if (errors.length > 0) return { ok: false, diagnostics: errors };
  const result = realize(design, catalog, options, undefined);
  if (!result.ok) return result;
  const core = new Core({ revision: 0, design, realization: result.value }, catalog, options);
  return { ok: true, value: core, diagnostics: result.diagnostics };
}

/**
 * Opens a stored state as it is, without solving again, so the chosen realization
 * stays. The state is verified in full like every commit.
 */
export function openModelCore(
  snapshot: ConstructionSnapshot,
  catalog: PartCatalog,
  options: ModelCoreOptions,
): Result<ModelCore> {
  const errors = validateDesign(snapshot.design, catalog);
  if (errors.length > 0) return { ok: false, diagnostics: errors };
  const verified = verify(snapshot, catalog, options);
  if (!verified.ok) return verified;
  return { ok: true, value: new Core(snapshot, catalog, options), diagnostics: verified.diagnostics };
}

class Core implements ModelCore {
  constructor(
    private current: ConstructionSnapshot,
    private readonly catalog: PartCatalog,
    private readonly options: ModelCoreOptions,
  ) {}

  get snapshot(): ConstructionSnapshot {
    return this.current;
  }

  preview(command: EditCommand): EditPreview {
    const baseRevision = this.current.revision;
    if (command.baseRevision !== baseRevision) {
      return {
        status: 'invalid',
        baseRevision,
        diagnostics: [
          error(
            'stale-revision',
            `Die Bearbeitung bezieht sich auf Stand ${command.baseRevision}, aktuell ist ${baseRevision}.`,
            [],
          ),
        ],
      };
    }
    const applied = applyOperations(this.current.design, command.operations);
    if (!applied.ok) return { status: 'invalid', baseRevision, diagnostics: applied.diagnostics };
    const design = applied.value;
    const errors = validateDesign(design, this.catalog);
    if (errors.length > 0) return { status: 'invalid', baseRevision, attemptedDesign: design, diagnostics: errors };
    const result = realize(design, this.catalog, this.options, this.current.realization);
    if (!result.ok)
      return { status: 'invalid', baseRevision, attemptedDesign: design, diagnostics: result.diagnostics };
    return {
      status: 'valid',
      baseRevision,
      candidate: { revision: baseRevision + 1, design, realization: result.value },
      variantChanges: variantChanges(design, this.current.realization, result.value, this.catalog),
      diagnostics: result.diagnostics,
    };
  }

  execute(command: EditCommand): Result<ConstructionSnapshot> {
    const preview = this.preview(command);
    if (preview.status === 'invalid') return { ok: false, diagnostics: preview.diagnostics };
    this.current = preview.candidate;
    return { ok: true, value: this.current, diagnostics: preview.diagnostics };
  }

  restore(snapshot: ConstructionSnapshot): Result<ConstructionSnapshot> {
    const errors = validateDesign(snapshot.design, this.catalog);
    if (errors.length > 0) return { ok: false, diagnostics: errors };
    const verified = verify(snapshot, this.catalog, this.options);
    if (!verified.ok) return verified;
    this.current = { ...snapshot, revision: this.current.revision + 1 };
    return { ok: true, value: this.current, diagnostics: verified.diagnostics };
  }
}

// ---------------------------------------------------------------- solving and checking

/** Solves and verifies; only a buildable verdict yields a realization. */
function realize(
  design: ConstructionDesign,
  catalog: PartCatalog,
  options: ModelCoreOptions,
  previous?: Realization,
): Result<Realization> {
  const solved = solveRealization(design, catalog, options, previous);
  if (!solved.ok) return solved;
  const edit = previous ? editContext(previous, solved.value, options) : undefined;
  const verified = verify({ revision: 0, design, realization: solved.value }, catalog, options, edit);
  return verified.ok ? { ok: true, value: solved.value, diagnostics: verified.diagnostics } : verified;
}

/** Full or incremental buildability check; only a buildable verdict passes. */
function verify(
  snapshot: ConstructionSnapshot,
  catalog: PartCatalog,
  options: ModelCoreOptions,
  edit?: ReturnType<typeof editContext>,
): Result<ConstructionSnapshot> {
  const checkOptions: BuildabilityOptions = {
    tolerance: options.tolerance,
    minClearanceMm: options.minClearanceMm ?? 0,
    maxRemediesPerFinding: 3,
    ...(options.connectionEvaluators ? { connectionEvaluators: options.connectionEvaluators } : {}),
  };
  const report = checkBuildability(snapshot, catalog, options.geometry, checkOptions, edit);
  const diagnostics = report.findings.map((f) => f.diagnostic);
  if (report.verdict === 'buildable') return { ok: true, value: snapshot, diagnostics };
  if (report.verdict === 'undetermined') {
    diagnostics.push(
      error('missing-catalog-data', 'Für die Prüfung fehlen Katalogdaten.', [], {
        keys: report.missingCatalogData.map((r) => r.key).join(','),
      }),
    );
  }
  return { ok: false, diagnostics };
}

/** New connections and every part that is new, retyped or moved. */
function editContext(previous: Realization, next: Realization, options: ModelCoreOptions) {
  const oldConnections = new Set(previous.connections.map((c) => c.id));
  const oldParts = new Map(previous.parts.map((p) => [p.id, p]));
  const oldPoses = new Map(previous.poses.map((p) => [p.partId, p.worldPose]));
  const affected: PartId[] = [];
  for (const p of next.parts) {
    const before = oldParts.get(p.id);
    const was = oldPoses.get(p.id);
    const now = next.poses.find((x) => x.partId === p.id)?.worldPose;
    const moved =
      !was ||
      !now ||
      length(sub(was.position, now.position)) > options.tolerance.distanceMm ||
      qangle(qmul(qconj(was.orientation), now.orientation)) > options.tolerance.angleRad;
    if (!before || before.typeId !== p.typeId || moved) affected.push(p.id);
  }
  return {
    addedConnectionIds: next.connections.filter((c) => !oldConnections.has(c.id)).map((c) => c.id),
    affectedParts: affected,
  };
}

function variantChanges(
  design: ConstructionDesign,
  previous: Realization,
  next: Realization,
  catalog: PartCatalog,
): VariantChange[] {
  const types = new Map(catalog.partTypes.map((t) => [t.id, t]));
  const changes: VariantChange[] = [];
  for (const tube of design.tubes) {
    const part = next.parts.find(
      (p) => p.origin.intent.kind === 'tube' && p.origin.intent.id === tube.id && p.origin.role === 'body',
    );
    if (!part) continue;
    const before = previous.parts.find((p) => p.id === part.id);
    const type = types.get(part.typeId);
    const nonstandard = type?.kind === 'tube' ? !type.standardVariant : false;
    if (before?.typeId === part.typeId || (!before && !nonstandard)) continue;
    const intent: IntentRef = { kind: 'tube', id: tube.id };
    changes.push(
      before
        ? { intent, partId: part.id, previousTypeId: before.typeId, selectedTypeId: part.typeId, nonstandard }
        : { intent, partId: part.id, selectedTypeId: part.typeId, nonstandard },
    );
  }
  return changes;
}

// ---------------------------------------------------------------- operations

class OperationError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

/** Applies the operations in order to a copy; the input is never modified. */
export function applyOperations(
  design: ConstructionDesign,
  operations: readonly DesignOperation[],
): Result<ConstructionDesign> {
  let d = design;
  try {
    for (const op of operations) d = apply(d, op);
  } catch (e) {
    if (e instanceof OperationError) return { ok: false, diagnostics: [e.diagnostic] };
    throw e;
  }
  return { ok: true, value: d, diagnostics: [] };
}

function apply(d: ConstructionDesign, op: DesignOperation): ConstructionDesign {
  const fail = (code: DiagnosticCode, message: string, subjects: SubjectRef[] = []): never => {
    throw new OperationError(error(code, message, subjects));
  };
  const has = (ref: IntentRef) =>
    (ref.kind === 'tube' ? d.tubes : ref.kind === 'junction' ? d.junctions : d.plates).some((x) => x.id === ref.id);
  const subject = (ref: IntentRef): SubjectRef => ({ kind: 'intent', ref });
  switch (op.kind) {
    case 'add-junction':
      if (has({ kind: 'junction', id: op.junction.id }))
        fail('duplicate-id', `Verbindungspunkt ${op.junction.id} gibt es schon.`, [
          subject({ kind: 'junction', id: op.junction.id }),
        ]);
      return { ...d, junctions: [...d.junctions, op.junction] };
    case 'add-tube':
      if (has({ kind: 'tube', id: op.tube.id }))
        fail('duplicate-id', `Rohr ${op.tube.id} gibt es schon.`, [subject({ kind: 'tube', id: op.tube.id })]);
      return { ...d, tubes: [...d.tubes, op.tube] };
    case 'set-tube':
      if (!has({ kind: 'tube', id: op.tube.id })) fail('missing-reference', `Rohr ${op.tube.id} gibt es nicht.`);
      return { ...d, tubes: d.tubes.map((t) => (t.id === op.tube.id ? op.tube : t)) };
    case 'connect-tube-end': {
      if (!has({ kind: 'tube', id: op.end.tubeId })) fail('missing-reference', `Rohr ${op.end.tubeId} gibt es nicht.`);
      return {
        ...d,
        tubes: d.tubes.map((t) =>
          t.id === op.end.tubeId ? { ...t, [op.end.end]: { ...t[op.end.end], junctionId: op.junctionId } } : t,
        ),
      };
    }
    case 'add-plate':
      if (has({ kind: 'plate', id: op.plate.id }))
        fail('duplicate-id', `Platte ${op.plate.id} gibt es schon.`, [subject({ kind: 'plate', id: op.plate.id })]);
      return { ...d, plates: [...d.plates, op.plate] };
    case 'set-plate':
      if (!has({ kind: 'plate', id: op.plate.id })) fail('missing-reference', `Platte ${op.plate.id} gibt es nicht.`);
      return { ...d, plates: d.plates.map((p) => (p.id === op.plate.id ? op.plate : p)) };
    case 'set-variant':
      if (!has(op.target))
        fail('missing-reference', `${op.target.kind === 'tube' ? 'Rohr' : 'Platte'} ${op.target.id} gibt es nicht.`);
      return op.target.kind === 'tube'
        ? { ...d, tubes: d.tubes.map((t) => (t.id === op.target.id ? { ...t, variant: op.policy } : t)) }
        : { ...d, plates: d.plates.map((p) => (p.id === op.target.id ? { ...p, variant: op.policy } : p)) };
    case 'set-anchor':
      return d.anchors.some((a) => a.id === op.anchor.id)
        ? { ...d, anchors: d.anchors.map((a) => (a.id === op.anchor.id ? op.anchor : a)) }
        : { ...d, anchors: [...d.anchors, op.anchor] };
    case 'remove-anchor':
      if (!d.anchors.some((a) => a.id === op.id)) fail('missing-reference', `Anker ${op.id} gibt es nicht.`);
      return { ...d, anchors: d.anchors.filter((a) => a.id !== op.id) };
    case 'remove-intent':
      if (!has(op.target)) fail('missing-reference', `${op.target.id} gibt es nicht.`, [subject(op.target)]);
      return op.target.kind === 'tube'
        ? { ...d, tubes: d.tubes.filter((t) => t.id !== op.target.id) }
        : op.target.kind === 'junction'
          ? { ...d, junctions: d.junctions.filter((j) => j.id !== op.target.id) }
          : { ...d, plates: d.plates.filter((p) => p.id !== op.target.id) };
  }
}

/** References and identities of the whole design after all operations. */
function validateDesign(d: ConstructionDesign, catalog: PartCatalog): Diagnostic[] {
  const errors: Diagnostic[] = [];
  if (d.catalog.id !== catalog.ref.id || d.catalog.version !== catalog.ref.version) {
    errors.push(error('catalog-mismatch', 'Katalog des Modells passt nicht zum geladenen Katalog.', []));
  }
  const junctions = new Set(d.junctions.map((j) => j.id));
  const tubes = new Set(d.tubes.map((t) => t.id));
  const plates = new Set(d.plates.map((p) => p.id));
  const duplicates = (kind: IntentRef['kind'], ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id))
        errors.push(error('duplicate-id', `Doppelte ID ${id}.`, [{ kind: 'intent', ref: { kind, id } }]));
      seen.add(id);
    }
  };
  duplicates(
    'junction',
    d.junctions.map((j) => j.id),
  );
  duplicates(
    'tube',
    d.tubes.map((t) => t.id),
  );
  duplicates(
    'plate',
    d.plates.map((p) => p.id),
  );
  for (const t of d.tubes) {
    for (const end of ['a', 'b'] as const) {
      if (!junctions.has(t[end].junctionId)) {
        errors.push(
          error('missing-reference', `Rohr ${t.id} verweist auf fehlenden Verbindungspunkt ${t[end].junctionId}.`, [
            { kind: 'intent', ref: { kind: 'tube', id: t.id } },
          ]),
        );
      }
    }
    if (t.a.junctionId === t.b.junctionId) {
      errors.push(
        error('invalid-data', `Rohr ${t.id} beginnt und endet am selben Verbindungspunkt.`, [
          { kind: 'intent', ref: { kind: 'tube', id: t.id } },
        ]),
      );
    }
  }
  for (const p of d.plates) {
    if (!junctions.has(p.placement.junctionId)) {
      errors.push(
        error('missing-reference', `Platte ${p.id} verweist auf fehlenden Verbindungspunkt.`, [
          { kind: 'intent', ref: { kind: 'plate', id: p.id } },
        ]),
      );
    }
    for (const m of p.mounts) {
      if (!tubes.has(m.tubeId)) {
        errors.push(
          error('missing-reference', `Platte ${p.id} verweist auf fehlendes Rohr ${m.tubeId}.`, [
            { kind: 'intent', ref: { kind: 'plate', id: p.id } },
          ]),
        );
      }
    }
  }
  for (const a of d.anchors) {
    const ok =
      a.target.kind === 'junction'
        ? junctions.has(a.target.id)
        : a.target.kind === 'tube'
          ? tubes.has(a.target.id)
          : plates.has(a.target.id);
    if (!ok)
      errors.push(
        error('missing-reference', `Anker ${a.id} verweist auf ein fehlendes Objekt.`, [
          { kind: 'intent', ref: a.target },
        ]),
      );
  }
  return errors;
}

function error(
  code: DiagnosticCode,
  message: string,
  subjects: readonly SubjectRef[],
  details?: Diagnostic['details'],
): Diagnostic {
  return details
    ? { code, severity: 'error', message, subjects, details }
    : { code, severity: 'error', message, subjects };
}
