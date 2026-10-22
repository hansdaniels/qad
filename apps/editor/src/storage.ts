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
import { emptyModel, modelOptions } from './models';
import { firstStart, readSlot, writeSlot } from './slots';

// Browser storage keeps each tab's model across reloads (slots.ts); files are the way to keep it for good.
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
  /** Why the stored model could not be opened; an empty model is used instead. */
  readonly problems?: readonly Diagnostic[];
}

/** The model of the slot; on the very first start the demo model, else an empty one. */
export function restoreModel(slotId: string): Restored {
  let stored: ReturnType<typeof readSlot>;
  let first = false;
  try {
    stored = readSlot(slotId);
    first = firstStart();
  } catch {
    // Storage blocked: start fresh.
  }
  const fresh = { core: first ? demoModel() : emptyModel(), info: { fileName: DEFAULT_FILE_NAME, unsaved: false } };
  if (!stored) return fresh;
  const opened = openModel(stored.json);
  if (opened.ok) {
    return {
      core: opened.value,
      info: { fileName: stored.info?.fileName ?? DEFAULT_FILE_NAME, unsaved: stored.info?.unsaved ?? true },
    };
  }
  try {
    // Keep it for inspection; the next autosave overwrites the slot.
    localStorage.setItem(BROKEN, stored.json);
  } catch {
    // Nothing more to do.
  }
  return { ...fresh, problems: opened.diagnostics };
}

/** Stores the model in the tab's slot; an empty model without a name leaves no slot behind. */
export function storeModel(slotId: string, snapshot: ConstructionSnapshot, info: StoredInfo): void {
  const { design } = snapshot;
  const blank = design.tubes.length === 0 && design.name === undefined;
  try {
    writeSlot(slotId, blank ? undefined : JSON.stringify(JSON.parse(encodeConstruction(snapshot))), {
      ...info,
      title: modelTitle(design.name, info.fileName),
    });
  } catch {
    // Storage full or blocked; saving to a file still works.
  }
}

/** What a model is called: its name, else its file name without extension. */
export function modelTitle(name: string | undefined, fileName: string): string {
  return name ?? fileName.replace(/\.json$/i, '');
}

/** The file name for a model: from its name where it has one, else the file it came from. */
export function modelFileName(name: string | undefined, fileName: string): string {
  const base = name
    ?.replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return base ? `${base}.json` : fileName;
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
