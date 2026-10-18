import ReactThreeTestRenderer from '@react-three/test-renderer';
import { BoxGeometry, ExtrudeGeometry, Mesh, type Shape } from 'three';
import { expect, test } from 'vite-plus/test';
import { demoModel } from './demo';
import { ModelScene } from './ModelScene';

test('every realised part becomes a named group at its pose, with meshes for its shapes', async () => {
  const { snapshot } = demoModel();
  const renderer = await ReactThreeTestRenderer.create(
    <ModelScene snapshot={snapshot} selected={undefined} onSelect={() => {}} />,
  );
  const model = renderer.scene.children[0]!;
  expect(model.props.name).toBe('model');
  const groups = model.children.filter((c) => c.type === 'Group');
  const byId = (a: string, b: string) => a.localeCompare(b);
  expect(groups.map((g) => String(g.props.name)).sort(byId)).toEqual(
    snapshot.realization.parts.map((p) => p.id).sort(byId),
  );
  for (const group of groups) {
    const pose = snapshot.realization.poses.find((p) => p.partId === group.props.name)!.worldPose;
    expect(group.instance.position.toArray()).toEqual([pose.position.x, pose.position.y, pose.position.z]);
    expect(group.allChildren.some((c) => c.type === 'Mesh')).toBe(true);
  }
  const openEnds = model.children.filter((c) => String(c.props.name).startsWith('open:'));
  expect(openEnds).toHaveLength(2);
});

test('clicking a part reports its ID', async () => {
  const { snapshot } = demoModel();
  const picked: string[] = [];
  const renderer = await ReactThreeTestRenderer.create(
    <ModelScene snapshot={snapshot} selected={undefined} onSelect={(id) => picked.push(id)} />,
  );
  const tube = renderer.scene.findByProps({ name: 'tube:t1/body' });
  await renderer.fireEvent(tube, 'click');
  expect(picked).toEqual(['tube:t1/body']);
});

test('free arms are shown as stubs and a click picks the attach point', async () => {
  const { attachPoints, quadroPartCatalog } = await import('@qad/model-core');
  const { VirtualArms } = await import('./VirtualArms');
  const { snapshot } = demoModel();
  const points = attachPoints(snapshot, quadroPartCatalog);
  const picked: string[] = [];
  const renderer = await ReactThreeTestRenderer.create(
    <ModelScene snapshot={snapshot} selected={undefined} onSelect={() => {}}>
      <VirtualArms
        points={points}
        hovered={undefined}
        onHover={() => {}}
        onPick={(p) => picked.push(`${p.junctionId}:${p.direction}`)}
      />
    </ModelScene>,
  );
  const arms = renderer.scene.findAll((node) => String(node.props.name).startsWith('arm:'));
  expect(arms).toHaveLength(points.length);
  const target = renderer.scene.findByProps({ name: 'arm:j1:+z' });
  await renderer.fireEvent(target.children[0]!, 'click');
  expect(picked).toEqual(['j1:+z']);
});

test('a valid preview shows the new tube as a ghost', async () => {
  const { attachTube, quadroPartCatalog } = await import('@qad/model-core');
  const core = demoModel();
  const preview = core.preview(
    attachTube(
      core.snapshot,
      { junctionId: 'j1', direction: '+z' },
      { familyId: 'tube-25cm', colour: 'green' },
      quadroPartCatalog,
    ),
  );
  expect(preview.status).toBe('valid');
  if (preview.status !== 'valid') return;
  const renderer = await ReactThreeTestRenderer.create(
    <ModelScene snapshot={core.snapshot} selected={undefined} onSelect={() => {}} candidate={preview.candidate} />,
  );
  const ghosts = renderer.scene.findAll((node) => String(node.props.name).startsWith('ghost:'));
  expect(ghosts.map((g) => g.props.name)).toContain('ghost:tube:t7/body');
  expect(core.snapshot.revision).toBe(6);
});

test('clicking the ghost carries out the previewed edit', async () => {
  const { attachTube, quadroPartCatalog } = await import('@qad/model-core');
  const core = demoModel();
  const preview = core.preview(
    attachTube(
      core.snapshot,
      { junctionId: 'j1', direction: '+z' },
      { familyId: 'curved-tube', colour: 'green' },
      quadroPartCatalog,
      { bend: '+x' },
    ),
  );
  expect(preview.status).toBe('valid');
  if (preview.status !== 'valid') return;
  let clicks = 0;
  const renderer = await ReactThreeTestRenderer.create(
    <ModelScene
      snapshot={core.snapshot}
      selected={undefined}
      onSelect={() => {}}
      candidate={preview.candidate}
      onGhostClick={() => clicks++}
    />,
  );
  await renderer.fireEvent(renderer.scene.findByProps({ name: 'ghost:tube:t7/body' }), 'click');
  expect(clicks).toBe(1);
});

test('the model box covers built parts but not attach targets', async () => {
  const { attachPoints, quadroPartCatalog } = await import('@qad/model-core');
  const { VirtualArms } = await import('./VirtualArms');
  const { builtBox } = await import('./ModelScene');
  const { snapshot } = demoModel();
  const scene = (withArms: boolean) =>
    ReactThreeTestRenderer.create(
      <ModelScene snapshot={snapshot} selected={undefined} onSelect={() => {}}>
        {withArms ? (
          <VirtualArms
            points={attachPoints(snapshot, quadroPartCatalog)}
            hovered={undefined}
            onHover={() => {}}
            onPick={() => {}}
          />
        ) : null}
      </ModelScene>,
    );
  const plain = builtBox((await scene(false)).scene.instance);
  const armed = builtBox((await scene(true)).scene.instance);
  expect(plain.isEmpty()).toBe(false);
  expect(armed.equals(plain)).toBe(true);
});

test('a hole panel is drawn as one extruded slab with its holes', async () => {
  const { insertPlate, plateSpots, quadroPartCatalog } = await import('@qad/model-core');
  const core = demoModel();
  const spot = plateSpots(core.snapshot, quadroPartCatalog).find((s) => s.familyId === 'hole-panel-40-40cm')!;
  const result = core.execute(insertPlate(core.snapshot, spot, 'blue'));
  expect(result.ok).toBe(true);
  const renderer = await ReactThreeTestRenderer.create(
    <ModelScene snapshot={core.snapshot} selected={undefined} onSelect={() => {}} />,
  );
  const plate = core.snapshot.realization.parts.find((p) => p.typeId === 'hole-panel-40-40cm')!;
  const geometries = renderer.scene
    .findByProps({ name: plate.id })
    .allChildren.flatMap((c) => (c.instance instanceof Mesh ? [c.instance.geometry] : []));
  const slab = geometries.find((g) => g instanceof ExtrudeGeometry) as ExtrudeGeometry;
  expect((slab.parameters.shapes as Shape).holes).toHaveLength(9);
  // The two flanges are boxes as before.
  expect(geometries.filter((g) => g instanceof BoxGeometry)).toHaveLength(2);
});

test('for a rebuild, parts of the other state are drawn see-through and marked parts get a contour', async () => {
  const { snapshot } = demoModel();
  const renderer = await ReactThreeTestRenderer.create(
    <ModelScene
      snapshot={snapshot}
      selected={undefined}
      onSelect={() => {}}
      marks={new Map([['tube:t1/body', { outline: '#2e9e44' }]])}
      others={{ snapshot, marks: new Map([['tube:t2/body', { outline: '#d32f2f', opacity: 0.35 }]]) }}
    />,
  );
  const other = renderer.scene.findByProps({ name: 'other:tube:t2/body' });
  const materials = other.allChildren.flatMap((c) =>
    c.instance instanceof Mesh && !Array.isArray(c.instance.material) ? [c.instance.material] : [],
  );
  expect(materials.some((m) => m.transparent && m.opacity === 0.35)).toBe(true);
  // drei Outlines adds a second mesh per shape for the contour.
  const meshes = (name: string) => {
    let count = 0;
    renderer.scene.findByProps({ name }).instance.traverse((o: unknown) => void (o instanceof Mesh && count++));
    return count;
  };
  expect(meshes('tube:t1/body')).toBeGreaterThan(meshes('tube:t3/body'));
});
