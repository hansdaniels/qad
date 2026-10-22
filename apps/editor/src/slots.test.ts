import { expect, test } from 'vite-plus/test';
import { activeSlot, claimSlot, heldSlots, recentSlots, switchSlot, writeSlot, type SlotBackend } from './slots';

/** A browser: storage shared by all tabs, locks held per tab. */
function browser() {
  const local = new Map<string, string>();
  const held = new Set<string>();
  let clock = 0;
  let ids = 0;
  const storage = (map: Map<string, string>) => ({
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  });
  const locks = {
    request: (name: string, _options: unknown, callback: (lock: unknown) => Promise<void> | undefined) => {
      if (held.has(name)) return Promise.resolve(callback(null));
      held.add(name);
      return Promise.resolve(callback({ name })).then(() => void held.delete(name));
    },
    query: () => Promise.resolve({ held: [...held].map((name) => ({ name })) }),
  } as unknown as SlotBackend['locks'];
  /** A tab; the same session storage again stands for a reload or a duplicated tab. */
  const tab = (session = new Map<string, string>()): SlotBackend & { session: ReturnType<typeof storage> } => ({
    local: storage(local),
    session: storage(session),
    locks,
    now: () => ++clock,
    newId: () => `s${++ids}`,
  });
  return { local, held, tab };
}
const info = (title: string) => ({ title, fileName: `${title}.json`, unsaved: true });

test('two tabs get slots of their own; a reload keeps its slot', async () => {
  const b = browser();
  const session = new Map<string, string>();
  const first = await claimSlot(b.tab(session));
  const second = await claimSlot(b.tab());
  expect(first.id).not.toBe(second.id);
  writeSlot(first.id, '{"a":1}', info('Garten'), b.tab());
  writeSlot(second.id, '{"b":2}', info('Turm'), b.tab());
  first.release();
  await Promise.resolve();
  expect((await claimSlot(b.tab(session))).id).toBe(first.id);
});

test('a duplicated tab carries on with a copy, since the original still holds the slot', async () => {
  const b = browser();
  const session = new Map<string, string>();
  const original = await claimSlot(b.tab(session));
  writeSlot(original.id, '{"a":1}', info('Garten'), b.tab());
  const duplicate = await claimSlot(b.tab(new Map(session)));
  expect(duplicate.id).not.toBe(original.id);
  expect(b.local.get(`qad:slot:${duplicate.id}:model`)).toBe('{"a":1}');
});

test('the first tab after a browser start takes the model last changed; further new tabs start fresh', async () => {
  const b = browser();
  writeSlot('old', '{"a":1}', info('Alt'), b.tab());
  writeSlot('new', '{"b":2}', info('Neu'), b.tab());
  const first = await claimSlot(b.tab());
  expect(first.id).toBe('new');
  const next = await claimSlot(b.tab());
  expect(['old', 'new']).not.toContain(next.id);
});

test('a slot open in another tab cannot be taken; a free one can, and the tab gives up its own', async () => {
  const b = browser();
  const one = await claimSlot(b.tab());
  const two = await claimSlot(b.tab());
  expect(await switchSlot(two, one.id, b.tab())).toBeUndefined();
  writeSlot('free', '{}', info('Frei'), b.tab());
  const moved = await switchSlot(two, 'free', b.tab());
  expect(moved?.id).toBe('free');
  await Promise.resolve();
  expect(b.held.has(`qad:slot:${two.id}`)).toBe(false);
});

test('the model of earlier versions becomes a slot; only the newest slots are kept, blank ones not at all', async () => {
  const b = browser();
  b.local.set('qad:model', '{"alt":true}');
  b.local.set('qad:model-info', JSON.stringify({ fileName: 'garten.json', unsaved: false }));
  const slot = await claimSlot(b.tab());
  expect(b.local.get(`qad:slot:${slot.id}:model`)).toBe('{"alt":true}');
  expect(recentSlots(b.tab())[0]).toMatchObject({ title: 'garten', unsaved: false });
  for (let i = 0; i < 20; i++) writeSlot(`m${i}`, '{}', info(`M${i}`), b.tab());
  expect(recentSlots(b.tab())).toHaveLength(13);
  writeSlot('m19', undefined, info('M19'), b.tab());
  expect(recentSlots(b.tab()).some((s) => s.id === 'm19')).toBe(false);
});

test('a page that lost track of its slot, e.g. after a hot reload, still lets go of it and never counts it as another tab', async () => {
  const b = browser();
  const page = b.tab();
  const first = await claimSlot(page);
  writeSlot('other', '{}', info('Anderes'), page);
  // As if the app no longer knew the slot it holds: releasing does nothing.
  const moved = await switchSlot({ id: first.id, release: () => {} }, 'other', page);
  expect(moved?.id).toBe('other');
  expect(activeSlot(page)?.id).toBe('other');
  await Promise.resolve();
  expect(b.held.has(`qad:slot:${first.id}`)).toBe(false);
  expect(await heldSlots(page)).toEqual(new Set());
  const elsewhere = await claimSlot(b.tab());
  expect(await heldSlots(page)).toEqual(new Set([elsewhere.id]));
});
