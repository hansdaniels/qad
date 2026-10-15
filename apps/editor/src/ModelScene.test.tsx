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
