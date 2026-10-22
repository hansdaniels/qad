import * as z from 'zod';
import { ConstructionDocumentSchema, FragmentSchema } from './document-schema.js';
import type { ConstructionDocument } from './document-schema.js';
import type { Fragment } from './clipboard.js';
import type { Diagnostic, Result } from './diagnostics.js';

// Accept other fields here so that a future document version is recognised before
// applying version 1's strict nested schemas.
const envelope = z.looseObject({
  format: z.literal('qad-construction'),
  schemaVersion: z.number().int().positive(),
});

/**
 * Parses JSON and checks format only. Success does not certify buildability and
 * must not be used to commit a snapshot without subsequent domain validation.
 */
export function parseConstructionDocument(json: string): Result<ConstructionDocument> {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return failure('invalid-data', 'Die Datei enthält kein gültiges JSON.');
  }

  const header = envelope.safeParse(input);
  if (header.success && header.data.schemaVersion !== 1) {
    return failure('unsupported-schema', 'Diese Dateiversion wird nicht unterstützt.');
  }

  const result = ConstructionDocumentSchema.safeParse(input);
  if (!result.success) return invalid(result.error);
  return { ok: true, value: result.data, diagnostics: [] };
}

/** Parses copied parts; like a document, they still need domain validation. */
export function parseFragmentJson(json: string): Result<Fragment> {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return failure('invalid-data', 'Die Zwischenablage enthält keine kopierten Teile.');
  }
  const result = FragmentSchema.safeParse(input);
  if (!result.success) return invalid(result.error);
  return { ok: true, value: result.data, diagnostics: [] };
}

function invalid(error: z.ZodError): Result<never> {
  return {
    ok: false,
    diagnostics: error.issues.map((issue): Diagnostic => ({
      code: 'invalid-data',
      severity: 'error',
      message: issue.message,
      subjects: [],
      details: {
        // JSON Pointer: also unambiguous for parameter keys containing / or ~.
        path:
          issue.path.length === 0
            ? ''
            : '/' + issue.path.map((key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1')).join('/'),
        validationCode: issue.code,
      },
    })),
  };
}

function failure(code: Diagnostic['code'], message: string): Result<never> {
  return { ok: false, diagnostics: [{ code, severity: 'error', message, subjects: [] }] };
}
