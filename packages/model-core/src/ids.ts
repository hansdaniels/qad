/** IDs are persistent, opaque strings; allocation belongs to the application. */
export type ConstructionId = string;
export type TubeId = string;
export type JunctionId = string;
export type PlateId = string;
export type SlideId = string;
export type PartId = string;
export type ConnectionId = string;
export type AnchorId = string;
export type PartTypeId = string;
export type FamilyId = string;
/** Key of ArticleCatalog.colours, e.g. 'red'. */
export type ColourId = string;
export type SiteId = string;
export type ConnectionTypeId = string;

/** Local site IDs are unique within a part type, never globally. */
export interface AttachmentRef {
  readonly partId: PartId;
  readonly siteId: SiteId;
}

export type IntentRef =
  | { readonly kind: 'tube'; readonly id: TubeId }
  | { readonly kind: 'junction'; readonly id: JunctionId }
  | { readonly kind: 'plate'; readonly id: PlateId }
  | { readonly kind: 'slide'; readonly id: SlideId };

export type TubeEnd = 'a' | 'b';

export interface TubeEndRef {
  readonly tubeId: TubeId;
  readonly end: TubeEnd;
}
