/**
 * One storage slot per browser tab, so models in several tabs do not overwrite
 * each other. A slot lives in localStorage and outlasts reloads and browser
 * restarts; the tab keeps its slot's ID in sessionStorage, which belongs to the
 * tab. While a tab is open it holds a Web Lock on its slot, so other tabs see
 * which slots are taken.
 */

export interface SlotInfo {
  readonly id: string;
  /** The model's name, else its file name without extension. */
  readonly title: string;
  readonly fileName: string;
  /** Changed since the last file was saved or opened. */
  readonly unsaved: boolean;
  /** Milliseconds since 1970. */
  readonly changedAt: number;
}

/** The slot a tab holds; release lets another tab take it. */
export interface Slot {
  readonly id: string;
  readonly release: () => void;
}

/** Where slots live; the browser's storage and locks, or stand-ins in tests. */
export interface SlotBackend {
  readonly local: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
  readonly session: Pick<Storage, 'getItem' | 'setItem'>;
  /** Missing where the browser offers none, e.g. on plain http away from localhost. */
  readonly locks?: Pick<LockManager, 'request' | 'query'> | undefined;
  readonly now: () => number;
  readonly newId: () => string;
}

const PREFIX = 'qad:slot:';
const TAB = 'qad:tab';
/** Slots from before there were slots: one model for all tabs. */
const LEGACY = { model: 'qad:model', info: 'qad:model-info' };
/** Set once anything was stored, so only the very first start shows the demo model. */
const SEEN = 'qad:seen';
/** Slots kept besides the tab's own; older ones are dropped. */
const KEEP = 12;

/**
 * Locks this page holds, per tab backend: normally just its slot's. Kept here
 * rather than in React state, so a remounted App (hot reload) still knows them.
 */
const mine = new WeakMap<object, Map<string, () => void>>();
const minesOf = (backend: SlotBackend) => {
  let held = mine.get(backend.session);
  if (!held) mine.set(backend.session, (held = new Map()));
  return held;
};
/** The slot this page works in, per tab backend. */
const active = new WeakMap<object, Slot>();

/** The slot this page works in, once claimed. */
export function activeSlot(backend: SlotBackend = browserBackend()): Slot | undefined {
  return active.get(backend.session);
}

const modelKey = (id: string) => `${PREFIX}${id}:model`;
const infoKey = (id: string) => `${PREFIX}${id}:info`;
const lockName = (id: string) => `${PREFIX}${id}`;

export function browserBackend(): SlotBackend {
  return {
    local: localStorage,
    session: sessionStorage,
    locks: typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : undefined,
    now: () => Date.now(),
    newId: () => crypto.randomUUID().slice(0, 8),
  };
}

/** Holds the slot's lock until released; undefined when another tab holds it. */
async function acquire(backend: SlotBackend, id: string): Promise<(() => void) | undefined> {
  const { locks } = backend;
  const held = minesOf(backend);
  const own = held.get(id);
  if (own) return own;
  if (!locks) return () => {};
  return new Promise((resolve) => {
    void locks.request(lockName(id), { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(undefined);
        return undefined;
      }
      return new Promise<void>((done) => {
        const release = () => {
          held.delete(id);
          done();
        };
        held.set(id, release);
        resolve(release);
      });
    });
  });
}

/** Works in the slot from now on and lets go of any other this page still holds. */
function slot(backend: SlotBackend, id: string, release: () => void): Slot {
  backend.session.setItem(TAB, id);
  for (const [other, letGo] of minesOf(backend)) if (other !== id) letGo();
  const taken = { id, release };
  active.set(backend.session, taken);
  return taken;
}

/**
 * The slot for this tab: its own after a reload; a copy of it in a duplicated
 * tab, whose original still holds it; in the first tab after a browser start
 * without restored tabs the slot last changed; else a new one.
 */
export async function claimSlot(backend: SlotBackend = browserBackend()): Promise<Slot> {
  migrate(backend);
  const own = backend.session.getItem(TAB);
  if (own) {
    const release = await acquire(backend, own);
    if (release) return slot(backend, own, release);
    const copy = backend.newId();
    copySlot(backend, own, copy);
    return slot(backend, copy, (await acquire(backend, copy)) ?? (() => {}));
  }
  const held = await heldSlots(backend);
  if (held.size === 0) {
    for (const s of recentSlots(backend)) {
      const release = await acquire(backend, s.id);
      if (release) return slot(backend, s.id, release);
    }
  }
  const id = backend.newId();
  return slot(backend, id, (await acquire(backend, id)) ?? (() => {}));
}

/** Takes another slot for this tab, giving up the current one; undefined when another tab holds it. */
export async function switchSlot(current: Slot, id: string, backend = browserBackend()): Promise<Slot | undefined> {
  if (id === current.id) return current;
  const release = await acquire(backend, id);
  if (!release) return undefined;
  current.release();
  return slot(backend, id, release);
}

/** A new, empty slot for this tab, e.g. for a new model; the current one stays among the recent ones. */
export function freshSlot(current: Slot, backend = browserBackend()): Promise<Slot> {
  return switchSlot(current, backend.newId(), backend).then((s) => s!);
}

/** Slots held by other open tabs; those of this page never count. */
export async function heldSlots(backend: SlotBackend = browserBackend()): Promise<Set<string>> {
  if (!backend.locks) return new Set();
  const { held = [] } = await backend.locks.query();
  const own = minesOf(backend);
  return new Set(
    held.flatMap((l) => {
      const id = l.name?.startsWith(PREFIX) ? l.name.slice(PREFIX.length) : undefined;
      return id && !own.has(id) ? [id] : [];
    }),
  );
}

/** Stored slots, last changed first. */
export function recentSlots(backend: SlotBackend = browserBackend()): SlotInfo[] {
  const infos: SlotInfo[] = [];
  for (let i = 0; i < backend.local.length; i++) {
    const key = backend.local.key(i);
    const id = key?.startsWith(PREFIX) && key.endsWith(':info') ? key.slice(PREFIX.length, -':info'.length) : undefined;
    const info = id ? readInfo(backend, id) : undefined;
    if (info) infos.push(info);
  }
  return infos.sort((a, b) => b.changedAt - a.changedAt);
}

function readInfo(backend: SlotBackend, id: string): SlotInfo | undefined {
  try {
    const raw = JSON.parse(backend.local.getItem(infoKey(id)) ?? 'null') as Partial<SlotInfo> | null;
    if (!raw || typeof raw.fileName !== 'string') return undefined;
    return {
      id,
      title: typeof raw.title === 'string' ? raw.title : raw.fileName,
      fileName: raw.fileName,
      unsaved: raw.unsaved !== false,
      changedAt: typeof raw.changedAt === 'number' ? raw.changedAt : 0,
    };
  } catch {
    return undefined;
  }
}

/** The stored model JSON and info of a slot. */
export function readSlot(
  id: string,
  backend: SlotBackend = browserBackend(),
): { readonly json: string; readonly info: SlotInfo | undefined } | undefined {
  const json = backend.local.getItem(modelKey(id));
  return json === null ? undefined : { json, info: readInfo(backend, id) };
}

/** Whether nothing was ever stored, e.g. on the very first start. */
export function firstStart(backend: SlotBackend = browserBackend()): boolean {
  return backend.local.getItem(SEEN) === null;
}

/**
 * Stores the tab's model, or forgets the slot when the model is empty, so blank
 * tabs do not crowd the recent ones; then drops the oldest beyond KEEP.
 */
export function writeSlot(
  id: string,
  json: string | undefined,
  info: Omit<SlotInfo, 'id' | 'changedAt'>,
  backend: SlotBackend = browserBackend(),
): void {
  if (json === undefined) {
    forgetSlot(id, backend);
    return;
  }
  backend.local.setItem(SEEN, '1');
  backend.local.setItem(modelKey(id), json);
  backend.local.setItem(infoKey(id), JSON.stringify({ ...info, changedAt: backend.now() }));
  for (const old of recentSlots(backend)
    .filter((s) => s.id !== id)
    .slice(KEEP)) {
    forgetSlot(old.id, backend);
  }
}

export function forgetSlot(id: string, backend: SlotBackend = browserBackend()): void {
  backend.local.removeItem(modelKey(id));
  backend.local.removeItem(infoKey(id));
}

function copySlot(backend: SlotBackend, from: string, to: string) {
  const json = backend.local.getItem(modelKey(from));
  const info = backend.local.getItem(infoKey(from));
  if (json !== null) backend.local.setItem(modelKey(to), json);
  if (info !== null) backend.local.setItem(infoKey(to), info);
}

/** The one model of earlier versions becomes a slot of its own. */
function migrate(backend: SlotBackend) {
  const json = backend.local.getItem(LEGACY.model);
  if (json === null) return;
  const id = backend.newId();
  let info: Partial<SlotInfo> = {};
  try {
    info = (JSON.parse(backend.local.getItem(LEGACY.info) ?? 'null') as Partial<SlotInfo> | null) ?? {};
  } catch {
    // Without info the slot still keeps the model.
  }
  const fileName = info.fileName ?? 'gbk-modell.json';
  backend.local.setItem(modelKey(id), json);
  backend.local.setItem(
    infoKey(id),
    JSON.stringify({
      title: fileName.replace(/\.json$/i, ''),
      fileName,
      unsaved: info.unsaved ?? true,
      changedAt: backend.now(),
    }),
  );
  backend.local.setItem(SEEN, '1');
  backend.local.removeItem(LEGACY.model);
  backend.local.removeItem(LEGACY.info);
}
