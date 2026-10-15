import type { AttachmentRef, ConnectionId, IntentRef, PartId } from './ids.js';

export type SubjectRef =
  | { readonly kind: 'intent'; readonly ref: IntentRef }
  | { readonly kind: 'part'; readonly id: PartId }
  | { readonly kind: 'attachment'; readonly ref: AttachmentRef }
  | { readonly kind: 'connection'; readonly id: ConnectionId };

export type DiagnosticCode =
  | 'invalid-data'
  | 'catalog-mismatch'
  | 'missing-reference'
  | 'duplicate-id'
  | 'duplicate-member'
  | 'incompatible-attachment'
  | 'attachment-occupied'
  | 'no-realization'
  | 'fixed-variant-conflict'
  | 'plate-mount-conflict'
  | 'loop-closure-conflict'
  | 'connection-misfit'
  | 'junction-angle-unsupported'
  | 'collision'
  | 'crossing'
  | 'clearance'
  | 'missing-catalog-data'
  | 'unresolved-placement'
  | 'stale-revision'
  | 'unsupported-schema';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly subjects: readonly SubjectRef[];
  /** Machine-readable facts for editor localisation and measurements. */
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
