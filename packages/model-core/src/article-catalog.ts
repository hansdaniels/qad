import type { ColourId, FamilyId, PartTypeId } from './ids.js';

/**
 * Orderable QUADRO parts as listed by the manufacturer's shop.
 * Identifies part families and variants only; it carries no geometry and does
 * not replace PartCatalog. Numbers are designations from product names.
 */
export interface ArticleCatalog {
  readonly id: string;
  /** Retrieval date of the source data, ISO 8601. */
  readonly version: string;
  readonly source: {
    readonly overviewUrl: string;
    /** Product page URL is productBaseUrl followed by the entry id. */
    readonly productBaseUrl: string;
  };
  readonly colours: readonly Colour[];
  /** Used when no colour is requested or the requested one is not offered. */
  readonly defaultColours: Readonly<Partial<Record<ArticleCategory, ColourId>>>;
  readonly entries: readonly ArticleEntry[];
}

/**
 * Appearance.colour refers to id. The shop name is for display and matching
 * future shop data. A mix is an assortment, offered only for fasteners.
 */
export interface Colour {
  readonly id: ColourId;
  readonly name: string;
  readonly kind: 'solid' | 'mix';
}

/** One orderable colour variant. */
export interface Article {
  readonly articleNumber: string;
  readonly colour: ColourId;
}

/** initial: first implementation (SPEC 2); later: planned extension (SPEC 9). */
export type ArticleStage = 'initial' | 'later';

export interface ArticleEntryBase {
  /** Shop product handle at retrieval; intended as the future PartTypeId. */
  readonly id: PartTypeId;
  /** Entries in one family are variants the solver may exchange. */
  readonly familyId: FamilyId;
  /** German product title in the shop. */
  readonly name: string;
  readonly stage: ArticleStage;
  readonly articles: readonly Article[];
  readonly note?: string;
}

export type ConnectorKind =
  | 'spatial'
  | 'planar'
  | 'angle'
  | 'flexi'
  | 'flexi-hinge'
  | 'flexi-bolt'
  | 'hole-peg'
  | 'bearing'
  | 'double-tube'
  | 'tube-clamp';

/** Axis direction in connector coordinates. */
export type GridDirection = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export interface ConnectorArticle extends ArticleEntryBase {
  readonly category: 'connector';
  readonly connector: ConnectorKind;
  /** Number of arms as named. */
  readonly arms?: number;
  /**
   * Arms of a grid connector, a subset of the six axis directions. The connector
   * may be turned by any rotation that maps axes onto axes, so only the
   * arrangement matters. Arm positions and insertion depths are catalog geometry.
   */
  readonly armDirections?: readonly GridDirection[];
  /** Angle in the product name. */
  readonly designationDeg?: number;
}

export type TubeDrilling =
  | { readonly kind: 'standard' }
  /** The angle names the drilling variant, not a bend angle (SPEC 12). */
  | { readonly kind: 'special'; readonly designationDeg: number; readonly holes: number };

export interface TubeArticle extends ArticleEntryBase {
  readonly category: 'tube';
  readonly shape: 'straight' | 'bent';
  /** Length in the product name, not the assembled distance (SPEC 4.1). */
  readonly nominalLengthCm?: number;
  readonly drilling: TubeDrilling;
}

export type PlateKind =
  | 'solid'
  | 'perforated'
  | 'acrylic-glass'
  | 'acrylic-glass-holder'
  | 'wood-grate'
  | 'wood-grate-holder';

export interface PlateArticle extends ArticleEntryBase {
  readonly category: 'plate';
  readonly plate: PlateKind;
  /** Size in the product name. */
  readonly nominalSizeCm?: readonly [number, number];
  /** Tube lengths of the supporting frame, as stated by the shop. */
  readonly tubeGridCm?: readonly [number, number];
  readonly recess?: 'left' | 'right' | 'two-sided' | 'one-sided' | 'modular-curved-slide';
}

export interface SlideArticle extends ArticleEntryBase {
  readonly category: 'slide';
  readonly slide: 'modular-body' | 'curved-body' | 'runout';
}

export interface AccessoryArticle extends ArticleEntryBase {
  readonly category: 'accessory';
  readonly accessory: 'tube-cap' | 'ground-anchor';
}

export type FastenerKind =
  | 'tube-screw'
  | 'plate-screw'
  | 'slide-screw'
  | 'conical-slide-screw'
  | 'conical-slide-screw-counterpart'
  | 'acrylic-glass-screw'
  | 'screw-lock';

/** Sold in packs; the bill of materials counts single pieces. */
export interface FastenerArticle extends ArticleEntryBase {
  readonly category: 'fastener';
  readonly fastener: FastenerKind;
  readonly packSize: number;
}

export type ArticleEntry =
  | ConnectorArticle
  | TubeArticle
  | PlateArticle
  | SlideArticle
  | AccessoryArticle
  | FastenerArticle;

export type ArticleCategory = ArticleEntry['category'];

export interface ArticleResolution {
  readonly article: Article;
  /** A colour was requested but is not offered for this type. */
  readonly substituted: boolean;
}

/**
 * Orderable article of a part type. A colour never rules out a type: drilling
 * variants exist in fewer colours than their standard tube, so an unavailable
 * colour falls back to the category default, then to the first listed article.
 * Undefined only for an unknown type.
 */
export function resolveArticle(
  catalog: ArticleCatalog,
  typeId: PartTypeId,
  requested?: ColourId,
): ArticleResolution | undefined {
  const entry = catalog.entries.find((e) => e.id === typeId);
  if (!entry) return undefined;
  const offered = (colour: ColourId | undefined) =>
    colour === undefined ? undefined : entry.articles.find((a) => a.colour === colour);
  const article = offered(requested)
    ?? offered(catalog.defaultColours[entry.category])
    ?? entry.articles[0];
  if (!article) return undefined;
  return { article, substituted: requested !== undefined && article.colour !== requested };
}
