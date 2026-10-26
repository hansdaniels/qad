import { useMemo, type ReactNode } from 'react';
import { Box3, type Object3D } from 'three';
import {
  articleEntryId,
  findOpenEnds,
  quadroArticleCatalog,
  quadroCollisionGeometry,
  quadroDisplayGeometry,
  quadroPartCatalog,
  requestedColour,
  resolveArticle,
  type ConstructionSnapshot,
  type PartId,
} from '@qad/model-core';
import { displayColour } from './colours';
import { explodedOf, type Exploded } from './explode';
import { PartMesh } from './PartMesh';

const types = new Map(quadroPartCatalog.partTypes.map((t) => [t.id, t]));

/** Placed junctions without tubes, e.g. the start point of an empty model. */
function useLoneJunctions(snapshot: ConstructionSnapshot) {
  return useMemo(() => {
    const used = new Set(snapshot.design.tubes.flatMap((t) => [t.a.junctionId, t.b.junctionId]));
    return snapshot.realization.intentPoses.flatMap((p) =>
      p.intent.kind === 'junction' && !used.has(p.intent.id)
        ? [{ id: p.intent.id, position: p.worldPose.position }]
        : [],
    );
  }, [snapshot]);
}

/** Parts with pose, display shapes (collision shapes where a part has none) and resolved article. */
export function useParts(snapshot: ConstructionSnapshot) {
  return useMemo(
    () =>
      snapshot.realization.parts.map((part) => {
        const pose = snapshot.realization.poses.find((p) => p.partId === part.id)?.worldPose;
        const type = types.get(part.typeId);
        const shapes =
          (type &&
            (quadroDisplayGeometry.shapes(type.geometry.display) ??
              quadroCollisionGeometry.shapes(type.geometry.collision))) ??
          [];
        const article = resolveArticle(
          quadroArticleCatalog,
          articleEntryId(quadroPartCatalog, part.typeId),
          requestedColour(snapshot, part),
        );
        return { part, pose, shapes, article, type };
      }),
    [snapshot],
  );
}

/** Open tube ends at their junction points. */
export function useOpenEnds(snapshot: ConstructionSnapshot) {
  return useMemo(
    () =>
      findOpenEnds(snapshot.design).flatMap((end) => {
        const frame = snapshot.realization.intentPoses.find(
          (p) => p.intent.kind === 'junction' && p.intent.id === end.junctionId,
        );
        return frame ? [{ key: `${end.tubeId}:${end.end}`, position: frame.worldPose.position }] : [];
      }),
    [snapshot],
  );
}

interface ModelSceneProps {
  readonly snapshot: ConstructionSnapshot;
  readonly selected: ReadonlySet<PartId> | undefined;
  /** Further parts drawn like the selected ones, e.g. those of a parts-list line. */
  readonly highlighted?: ReadonlySet<PartId> | undefined;
  /** additive: to add the part to the selection or take it out. */
  readonly onSelect: (id: PartId, additive: boolean) => void;
  /** Alt+click on a part: take its colour. */
  readonly onPipette?: ((id: PartId) => void) | undefined;
  /** The part under the pointer, or undefined when it leaves. */
  readonly onPoint?: ((id: PartId | undefined) => void) | undefined;
  /** Candidate of a pending edit; its new or changed parts are drawn as ghosts. */
  readonly candidate?: ConstructionSnapshot | undefined;
  /** Clicking a ghost carries out the pending edit. */
  readonly onGhostClick?: (() => void) | undefined;
  /** Pointer entering or leaving a ghost. */
  readonly onGhostHover?: ((inside: boolean) => void) | undefined;
  /** How parts of the snapshot are marked, e.g. by what a rebuild does to them. */
  readonly marks?: ReadonlyMap<PartId, Mark> | undefined;
  /** Parts of another state drawn as well, e.g. those a rebuild removes; never pickable. */
  readonly others?: { readonly snapshot: ConstructionSnapshot; readonly marks: ReadonlyMap<PartId, Mark> } | undefined;
  /** Exploded view: tubes and plates smaller, connector arms showing. */
  readonly exploded?: boolean | undefined;
  /** Further content in model coordinates, e.g. virtual arms. */
  readonly children?: ReactNode;
}

/** Contour colour and see-through of a part, keeping its own colour. */
export interface Mark {
  readonly outline?: string;
  readonly opacity?: number;
}

/** The marked parts of another state, e.g. those gone after a rebuild. */
function OtherParts({ snapshot, marks }: { snapshot: ConstructionSnapshot; marks: ReadonlyMap<PartId, Mark> }) {
  const parts = useParts(snapshot);
  return (
    <>
      {parts.map(({ part, pose, shapes, article }) => {
        const mark = marks.get(part.id);
        return pose && mark ? (
          <PartMesh
            key={`other:${part.id}`}
            name={`other:${part.id}`}
            pose={pose}
            shapes={shapes}
            colour={displayColour(article?.article.colour)}
            selected={false}
            outline={mark.outline}
            opacity={mark.opacity ?? 0.35}
          />
        ) : null;
      })}
    </>
  );
}

/** Parts of the candidate that are new, retyped or moved compared with the snapshot. */
function GhostParts({
  snapshot,
  candidate,
  onClick,
  onHover,
}: {
  snapshot: ConstructionSnapshot;
  candidate: ConstructionSnapshot;
  onClick: (() => void) | undefined;
  onHover: ((inside: boolean) => void) | undefined;
}) {
  const parts = useParts(candidate);
  const changed = parts.filter(({ part, pose }) => {
    const before = snapshot.realization.parts.find((p) => p.id === part.id);
    const was = snapshot.realization.poses.find((p) => p.partId === part.id)?.worldPose.position;
    const now = pose?.position;
    const moved = !was || !now || Math.hypot(was.x - now.x, was.y - now.y, was.z - now.z) > 0.5;
    return !before || before.typeId !== part.typeId || moved;
  });
  return (
    <>
      {changed.map(({ part, pose, shapes, article }) =>
        pose ? (
          <PartMesh
            key={`ghost:${part.id}`}
            name={`ghost:${part.id}`}
            pose={pose}
            shapes={shapes}
            colour={displayColour(article?.article.colour)}
            selected={false}
            ghost
            {...(onClick ? { onSelect: onClick } : {})}
            {...(onHover ? { onHover } : {})}
          />
        ) : null,
      )}
    </>
  );
}

/** Props of a part in the exploded view; a change's contour wins over the drawing's lines. */
function drawn(exploded: Exploded | undefined, outline: string | undefined) {
  if (!exploded) return {};
  const { drawing, ...rest } = exploded;
  if (!drawing) return rest;
  // Drawing lines thin out as one zooms out; a change's contour stays as strong on screen as elsewhere.
  return outline
    ? { ...rest, colour: drawing.colour, outline }
    : { ...rest, colour: drawing.colour, outline: drawing.outline, outlineMm: drawing.lineMm };
}

/** World box of the built model: parts, open ends and lone junctions, without previews or targets. */
export function builtBox(scene: Object3D): Box3 {
  const box = new Box3();
  const model = scene.getObjectByName('model');
  if (!model) return box;
  model.updateWorldMatrix(true, true);
  for (const child of model.children) {
    if (child.name && !/^(ghost:|other:|virtual-arms$|plate-spots$|slide-spots$)/.test(child.name))
      box.expandByObject(child);
  }
  return box;
}

/** The realised model in model coordinates (z up), turned into the y-up Three.js world. */
export function ModelScene({
  snapshot,
  selected,
  highlighted,
  onSelect,
  onPipette,
  onPoint,
  candidate,
  onGhostClick,
  onGhostHover,
  marks,
  others,
  exploded,
  children,
}: ModelSceneProps) {
  const parts = useParts(snapshot);
  const openEnds = useOpenEnds(snapshot);
  const lone = useLoneJunctions(snapshot);
  return (
    <group name="model" rotation={[-Math.PI / 2, 0, 0]}>
      {parts.map(({ part, pose, shapes, article, type }) =>
        pose ? (
          <PartMesh
            key={part.id}
            name={part.id}
            pose={pose}
            shapes={shapes}
            colour={displayColour(article?.article.colour)}
            selected={(selected?.has(part.id) ?? false) || (highlighted?.has(part.id) ?? false)}
            outline={marks?.get(part.id)?.outline}
            {...(marks?.get(part.id)?.opacity === undefined ? {} : { opacity: marks.get(part.id)!.opacity! })}
            {...(exploded ? drawn(explodedOf(type, shapes), marks?.get(part.id)?.outline) : {})}
            onSelect={(additive, alt) => (alt && onPipette ? onPipette(part.id) : onSelect(part.id, additive))}
            onPoint={(inside) => onPoint?.(inside ? part.id : undefined)}
          />
        ) : null,
      )}
      {openEnds.map(({ key, position }) => (
        <mesh key={key} name={`open:${key}`} position={[position.x, position.y, position.z]}>
          <sphereGeometry args={[12, 16, 16]} />
          <meshStandardMaterial color="#ff7a00" />
        </mesh>
      ))}
      {lone.map(({ id, position }) => (
        <mesh key={id} name={`junction:${id}`} position={[position.x, position.y, position.z]}>
          <sphereGeometry args={[25, 24, 24]} />
          <meshStandardMaterial color="#6b7480" />
        </mesh>
      ))}
      {others ? <OtherParts snapshot={others.snapshot} marks={others.marks} /> : null}
      {candidate ? (
        <GhostParts snapshot={snapshot} candidate={candidate} onClick={onGhostClick} onHover={onGhostHover} />
      ) : null}
      {children}
    </group>
  );
}
