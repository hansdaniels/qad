import { resolveArticle, type ArticleCatalog, type ArticleCategory, type FastenerArticle } from './article-catalog.js';
import type { PartCatalog } from './catalog.js';
import type { ConstructionSnapshot } from './core.js';
import type { ColourId, PartId } from './ids.js';
import type { PartInstance } from './realization.js';
import { length, sub, transformPoint } from './math.js';

/** One line of the bill of materials: an orderable article and how many of it. */
export interface BillLine {
  /** Article number, or the part type for parts without an article. */
  readonly key: string;
  readonly category: ArticleCategory | undefined;
  readonly name: string;
  readonly articleNumber: string | undefined;
  readonly colour: ColourId | undefined;
  /** Single pieces, also for fasteners sold in packs. */
  readonly quantity: number;
  /** Pieces that appear in this colour because the requested one is not offered. */
  readonly substituted: number;
  /** Parts counted in this line; empty for derived fasteners. */
  readonly partIds: readonly PartId[];
  readonly note?: string;
}

const CATEGORY_ORDER: readonly ArticleCategory[] = ['tube', 'connector', 'plate', 'slide', 'accessory', 'fastener'];
const ANGLE_ADAPTER = 'angle-adapter:';

/** Requested colour of a part: its tube's or plate's; connectors take the catalog default. */
export function requestedColour(snapshot: ConstructionSnapshot, part: PartInstance): ColourId | undefined {
  const { intent } = part.origin;
  if (intent.kind === 'tube') return snapshot.design.tubes.find((t) => t.id === intent.id)?.appearance.colour;
  if (intent.kind === 'plate') return snapshot.design.plates.find((p) => p.id === intent.id)?.appearance.colour;
  if (intent.kind === 'slide') return snapshot.design.slides.find((s) => s.id === intent.id)?.appearance.colour;
  return undefined;
}

/**
 * Parts of the realization grouped by article, plus derived screws (HERSTELLERREGELN.md):
 * a tube screw in the tube's colour per tube end on a connector arm or angle adapter,
 * a black plate screw per plate mount instead of the tube screw at that end, and a
 * black plate screw per angle adapter sleeve on a connector arm. Slides after the
 * manufacturer's instructions (hypothesis on counts): two conical slide screws
 * per slide at the posts, a plate screw at the top of each body, and a slide
 * screw with two counterparts where a body rests on the next slide.
 */
export function billOfMaterials(
  snapshot: ConstructionSnapshot,
  catalog: ArticleCatalog,
  partCatalog: PartCatalog,
): BillLine[] {
  const lines = new Map<string, Omit<BillLine, 'partIds'> & { partIds: PartId[] }>();
  const add = (line: Omit<BillLine, 'quantity' | 'substituted' | 'partIds'>, substituted: boolean, partId?: PartId) => {
    const existing = lines.get(line.key) ?? { ...line, quantity: 0, substituted: 0, partIds: [] };
    lines.set(line.key, {
      ...existing,
      quantity: existing.quantity + 1,
      substituted: existing.substituted + Number(substituted),
      partIds: partId ? [...existing.partIds, partId] : existing.partIds,
    });
  };
  const entries = new Map(catalog.entries.map((e) => [e.id, e]));

  for (const part of snapshot.realization.parts) {
    const entry = entries.get(part.typeId);
    const resolved = resolveArticle(catalog, part.typeId, requestedColour(snapshot, part));
    add(
      {
        key: resolved?.article.articleNumber ?? part.typeId,
        category: entry?.category,
        name: entry?.name ?? part.typeId,
        articleNumber: resolved?.article.articleNumber,
        colour: resolved?.article.colour,
        ...(entry ? {} : { note: 'Nicht im Artikelkatalog.' }),
      },
      resolved?.substituted ?? false,
      part.id,
    );
  }

  const fastener = (kind: FastenerArticle['fastener']) =>
    catalog.entries.find((e): e is FastenerArticle => e.category === 'fastener' && e.fastener === kind);
  const addScrew = (screws: FastenerArticle | undefined, colour: ColourId | undefined) => {
    if (!screws) return;
    const resolved = resolveArticle(catalog, screws.id, colour);
    add(
      {
        key: resolved?.article.articleNumber ?? screws.id,
        category: 'fastener',
        name: screws.pieceName,
        articleNumber: resolved?.article.articleNumber,
        colour: resolved?.article.colour,
      },
      resolved?.substituted ?? false,
    );
  };
  const [tubeScrews, plateScrews] = [fastener('tube-screw'), fastener('plate-screw')];
  const parts = new Map(snapshot.realization.parts.map((p) => [p.id, p]));
  // Tube ends whose hole holds a plate screw, as part ID and end site.
  const types = new Map(partCatalog.partTypes.map((t) => [t.id, t]));
  const plated = new Set<string>();
  for (const mount of snapshot.realization.plateMounts) {
    addScrew(plateScrews, 'black');
    const tube = parts.get(mount.tubeHole.partId);
    const type = tube && types.get(tube.typeId);
    const hole = type?.kind === 'tube' ? type.holes.find((h) => h.siteId === mount.tubeHole.siteId) : undefined;
    if (type?.kind !== 'tube' || !hole) continue;
    const end = hole.stationMm <= type.centerlineLengthMm / 2 ? type.ends.a : type.ends.b;
    plated.add(`${mount.tubeHole.partId}#${end}`);
  }
  const isAdapter = (p: PartInstance | undefined) => p?.origin.role.startsWith(ANGLE_ADAPTER) ?? false;
  for (const connection of snapshot.realization.connections) {
    const [a, b] = [parts.get(connection.a.partId), parts.get(connection.b.partId)];
    const tube = a?.origin.intent.kind === 'tube' ? a : b?.origin.intent.kind === 'tube' ? b : undefined;
    const other = tube === a ? b : a;
    const tubeSite = tube && (tube === a ? connection.a : connection.b).siteId;
    if (tube && other?.origin.intent.kind === 'junction') {
      if (!plated.has(`${tube.id}#${tubeSite}`)) addScrew(tubeScrews, requestedColour(snapshot, tube));
    }
    // Sleeve of an angle adapter on a connector arm.
    else if (isAdapter(a) !== isAdapter(b) && !tube) addScrew(plateScrews, 'black');
  }

  const [slideScrews, conical, counterparts] = [
    fastener('slide-screw'),
    fastener('conical-slide-screw'),
    fastener('conical-slide-screw-counterpart'),
  ];
  const poses = new Map(snapshot.realization.poses.map((p) => [p.partId, p.worldPose]));
  const hung = snapshot.realization.connections.flatMap((c) => {
    const slide = parts.get(c.b.partId);
    const tube = parts.get(c.a.partId);
    const pose = tube && poses.get(tube.id);
    const tubeType = tube && types.get(tube.typeId);
    const site = tubeType?.sites.find((s) => s.id === c.a.siteId);
    return slide?.origin.intent.kind === 'slide' && pose && site
      ? [{ slide, at: transformPoint(pose, site.frame.position) }]
      : [];
  });
  for (const { slide } of hung) {
    const type = types.get(slide.typeId);
    for (let i = 0; i < 2; i++) addScrew(conical, undefined);
    if (type?.kind !== 'slide' || !type.lowerEnd) continue;
    addScrew(plateScrews, 'black');
    const pose = poses.get(slide.id);
    const end = pose && transformPoint(pose, type.lowerEnd);
    if (end && hung.some((h) => h.slide.id !== slide.id && length(sub(h.at, end)) <= 1)) {
      addScrew(slideScrews, undefined);
      for (let i = 0; i < 2; i++) addScrew(counterparts, undefined);
    }
  }

  const order = new Map(catalog.entries.map((e, i) => [e.category === 'fastener' ? e.pieceName : e.name, i]));
  const colourIndex = new Map(catalog.colours.map((c, i) => [c.id, i]));
  const rank = (l: BillLine): number[] => [
    l.category ? CATEGORY_ORDER.indexOf(l.category) : CATEGORY_ORDER.length,
    order.get(l.name) ?? Infinity,
    l.colour ? (colourIndex.get(l.colour) ?? Infinity) : Infinity,
  ];
  return [...lines.values()].sort((x, y) => {
    const [rx, ry] = [rank(x), rank(y)];
    for (let i = 0; i < rx.length; i++) if (rx[i] !== ry[i]) return rx[i]! < ry[i]! ? -1 : 1;
    return x.key < y.key ? -1 : x.key > y.key ? 1 : 0;
  });
}
