// FR-14: per-utterance document attachment selection.
import { describe, it, expect, beforeEach } from 'vitest';

import { useDocContextStore, MAX_ATTACHED_DOCS } from './docContextStore';

beforeEach(() => {
  useDocContextStore.setState({ selectedByPost: {} });
});

describe('docContextStore', () => {
  it('starts empty and returns a stable empty selection', () => {
    const { selected } = useDocContextStore.getState();
    expect(selected('p1')).toEqual([]);
  });

  it('toggles a document on and off', () => {
    const { toggle, selected } = useDocContextStore.getState();
    toggle('p1', 'doc-a');
    expect(useDocContextStore.getState().selected('p1')).toEqual(['doc-a']);
    toggle('p1', 'doc-a');
    expect(useDocContextStore.getState().selected('p1')).toEqual([]);
    expect(selected).toBeTypeOf('function');
  });

  it('keeps selection order', () => {
    const { toggle } = useDocContextStore.getState();
    toggle('p1', 'b');
    toggle('p1', 'a');
    expect(useDocContextStore.getState().selected('p1')).toEqual(['b', 'a']);
  });

  it('refuses to add past the cap instead of evicting', () => {
    const { toggle } = useDocContextStore.getState();
    for (let i = 0; i < MAX_ATTACHED_DOCS; i += 1) toggle('p1', `doc-${i}`);
    const atCap = useDocContextStore.getState().selected('p1');
    expect(atCap).toHaveLength(MAX_ATTACHED_DOCS);

    toggle('p1', 'one-too-many');
    // Unchanged — the earlier, deliberate picks survive.
    expect(useDocContextStore.getState().selected('p1')).toEqual(atCap);
  });

  it('still allows deselecting while at the cap', () => {
    const { toggle } = useDocContextStore.getState();
    for (let i = 0; i < MAX_ATTACHED_DOCS; i += 1) toggle('p1', `doc-${i}`);
    toggle('p1', 'doc-0');
    expect(useDocContextStore.getState().selected('p1')).not.toContain('doc-0');
    expect(useDocContextStore.getState().selected('p1')).toHaveLength(
      MAX_ATTACHED_DOCS - 1,
    );
  });

  it('scopes selections per post', () => {
    const { toggle } = useDocContextStore.getState();
    toggle('p1', 'doc-a');
    toggle('p2', 'doc-b');
    expect(useDocContextStore.getState().selected('p1')).toEqual(['doc-a']);
    expect(useDocContextStore.getState().selected('p2')).toEqual(['doc-b']);
  });

  it('clear() drops only that post', () => {
    const { toggle, clear } = useDocContextStore.getState();
    toggle('p1', 'doc-a');
    toggle('p2', 'doc-b');
    clear('p1');
    expect(useDocContextStore.getState().selected('p1')).toEqual([]);
    expect(useDocContextStore.getState().selected('p2')).toEqual(['doc-b']);
  });

  it('clear() on an untouched post is a no-op', () => {
    const before = useDocContextStore.getState().selectedByPost;
    useDocContextStore.getState().clear('never-touched');
    expect(useDocContextStore.getState().selectedByPost).toBe(before);
  });
});
