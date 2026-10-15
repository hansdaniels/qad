import ReactThreeTestRenderer from '@react-three/test-renderer';
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
