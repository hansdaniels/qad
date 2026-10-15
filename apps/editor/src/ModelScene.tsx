import { useMemo, type ReactNode } from 'react';
import {
  findOpenEnds,
  quadroArticleCatalog,
  quadroCollisionGeometry,
  quadroPartCatalog,
  resolveArticle,
  type ConstructionSnapshot,
  type PartId,
} from '@qad/model-core';
import { displayColour } from './colours';
import { PartMesh } from './PartMesh';

const types = new Map(quadroPartCatalog.partTypes.map((t) => [t.id, t]));

/** Requested colour of a tube or plate intent; parts of junctions take the catalog default. */
function requestedColour(snapshot: ConstructionSnapshot, partId: PartId): string | undefined {
  const part = snapshot.realization.parts.find((p) => p.id === partId);
  if (!part) return undefined;
  const { intent } = part.origin;
  if (intent.kind === 'tube') return snapshot.design.tubes.find((t) => t.id === intent.id)?.appearance.colour;
  if (intent.kind === 'plate') return snapshot.design.plates.find((p) => p.id === intent.id)?.appearance.colour;
  return undefined;
}

/** Parts with pose, collision shapes and resolved article. */
export function useParts(snapshot: ConstructionSnapshot) {
  return useMemo(
    () =>
      snapshot.realization.parts.map((part) => {
        const pose = snapshot.realization.poses.find((p) => p.partId === part.id)?.worldPose;
        const type = types.get(part.typeId);
        const shapes = (type && quadroCollisionGeometry.shapes(type.geometry.collision)) ?? [];
        const article = resolveArticle(quadroArticleCatalog, part.typeId, requestedColour(snapshot, part.id));
        return { part, pose, shapes, article };
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
  readonly selected: PartId | undefined;
  readonly onSelect: (id: PartId) => void;
  /** Candidate of a pending edit; its new or changed parts are drawn as ghosts. */
  readonly candidate?: ConstructionSnapshot | undefined;
  /** Further content in model coordinates, e.g. virtual arms. */
  readonly children?: ReactNode;
}

/** Parts of the candidate that are new, retyped or moved compared with the snapshot. */
function GhostParts({ snapshot, candidate }: { snapshot: ConstructionSnapshot; candidate: ConstructionSnapshot }) {
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
          />
        ) : null,
      )}
    </>
  );
}

/** The realised model in model coordinates (z up), turned into the y-up Three.js world. */
export function ModelScene({ snapshot, selected, onSelect, candidate, children }: ModelSceneProps) {
  const parts = useParts(snapshot);
  const openEnds = useOpenEnds(snapshot);
  return (
    <group name="model" rotation={[-Math.PI / 2, 0, 0]}>
      {parts.map(({ part, pose, shapes, article }) =>
        pose ? (
          <PartMesh
            key={part.id}
            name={part.id}
            pose={pose}
            shapes={shapes}
            colour={displayColour(article?.article.colour)}
            selected={part.id === selected}
            onSelect={() => onSelect(part.id)}
          />
        ) : null,
      )}
      {openEnds.map(({ key, position }) => (
        <mesh key={key} name={`open:${key}`} position={[position.x, position.y, position.z]}>
          <sphereGeometry args={[12, 16, 16]} />
          <meshStandardMaterial color="#ff7a00" />
        </mesh>
      ))}
      {candidate ? <GhostParts snapshot={snapshot} candidate={candidate} /> : null}
      {children}
    </group>
  );
}
