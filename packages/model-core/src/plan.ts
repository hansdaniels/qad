import * as z from 'zod';
import type { ArticleCatalog, GridDirection } from './article-catalog.js';
import { attachPoints, attachTube, type AttachOptions } from './attach.js';
import type { PartCatalog } from './catalog.js';
import type { EditPreview, ModelCore, ModelCoreOptions } from './core.js';
import type { Diagnostic, Result } from './diagnostics.js';
import type { Vector3 } from './geometry.js';
import type { JunctionId, TubeId } from './ids.js';
import { dot, length, qconj, rotate, sub, vec } from './math.js';
import { createModelCore } from './model-core.js';
import { insertPlate, plateSpots } from './plates.js';
import { insertSlide, localToward, slideSpots } from './slides.js';

/**
 * Building plan: a model written as building steps in world directions, e.g. by
 * a language model from photos (BAUPLAN.md). Importing replays the steps with
 * the editor's own commands, so the result is checked like any edit.
 */

const DIRECTIONS = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;
const direction = z.enum(DIRECTIONS);
const name = z.string().min(1);
const id = z.string().min(1);
const tubeStep = z.strictObject({
  kind: z.literal('tube'),
  part: id,
  from: name,
  direction: z.string().regex(/^[+-][xyz]([+-][xyz])?$/, 'Richtung wie "+x" oder schräg wie "+x+z"'),
  bend: direction.exactOptional(),
  to: name.exactOptional(),
  colour: id.exactOptional(),
});
const plateStep = z.strictObject({
  kind: z.literal('plate'),
  part: id,
  corners: z.array(name).length(4),
  side: direction,
  flanges: z.enum(['x', 'y', 'z']).exactOptional(),
  colour: id.exactOptional(),
});
const slideStep = z.strictObject({
  kind: z.literal('slide'),
  part: id,
  tube: z.array(name).length(2),
  toward: direction,
  colour: id.exactOptional(),
});
const PlanSchema = z.strictObject({
  format: z.literal('qad-bauplan'),
  version: z.literal(1),
  name: z.string().exactOptional(),
  start: name,
  steps: z.array(z.discriminatedUnion('kind', [tubeStep, plateStep, slideStep])),
  notes: z.array(z.string()).exactOptional(),
});
type TubeStep = z.infer<typeof tubeStep>;
type PlateStep = z.infer<typeof plateStep>;
type SlideStep = z.infer<typeof slideStep>;

const UNIT: Record<GridDirection, Vector3> = {
  '+x': vec(1, 0, 0),
  '-x': vec(-1, 0, 0),
  '+y': vec(0, 1, 0),
  '-y': vec(0, -1, 0),
  '+z': vec(0, 0, 1),
  '-z': vec(0, 0, -1),
};
const axisOf = (v: Vector3) => DIRECTIONS.find((d) => dot(UNIT[d], v) > 1 - 1e-6);

/** True when the JSON text is a building plan rather than a saved model. */
export function isPlan(json: string): boolean {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null && (value as { format?: unknown }).format === 'qad-bauplan';
  } catch {
    return false;
  }
}

/**
 * Builds a model from a building plan. Stops at the first step that cannot be
 * built and names it; nothing is returned in that case. The plan's notes come
 * back as warnings.
 */
export function importPlan(
  json: string,
  catalog: PartCatalog,
  articles: ArticleCatalog,
  options: ModelCoreOptions,
): Result<ModelCore> {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return failure('Der Bauplan enthält kein gültiges JSON.');
  }
  const parsed = PlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: parsed.error.issues.map((issue) =>
        problem(`${issue.path.length > 0 ? issue.path.join('.') + ': ' : ''}${issue.message}`),
      ),
    };
  }
  const plan = parsed.data;
  const created = createModelCore(
    {
      id: plan.name ?? 'bauplan',
      catalog: catalog.ref,
      tubes: [],
      junctions: [{ id: 'j1' }],
      plates: [],
      slides: [],
      anchors: [
        {
          id: 'anchor',
          target: { kind: 'junction', id: 'j1' },
          worldPose: { position: vec(0, 0, 0), orientation: { x: 0, y: 0, z: 0, w: 1 } },
        },
      ],
    },
    catalog,
    options,
  );
  if (!created.ok) return created;
  const core = created.value;
  const points = new Map<string, JunctionId>([[plan.start, 'j1']]);
  for (const [index, step] of plan.steps.entries()) {
    const error =
      step.kind === 'tube'
        ? buildTube(core, step, points, catalog, articles)
        : step.kind === 'plate'
          ? buildPlate(core, step, points, catalog, articles)
          : buildSlide(core, step, points, catalog, articles);
    if (error) return failure(`Schritt ${index + 1}: ${error}`, index + 1);
  }
  // Notes come back as warnings, so the editor can show what the plan's author was unsure of.
  const notes = (plan.notes ?? []).map((note): Diagnostic => ({ ...problem(note), severity: 'warning' }));
  return { ok: true, value: core, diagnostics: notes };
}

function buildTube(
  core: ModelCore,
  step: TubeStep,
  points: Map<string, JunctionId>,
  catalog: PartCatalog,
  articles: ArticleCatalog,
): string | undefined {
  const from = points.get(step.from);
  if (!from) return `Punkt „${step.from}“ ist noch nicht gebaut.`;
  const families = [...new Set(catalog.partTypes.flatMap((t) => (t.kind === 'tube' ? [t.familyId] : [])))];
  const type = catalog.partTypes.find((t) => t.kind === 'tube' && t.familyId === step.part && t.standardVariant);
  if (type?.kind !== 'tube') return `Unbekanntes Rohr „${step.part}“; möglich sind ${families.join(', ')}.`;
  const colour = colourFor(step.part, 'tube', step.colour, articles);
  if (typeof colour !== 'string') return colour.error;
  const local = localDirections(core, from);
  if (!local) return `An Punkt „${step.from}“ lässt sich nichts in Rasterrichtung anbauen.`;
  const free = new Set(
    attachPoints(core.snapshot, catalog)
      .filter((p) => p.junctionId === from)
      .map((p) => p.direction),
  );

  const candidates: { arm: GridDirection; options: AttachOptions }[] = [];
  const [first, second] = [step.direction.slice(0, 2), step.direction.slice(2)] as [GridDirection, string];
  if (second === '') {
    if (type.shape === 'bent') {
      if (!step.bend) return 'Ein Bogenrohr braucht „bend“, die Richtung, in die es am Ende zeigt.';
      if (step.bend[1] === first[1]) return '„bend“ muss quer zu „direction“ stehen.';
      candidates.push({ arm: local(first), options: { bend: local(step.bend) } });
    } else {
      if (step.bend) return '„bend“ gibt es nur beim Bogenrohr.';
      candidates.push({ arm: local(first), options: {} });
    }
  } else {
    if (type.shape === 'bent') return 'Ein Bogenrohr kann nicht schräg angebaut werden.';
    if (step.bend) return '„bend“ gibt es nur beim Bogenrohr.';
    const other = second as GridDirection;
    if (first[1] === other[1]) return `„${step.direction}“ ist keine Schräge aus zwei verschiedenen Achsen.`;
    // On an angle adapter the tube leaves at 45° back over the arm: arm and lean
    // are the opposite of one component and the other one.
    for (const [back, lean] of [
      [first, other],
      [other, first],
    ] as const) {
      candidates.push({ arm: local(opposite(back)), options: { oblique: local(lean) } });
    }
  }
  const usable = candidates.filter((c) => free.has(c.arm));
  if (usable.length === 0) {
    const arms = candidates.map((c) => world(core, from, c.arm)).join(' oder ');
    return `Am Punkt „${step.from}“ ist die Richtung ${arms} schon belegt.`;
  }
  const attempts = usable.map((c) => {
    const command = attachTube(
      core.snapshot,
      { junctionId: from, direction: c.arm },
      { familyId: step.part, colour },
      catalog,
      c.options,
    );
    return { command, preview: core.preview(command) };
  });
  const chosen = attempts.find((a) => a.preview.status === 'valid') ?? attempts[0]!;
  if (chosen.preview.status !== 'valid') return messages(chosen.preview);
  const added = chosen.command.operations.find((o) => o.kind === 'add-tube');
  const far = added?.kind === 'add-tube' ? added.tube.b.junctionId : undefined;
  const result = core.execute(chosen.command);
  if (!result.ok || !far) return result.diagnostics.map((d) => d.message).join(' ');

  const named = [...points].find(([, j]) => j === far)?.[0];
  if (step.to === undefined) {
    return named ? `Das Rohrende trifft den vorhandenen Punkt „${named}“; dann „to“: „${named}“ angeben.` : undefined;
  }
  const target = points.get(step.to);
  if (target === undefined) {
    if (named) return `Das Rohrende trifft den vorhandenen Punkt „${named}“; dann „to“: „${named}“ angeben.`;
    points.set(step.to, far);
    return undefined;
  }
  if (target === far) return undefined;
  const gap = distance(core, target, far);
  return `Das Rohrende trifft Punkt „${step.to}“ nicht${gap === undefined ? '' : ` (${Math.round(gap)} mm daneben)`}. Rohrlängen auf dem Weg dorthin prüfen.`;
}

function buildPlate(
  core: ModelCore,
  step: PlateStep,
  points: Map<string, JunctionId>,
  catalog: PartCatalog,
  articles: ArticleCatalog,
): string | undefined {
  const families = catalog.partTypes.flatMap((t) => (t.kind === 'plate' ? [t.familyId] : []));
  if (!families.includes(step.part)) return `Unbekannte Platte „${step.part}“; möglich sind ${families.join(', ')}.`;
  const corners = new Set<JunctionId>();
  for (const corner of step.corners) {
    const junction = points.get(corner);
    if (!junction) return `Punkt „${corner}“ ist noch nicht gebaut.`;
    corners.add(junction);
  }
  if (corners.size !== 4) return 'Eine Platte braucht vier verschiedene Ecken.';
  const colour = colourFor(step.part, 'plate', step.colour, articles);
  if (typeof colour !== 'string') return colour.error;
  const { snapshot } = core;
  const ends = new Map(snapshot.design.tubes.map((t) => [t.id, [t.a.junctionId, t.b.junctionId]]));
  const onCorners = (tubeId: TubeId) => (ends.get(tubeId) ?? []).every((j) => corners.has(j));
  const spots = plateSpots(snapshot, catalog).filter((s) => s.familyId === step.part && s.flangeTubes.every(onCorners));
  if (spots.length === 0) {
    return `Zwischen ${step.corners.join(', ')} gibt es keinen freien Rahmen aus vier Rohren, auf den „${step.part}“ passt.`;
  }
  const sided = spots.filter((s) => dot(rotate(s.worldPose.orientation, vec(0, 0, 1)), UNIT[step.side]) > 1 - 1e-6);
  if (sided.length === 0) {
    const sides = [...new Set(spots.map((s) => axisOf(rotate(s.worldPose.orientation, vec(0, 0, 1)))))];
    return `Auf der Seite ${step.side} ist kein Platz für die Platte; möglich ist ${sides.join(' oder ')}.`;
  }
  const flanged = step.flanges
    ? sided.filter((s) => axisOf(rotate(s.worldPose.orientation, vec(1, 0, 0)))?.[1] === step.flanges)
    : sided;
  if (flanged.length === 0) return `Die Flansche können nicht entlang ${step.flanges} laufen.`;
  const attempts = flanged
    .map((spot) => {
      const command = insertPlate(snapshot, spot, colour);
      return { command, preview: core.preview(command) };
    })
    .sort((a, b) => rank(a.preview) - rank(b.preview));
  const chosen = attempts[0]!;
  if (chosen.preview.status !== 'valid') return messages(chosen.preview);
  const result = core.execute(chosen.command);
  return result.ok ? undefined : result.diagnostics.map((d) => d.message).join(' ');
}

function buildSlide(
  core: ModelCore,
  step: SlideStep,
  points: Map<string, JunctionId>,
  catalog: PartCatalog,
  articles: ArticleCatalog,
): string | undefined {
  const families = catalog.partTypes.flatMap((t) => (t.kind === 'slide' ? [t.familyId] : []));
  if (!families.includes(step.part)) return `Unbekannte Rutsche „${step.part}“; möglich sind ${families.join(', ')}.`;
  const ends = new Set<JunctionId>();
  for (const point of step.tube) {
    const junction = points.get(point);
    if (!junction) return `Punkt „${point}“ ist noch nicht gebaut.`;
    ends.add(junction);
  }
  const { snapshot } = core;
  const tube = snapshot.design.tubes.find(
    (t) => ends.has(t.a.junctionId) && ends.has(t.b.junctionId) && ends.size === 2,
  );
  if (!tube) return `Zwischen ${step.tube.join(' und ')} gibt es kein Rohr.`;
  const colour = colourFor(step.part, 'slide', step.colour, articles);
  if (typeof colour !== 'string') return colour.error;
  const toward = localToward(snapshot, tube.id, step.toward);
  const spot = slideSpots(snapshot, catalog).find(
    (s) => s.familyId === step.part && s.tubeId === tube.id && s.toward === toward,
  );
  if (!spot) {
    const type = catalog.partTypes.find((t) => t.kind === 'slide' && t.familyId === step.part);
    return type?.kind === 'slide' && type.lowerEnd
      ? `Am Rohr ${step.tube.join('–')} kann kein Rutschenkörper nach ${step.toward} hängen. Er braucht ein waagerechtes 35-cm-Rohr, und ${Math.round(type.lowerEnd.x / 10)} cm weiter und ${Math.round(-type.lowerEnd.z / 10)} cm tiefer ein gleich liegendes Rohr, auf dem er unten aufliegt.`
      : `Am Rohr ${step.tube.join('–')} kann kein Auslauf nach ${step.toward} hängen; er gehört an das Rohr, auf dem ein Rutschenkörper unten aufliegt, in dessen Richtung.`;
  }
  const command = insertSlide(snapshot, spot, colour);
  const preview = core.preview(command);
  if (preview.status !== 'valid') return messages(preview);
  const result = core.execute(command);
  return result.ok ? undefined : result.diagnostics.map((d) => d.message).join(' ');
}

/** Valid before invalid, then the fewest tubes that change to another drilling. */
const rank = (p: EditPreview) => (p.status === 'valid' ? p.variantChanges.filter((c) => c.nonstandard).length : 1e6);

const messages = (preview: EditPreview) =>
  preview.status === 'valid' ? '' : preview.diagnostics.map((d) => d.message).join(' ');

/** Maps world directions into the junction's frame; undefined if that frame is not on the grid. */
function localDirections(core: ModelCore, junctionId: JunctionId) {
  const frame = junctionPose(core, junctionId);
  if (!frame) return undefined;
  const inverse = qconj(frame.orientation);
  const map = new Map(DIRECTIONS.map((d) => [d, axisOf(rotate(inverse, UNIT[d]))]));
  if ([...map.values()].some((d) => d === undefined)) return undefined;
  return (d: GridDirection) => map.get(d)!;
}

function world(core: ModelCore, junctionId: JunctionId, local: GridDirection): string {
  const frame = junctionPose(core, junctionId);
  return (frame && axisOf(rotate(frame.orientation, UNIT[local]))) ?? local;
}

function junctionPose(core: ModelCore, junctionId: JunctionId) {
  return core.snapshot.realization.intentPoses.find((p) => p.intent.kind === 'junction' && p.intent.id === junctionId)
    ?.worldPose;
}

function distance(core: ModelCore, a: JunctionId, b: JunctionId): number | undefined {
  const [p, q] = [junctionPose(core, a), junctionPose(core, b)];
  return p && q ? length(sub(p.position, q.position)) : undefined;
}

function colourFor(
  familyId: string,
  category: 'tube' | 'plate' | 'slide',
  colour: string | undefined,
  articles: ArticleCatalog,
): string | { error: string } {
  const offered = [
    ...new Set(articles.entries.filter((e) => e.familyId === familyId).flatMap((e) => e.articles.map((a) => a.colour))),
  ];
  const chosen = colour ?? articles.defaultColours[category] ?? offered[0] ?? 'red';
  return offered.length === 0 || offered.includes(chosen)
    ? chosen
    : { error: `„${familyId}“ gibt es nicht in „${chosen}“; möglich sind ${offered.join(', ')}.` };
}

function opposite(d: GridDirection): GridDirection {
  return `${d[0] === '+' ? '-' : '+'}${d[1]}` as GridDirection;
}

function problem(message: string, step?: number): Diagnostic {
  return {
    code: 'invalid-data',
    severity: 'error',
    message,
    subjects: [],
    ...(step === undefined ? {} : { details: { step } }),
  };
}

function failure(message: string, step?: number): Result<never> {
  return { ok: false, diagnostics: [problem(message, step)] };
}
