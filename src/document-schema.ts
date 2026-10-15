import * as z from 'zod';
import type { ConstructionSnapshot } from './core.js';

// File-format schemas only: references, catalog compatibility and geometry are
// validated by the domain layer after parsing. No coercion or silent defaults.
const id = z.string().min(1);
const vector = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
const quaternion = z.strictObject({
  x: z.number(), y: z.number(), z: z.number(), w: z.number(),
});
const pose = z.strictObject({ position: vector, orientation: quaternion });
const intentRef = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tube'), id }),
  z.strictObject({ kind: z.literal('junction'), id }),
  z.strictObject({ kind: z.literal('plate'), id }),
]);
const attachmentRef = z.strictObject({ partId: id, siteId: id });
const angularConstraint = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('free'), preferredRad: z.number().exactOptional() }),
  z.strictObject({ mode: z.literal('fixed'), radians: z.number() }),
]);
const variant = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('automatic'), preferredTypeId: id.exactOptional() }),
  z.strictObject({ mode: z.literal('fixed'), typeId: id }),
]);
const appearance = z.strictObject({ colour: id });
const endpoint = z.strictObject({
  junctionId: id,
  orientation: quaternion,
  roll: angularConstraint,
});
const tube = z.strictObject({
  id,
  familyId: id,
  a: endpoint,
  b: endpoint,
  variant,
  appearance: appearance.exactOptional(),
});
const mount = z.strictObject({
  plateSiteId: id,
  tubeId: id,
  stationMm: z.number().nonnegative(),
  hole: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('automatic') }),
    z.strictObject({ mode: z.literal('fixed'), tubeTypeId: id, siteId: id }),
  ]),
});
const plate = z.strictObject({
  id,
  familyId: id,
  variant,
  placement: z.strictObject({ junctionId: id, pose }),
  mounts: z.array(mount),
  appearance: appearance.exactOptional(),
});
const design = z.strictObject({
  id,
  catalog: z.strictObject({ id, version: id }),
  tubes: z.array(tube),
  junctions: z.array(z.strictObject({ id })),
  plates: z.array(plate),
  anchors: z.array(z.strictObject({ id, target: intentRef, worldPose: pose })),
});
const realization = z.strictObject({
  parts: z.array(z.strictObject({
    id,
    typeId: id,
    origin: z.strictObject({ intent: intentRef, role: id }),
  })),
  connections: z.array(z.strictObject({
    id,
    a: attachmentRef,
    b: attachmentRef,
    typeId: id,
    parameters: z.record(id, z.number()),
  })),
  plateMounts: z.array(z.strictObject({
    plateId: id,
    plateSiteId: id,
    tubeId: id,
    tubeHole: attachmentRef,
    connectionId: id,
  })),
  poses: z.array(z.strictObject({ partId: id, worldPose: pose })),
  intentPoses: z.array(z.strictObject({ intent: intentRef, worldPose: pose })),
});

// Checked against the domain contract without making it depend on Zod.
const snapshot = z.strictObject({
  revision: z.number().int().nonnegative(),
  design,
  realization,
}) satisfies z.ZodType<ConstructionSnapshot>;

/** Version 1 of the persisted wire format; unknown properties are rejected. */
export const ConstructionDocumentSchema = z.strictObject({
  format: z.literal('qad-construction'),
  schemaVersion: z.literal(1),
  snapshot,
});

/** File types come from schemas; domain interfaces remain library-independent. */
export type ConstructionDocument = DeepReadonly<z.infer<typeof ConstructionDocumentSchema>>;

type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
