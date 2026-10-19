import {
  encodeConstruction,
  importPlan,
  openConstruction,
  quadroArticleCatalog,
  quadroPartCatalog,
  type ConstructionSnapshot,
  type Diagnostic,
  type ModelCore,
  type Result,
} from '@qad/model-core';
import { demoModel } from './demo';
import { modelOptions } from './models';

// Browser storage keeps the model across reloads; files are the way to keep it for good.
const MODEL = 'qad:model';
const INFO = 'qad:model-info';
const BROKEN = 'qad:model-broken';

export const DEFAULT_FILE_NAME = 'gbk-modell.json';

export interface StoredInfo {
  readonly fileName: string;
  /** Changed since the last file was saved or opened. */
  readonly unsaved: boolean;
}

export interface Restored {
  readonly core: ModelCore;
  readonly info: StoredInfo;
  /** Why the stored model could not be opened; the demo model is used instead. */
  readonly problems?: readonly Diagnostic[];
}

/** The model from the last session, else the demo model. */
export function restoreModel(): Restored {
  const fresh = { core: demoModel(), info: { fileName: DEFAULT_FILE_NAME, unsaved: false } };
  let json: string | null = null;
  let info: StoredInfo | undefined;
  try {
    json = localStorage.getItem(MODEL);
    info = JSON.parse(localStorage.getItem(INFO) ?? 'null') ?? undefined;
  } catch {
    // Storage blocked or info unreadable: start fresh.
  }
  if (json === null) return fresh;
  const opened = openModel(json);
  if (opened.ok) {
    return {
      core: opened.value,
      info: { fileName: info?.fileName ?? DEFAULT_FILE_NAME, unsaved: info?.unsaved ?? true },
    };
  }
  try {
    // Keep it for inspection; the next autosave overwrites the model key.
    localStorage.setItem(BROKEN, json);
  } catch {
    // Nothing more to do.
  }
  return { ...fresh, problems: opened.diagnostics };
}

export function storeModel(snapshot: ConstructionSnapshot, info: StoredInfo): void {
  try {
    localStorage.setItem(MODEL, encodeConstruction(snapshot));
    localStorage.setItem(INFO, JSON.stringify(info));
  } catch {
    // Storage full or blocked; saving to a file still works.
  }
}

export function openModel(json: string): Result<ModelCore> {
  return openConstruction(json, quadroPartCatalog, modelOptions);
}

/** Builds a model from a building plan (BAUPLAN.md). */
export function openPlan(json: string): Result<ModelCore> {
  return importPlan(json, quadroPartCatalog, quadroArticleCatalog, modelOptions);
}

/** Offers the model as a JSON file to download. */
export function downloadModel(snapshot: ConstructionSnapshot, fileName: string): void {
  download(encodeConstruction(snapshot), 'application/json', fileName);
}

export function download(content: string, type: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
