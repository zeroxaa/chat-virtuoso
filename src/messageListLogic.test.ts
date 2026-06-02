/**
 * Extensive unit tests for message-list state management logic.
 * No DOM required — these are pure logic tests.
 */
import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  appendItems,
  prependItems,
  replaceItems,
  mapItems,
  findItem,
  findAndUpdateItem,
  findAndDeleteItem,
  getItems,
  getLength,
  PREPEND_START_INDEX,
} from '../messageListLogic';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

interface Msg {
  id: string;
  text: string;
}

const m = (id: string, text = `msg-${id}`): Msg => ({ id, text });

const msgs = (count: number): Msg[] =>
  Array.from({ length: count }, (_, i) => m(`m${i}`));

/* ================================================================== */
/*  createInitialState                                                */
/* ================================================================== */

describe('createInitialState', () => {
  it('creates state with provided data', () => {
    const s = createInitialState([m('a'), m('b')]);
    expect(s.items).toEqual([m('a'), m('b')]);
    expect(s.dataVersion).toBe(0);
    expect(s.atBottom).toBe(true);
    expect(s.firstItemIndex).toBe(PREPEND_START_INDEX);
    expect(s.unreadCount).toBe(0);
    expect(s.pendingAppendBehavior).toBe(false);
  });

  it('creates state with empty array', () => {
    const s = createInitialState([]);
    expect(s.items).toEqual([]);
    expect(s.dataVersion).toBe(0);
  });

  it('creates state with no argument (undefined)', () => {
    const s = createInitialState();
    expect(s.items).toEqual([]);
  });
});

/* ================================================================== */
/*  appendItems                                                       */
/* ================================================================== */

describe('appendItems', () => {
  /* ---- basic ---- */

  it('appends items', () => {
    const s = createInitialState([m('a')]);
    const next = appendItems(s, [m('b'), m('c')]);
    expect(next.items).toEqual([m('a'), m('b'), m('c')]);
    expect(next.dataVersion).toBe(s.dataVersion + 1);
  });

  it('empty append is a no-op on items but bumps version', () => {
    const s = createInitialState([m('a')]);
    const next = appendItems(s, []);
    expect(next.items).toEqual([m('a')]);
    expect(next.dataVersion).toBe(s.dataVersion + 1);
  });

  it('append onto empty list', () => {
    const s = createInitialState([]);
    const next = appendItems(s, [m('x')]);
    expect(next.items).toEqual([m('x')]);
  });

  /* ---- behavior: default (auto) ---- */

  it('default behavior is auto => resets unreadCount to 0', () => {
    const s = { ...createInitialState([m('a')]), atBottom: true };
    const next = appendItems(s, [m('b')]);
    expect(next.unreadCount).toBe(0);
  });

  /* ---- behavior: "auto" ---- */

  it('behavior "auto" resets unreadCount', () => {
    const s = { ...createInitialState([m('a')]), atBottom: true };
    const next = appendItems(s, [m('b')], 'auto');
    expect(next.unreadCount).toBe(0);
  });

  /* ---- behavior: "smooth" ---- */

  it('behavior "smooth" resets unreadCount', () => {
    const s = { ...createInitialState([m('a')]), atBottom: true };
    const next = appendItems(s, [m('b')], 'smooth');
    expect(next.unreadCount).toBe(0);
  });

  /* ---- behavior: false ---- */

  it('behavior false accumulates unreadCount', () => {
    const s = createInitialState([m('a')]);
    const next = appendItems(s, [m('b'), m('c')], false);
    expect(next.unreadCount).toBe(2);
  });

  it('behavior false accumulates over multiple appends', () => {
    let s = createInitialState([m('a')]);
    s = appendItems(s, [m('b')], false);
    s = appendItems(s, [m('c')], false);
    s = appendItems(s, [m('d')], false);
    expect(s.unreadCount).toBe(3);
  });

  /* ---- behavior: function ---- */

  it('behavior function: atBottom=true => "auto" => resets', () => {
    const s = { ...createInitialState([m('a')]), atBottom: true };
    const next = appendItems(s, [m('b')], ({ atBottom }) =>
      atBottom ? 'auto' : false,
    );
    expect(next.unreadCount).toBe(0);
  });

  it('behavior function: atBottom=false => false => accumulates', () => {
    const s = { ...createInitialState([m('a')]), atBottom: false };
    const next = appendItems(s, [m('b'), m('c')], ({ atBottom }) =>
      atBottom ? 'auto' : false,
    );
    expect(next.unreadCount).toBe(2);
  });

  it('behavior function: atBottom=false => "smooth" => resets', () => {
    const s = { ...createInitialState([m('a')]), atBottom: false };
    const next = appendItems(s, [m('b')], ({ atBottom }) =>
      atBottom ? 'auto' : 'smooth',
    );
    expect(next.unreadCount).toBe(0);
  });

  /* ---- pendingAppendBehavior ---- */

  it('stores the append behavior for followOutput after append', () => {
    const s = createInitialState([m('a')]);
    const next = appendItems(s, [m('b')], false);
    expect(next.pendingAppendBehavior).toBe(false);
  });

  it('uses auto behavior when no explicit behavior is given', () => {
    const s = createInitialState([m('a')]);
    const next = appendItems(s, [m('b')]);
    expect(next.unreadCount).toBe(0);
    expect(next.pendingAppendBehavior).toBe('auto');
  });

  /* ---- immutability ---- */

  it('does not mutate original state', () => {
    const s = createInitialState([m('a')]);
    const sCopy = { ...s, items: [...s.items] };
    appendItems(s, [m('b')]);
    expect(s).toEqual(sCopy);
  });

  /* ---- rapid bursts ---- */

  it('handles rapid burst of appends', () => {
    let s = createInitialState<Msg>([]);
    for (let i = 0; i < 100; i++) {
      s = appendItems(s, [m(`r${i}`)]);
    }
    expect(s.items.length).toBe(100);
    expect(s.items[0].id).toBe('r0');
    expect(s.items[99].id).toBe('r99');
  });

  it('rapid appends with behavior false track unread correctly', () => {
    let s = createInitialState<Msg>([]);
    for (let i = 0; i < 10; i++) {
      s = appendItems(s, [m(`u${i}`)], false);
    }
    expect(s.unreadCount).toBe(10);
  });

  /* ---- large append ---- */

  it('large append (5000 items)', () => {
    const s = createInitialState([m('base')]);
    const large = Array.from({ length: 5000 }, (_, i) => m(`big${i}`));
    const next = appendItems(s, large);
    expect(next.items.length).toBe(5001);
    expect(next.items[0].id).toBe('base');
    expect(next.items[5000].id).toBe('big4999');
  });
});

/* ================================================================== */
/*  prependItems                                                      */
/* ================================================================== */

describe('prependItems', () => {
  it('prepends items', () => {
    const s = createInitialState([m('c')]);
    const next = prependItems(s, [m('a'), m('b')]);
    expect(next.items).toEqual([m('a'), m('b'), m('c')]);
    expect(next.dataVersion).toBe(s.dataVersion + 1);
  });

  it('decrements firstItemIndex', () => {
    const s = createInitialState([m('a')]);
    const next = prependItems(s, [m('x'), m('y')]);
    expect(next.firstItemIndex).toBe(PREPEND_START_INDEX - 2);
  });

  it('multiple prepends stack correctly', () => {
    let s = createInitialState([m('base')]);
    s = prependItems(s, [m('p1')]);
    s = prependItems(s, [m('p2'), m('p3')]);
    expect(s.items).toEqual([m('p2'), m('p3'), m('p1'), m('base')]);
    expect(s.firstItemIndex).toBe(PREPEND_START_INDEX - 3);
  });

  it('empty prepend is a no-op on items', () => {
    const s = createInitialState([m('a')]);
    const next = prependItems(s, []);
    expect(next.items).toEqual([m('a')]);
    expect(next.firstItemIndex).toBe(PREPEND_START_INDEX);
  });

  it('suppresses next followOutput when no append is pending', () => {
    const s = createInitialState([m('a')]);
    const next = prependItems(s, [m('old')]);
    expect(next.pendingAppendBehavior).toBe(false);
  });

  it('does not mutate original state', () => {
    const s = createInitialState([m('a')]);
    const sCopy = { ...s, items: [...s.items] };
    prependItems(s, [m('old')]);
    expect(s).toEqual(sCopy);
  });

  it('large prepend (5000 items)', () => {
    const s = createInitialState([m('base')]);
    const large = Array.from({ length: 5000 }, (_, i) => m(`old${i}`));
    const next = prependItems(s, large);
    expect(next.items.length).toBe(5001);
    expect(next.items[0].id).toBe('old0');
    expect(next.items[5000].id).toBe('base');
    expect(next.firstItemIndex).toBe(PREPEND_START_INDEX - 5000);
  });

  it('prepend then append: prepend suppresses, then append stores follow behavior', () => {
    let s = createInitialState([m('mid')]);
    s = prependItems(s, [m('before')]);
    expect(s.pendingAppendBehavior).toBe(false);
    s = appendItems(s, [m('after')]);
    expect(s.pendingAppendBehavior).toBe('auto');
    expect(s.items).toEqual([m('before'), m('mid'), m('after')]);
  });

  it('prepend preserves a pending append follow behavior in the same tick', () => {
    let s = createInitialState([m('mid')]);
    s = appendItems(s, [m('after')], 'smooth');
    s = prependItems(s, [m('before')]);
    expect(s.pendingAppendBehavior).toBe('smooth');
    expect(s.items).toEqual([m('before'), m('mid'), m('after')]);
  });
});

/* ================================================================== */
/*  replaceItems                                                      */
/* ================================================================== */

describe('replaceItems', () => {
  it('replaces all items', () => {
    const s = createInitialState([m('a'), m('b'), m('c')]);
    const next = replaceItems(s, [m('x'), m('y')]);
    expect(next.items).toEqual([m('x'), m('y')]);
  });

  it('resets firstItemIndex to PREPEND_START_INDEX', () => {
    let s = createInitialState([m('a')]);
    s = prependItems(s, [m('old')]);
    expect(s.firstItemIndex).not.toBe(PREPEND_START_INDEX);
    s = replaceItems(s, [m('fresh')]);
    expect(s.firstItemIndex).toBe(PREPEND_START_INDEX);
  });

  it('resets unreadCount to 0', () => {
    let s = createInitialState([m('a')]);
    s = appendItems(s, [m('b'), m('c')], false);
    expect(s.unreadCount).toBe(2);
    s = replaceItems(s, [m('x')]);
    expect(s.unreadCount).toBe(0);
  });

  it('clears pending append behavior', () => {
    const s = { ...createInitialState([m('a')]), pendingAppendBehavior: 'smooth' as const };
    const next = replaceItems(s, [m('x')]);
    expect(next.pendingAppendBehavior).toBe(false);
  });

  it('replace with empty array', () => {
    const s = createInitialState([m('a')]);
    const next = replaceItems(s, []);
    expect(next.items).toEqual([]);
  });

  it('does not mutate original state', () => {
    const s = createInitialState([m('a')]);
    const sCopy = { ...s, items: [...s.items] };
    replaceItems(s, [m('b')]);
    expect(s).toEqual(sCopy);
  });
});

/* ================================================================== */
/*  mapItems                                                          */
/* ================================================================== */

describe('mapItems', () => {
  it('transforms all items', () => {
    const s = createInitialState([m('a', 'hello'), m('b', 'world')]);
    const next = mapItems(s, (item) => ({ ...item, text: item.text.toUpperCase() }));
    expect(next.items).toEqual([m('a', 'HELLO'), m('b', 'WORLD')]);
  });

  it('does not change length', () => {
    const s = createInitialState(msgs(5));
    const next = mapItems(s, (x) => x);
    expect(next.items.length).toBe(5);
  });

  it('suppresses followOutput', () => {
    const s = createInitialState([m('a')]);
    const next = mapItems(s, (x) => x);
    expect(next.pendingAppendBehavior).toBe(false);
  });

  it('does not mutate original items', () => {
    const s = createInitialState([m('a')]);
    const sCopy = { ...s, items: [...s.items] };
    mapItems(s, (x) => ({ ...x, text: 'changed' }));
    expect(s).toEqual(sCopy);
  });

  it('handles empty list', () => {
    const s = createInitialState([]);
    const next = mapItems(s, (x) => x);
    expect(next.items).toEqual([]);
  });
});

/* ================================================================== */
/*  findItem                                                          */
/* ================================================================== */

describe('findItem', () => {
  it('finds existing item', () => {
    const s = createInitialState([m('a'), m('b'), m('c')]);
    expect(findItem(s, (x) => x.id === 'b')).toEqual(m('b'));
  });

  it('finds first matching item', () => {
    const s = createInitialState([m('a'), m('b'), m('a')]);
    const found = findItem(s, (x) => x.id === 'a');
    expect(found).toEqual(m('a'));
    expect(s.items.indexOf(found!)).toBe(0);
  });

  it('returns undefined for missing item', () => {
    const s = createInitialState([m('a')]);
    expect(findItem(s, (x) => x.id === 'missing')).toBeUndefined();
  });

  it('returns undefined for empty list', () => {
    const s = createInitialState([]);
    expect(findItem(s, () => true)).toBeUndefined();
  });
});

/* ================================================================== */
/*  findAndUpdateItem                                                 */
/* ================================================================== */

describe('findAndUpdateItem', () => {
  it('updates existing item', () => {
    const s = createInitialState([m('a', 'old'), m('b')]);
    const { state: next, found } = findAndUpdateItem(
      s,
      (x) => x.id === 'a',
      (x) => ({ ...x, text: 'NEW' }),
    );
    expect(found).toBe(true);
    expect(next.items[0].text).toBe('NEW');
    expect(next.items[1]).toEqual(m('b'));
  });

  it('updates last item', () => {
    const s = createInitialState(msgs(5));
    const { state: next, found } = findAndUpdateItem(
      s,
      (x) => x.id === 'm4',
      (x) => ({ ...x, text: 'last' }),
    );
    expect(found).toBe(true);
    expect(next.items[4].text).toBe('last');
  });

  it('returns found=false for missing item', () => {
    const s = createInitialState([m('a')]);
    const { state: next, found } = findAndUpdateItem(
      s,
      (x) => x.id === 'missing',
      (x) => ({ ...x, text: 'x' }),
    );
    expect(found).toBe(false);
    expect(next).toBe(s); // same reference when not found
  });

  it('suppresses followOutput', () => {
    const s = createInitialState([m('a')]);
    const { state: next } = findAndUpdateItem(
      s,
      (x) => x.id === 'a',
      (x) => x,
    );
    expect(next.pendingAppendBehavior).toBe(false);
  });

  it('does not mutate original state', () => {
    const s = createInitialState([m('a', 'old')]);
    const sCopy = { ...s, items: [...s.items] };
    findAndUpdateItem(s, (x) => x.id === 'a', (x) => ({ ...x, text: 'NEW' }));
    expect(s).toEqual(sCopy);
  });
});

/* ================================================================== */
/*  findAndDeleteItem                                                 */
/* ================================================================== */

describe('findAndDeleteItem', () => {
  it('deletes existing item', () => {
    const s = createInitialState([m('a'), m('b'), m('c')]);
    const { state: next, found } = findAndDeleteItem(s, (x) => x.id === 'b');
    expect(found).toBe(true);
    expect(next.items).toEqual([m('a'), m('c')]);
  });

  it('deletes first item', () => {
    const s = createInitialState([m('a'), m('b'), m('c')]);
    const { state: next, found } = findAndDeleteItem(s, (x) => x.id === 'a');
    expect(found).toBe(true);
    expect(next.items).toEqual([m('b'), m('c')]);
  });

  it('deletes last item', () => {
    const s = createInitialState([m('a'), m('b'), m('c')]);
    const { state: next, found } = findAndDeleteItem(s, (x) => x.id === 'c');
    expect(found).toBe(true);
    expect(next.items).toEqual([m('a'), m('b')]);
  });

  it('deletes only item', () => {
    const s = createInitialState([m('only')]);
    const { state: next, found } = findAndDeleteItem(s, (x) => x.id === 'only');
    expect(found).toBe(true);
    expect(next.items).toEqual([]);
  });

  it('returns found=false for missing item', () => {
    const s = createInitialState([m('a')]);
    const { state: next, found } = findAndDeleteItem(s, (x) => x.id === 'nope');
    expect(found).toBe(false);
    expect(next).toBe(s);
  });

  it('increments firstItemIndex by 1 when deleting the first item', () => {
    const s = createInitialState([m('a'), m('b')]);
    const { state: next } = findAndDeleteItem(s, (x) => x.id === 'a');
    expect(next.firstItemIndex).toBe(s.firstItemIndex + 1);
  });

  it('does not change firstItemIndex when deleting a non-first item', () => {
    const s = createInitialState([m('a'), m('b')]);
    const { state: next } = findAndDeleteItem(s, (x) => x.id === 'b');
    expect(next.firstItemIndex).toBe(s.firstItemIndex);
  });

  it('suppresses followOutput', () => {
    const s = createInitialState([m('a')]);
    const { state: next } = findAndDeleteItem(s, (x) => x.id === 'a');
    expect(next.pendingAppendBehavior).toBe(false);
  });

  it('does not mutate original state', () => {
    const s = createInitialState([m('a'), m('b')]);
    const sCopy = { ...s, items: [...s.items] };
    findAndDeleteItem(s, (x) => x.id === 'a');
    expect(s).toEqual(sCopy);
  });

  it('handles deleting from empty list', () => {
    const s = createInitialState([]);
    const { state: next, found } = findAndDeleteItem(s, () => true);
    expect(found).toBe(false);
    expect(next.items).toEqual([]);
  });
});

/* ================================================================== */
/*  getItems / getLength                                               */
/* ================================================================== */

describe('getItems / getLength', () => {
  it('getItems returns the items array', () => {
    const s = createInitialState([m('a'), m('b')]);
    expect(getItems(s)).toEqual([m('a'), m('b')]);
  });

  it('getLength returns item count', () => {
    expect(getLength(createInitialState(msgs(7)))).toBe(7);
    expect(getLength(createInitialState([]))).toBe(0);
  });
});

/* ================================================================== */
/*  End-to-end scenarios                                               */
/* ================================================================== */

describe('scenarios', () => {
  it('chat app: load initial messages, then user scrolls up and loads older', () => {
    // Initial load: 20 recent messages
    let s = createInitialState(msgs(20));
    expect(s.items.length).toBe(20);
    expect(s.firstItemIndex).toBe(PREPEND_START_INDEX);

    // User scrolls to top, loads 20 older messages
    s = { ...s, atBottom: false };
    s = prependItems(s, Array.from({ length: 20 }, (_, i) => m(`old${i}`)));
    expect(s.items.length).toBe(40);
    expect(s.items[0].id).toBe('old0');
    expect(s.items[39].id).toBe('m19');
    expect(s.pendingAppendBehavior).toBe(false); // no auto-scroll after prepend

    // New message arrives while user is reading history
    s = appendItems(
      s,
      [m('new1')],
      ({ atBottom }) => (atBottom ? 'auto' : false),
    );
    expect(s.items[40].id).toBe('new1');
    // When !atBottom, unreadCount accumulates
    expect(s.unreadCount).toBe(1);

    // Another new message
    s = appendItems(
      s,
      [m('new2')],
      ({ atBottom }) => (atBottom ? 'auto' : false),
    );
    expect(s.unreadCount).toBe(2);

    // User scrolls to bottom (atBottom becomes true)
    s = { ...s, atBottom: true };
    // New message arrives — should auto-scroll and reset unread
    s = appendItems(
      s,
      [m('new3')],
      ({ atBottom }) => (atBottom ? 'auto' : false),
    );
    expect(s.unreadCount).toBe(0);
  });

  it('replace after heavy prepend resets everything', () => {
    let s = createInitialState([m('base')]);
    s = prependItems(s, Array.from({ length: 100 }, (_, i) => m(`old${i}`)));
    s = appendItems(s, [m('new')], false);
    expect(s.items.length).toBe(102);
    expect(s.firstItemIndex).not.toBe(PREPEND_START_INDEX);
    expect(s.unreadCount).toBe(1);

    // Full replace (e.g., navigating to a different channel)
    s = replaceItems(s, [m('channel2-a'), m('channel2-b')]);
    expect(s.items.length).toBe(2);
    expect(s.firstItemIndex).toBe(PREPEND_START_INDEX);
    expect(s.unreadCount).toBe(0);
    expect(s.pendingAppendBehavior).toBe(false);
  });

  it('real-time edit: findAndUpdate does not change order', () => {
    const s = createInitialState([
      m('a', 'first'),
      m('b', 'second'),
      m('c', 'third'),
    ]);
    const { state: next } = findAndUpdateItem(
      s,
      (x) => x.id === 'b',
      (x) => ({ ...x, text: 'edited' }),
    );
    expect(next.items.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(next.items[1].text).toBe('edited');
  });

  it('bulk delete old messages by ID', () => {
    let s = createInitialState(msgs(10));
    const toDelete = ['m1', 'm3', 'm5', 'm7', 'm9'];
    for (const id of toDelete) {
      const { state: next, found } = findAndDeleteItem(s, (x) => x.id === id);
      expect(found).toBe(true);
      s = next;
    }
    expect(s.items.length).toBe(5);
    expect(s.items.map((x) => x.id)).toEqual(['m0', 'm2', 'm4', 'm6', 'm8']);
    // Deleting non-first items should not move the first item index.
    expect(s.firstItemIndex).toBe(PREPEND_START_INDEX);
  });

  it('map items preserves identity for unchanged items', () => {
    const s = createInitialState([m('a'), m('b'), m('c')]);
    const next = mapItems(s, (item) =>
      item.id === 'b' ? { ...item, text: 'changed' } : item,
    );
    expect(next.items[0]).toBe(s.items[0]); // same reference
    expect(next.items[1]).not.toBe(s.items[1]); // new reference
    expect(next.items[2]).toBe(s.items[2]); // same reference
  });
});
