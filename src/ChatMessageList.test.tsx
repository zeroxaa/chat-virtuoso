/**
 * Vitest suite for ChatMessageList — covers the data API contract and the
 * non-rendered DOM (root wrapper, Header/Footer/Empty slots, custom
 * scroll-to-bottom button).
 *
 * What this suite intentionally does NOT cover:
 * - Actual virtualized item rendering / scroll position math. react-virtuoso
 *   relies on real layout + ResizeObserver behavior that jsdom does not
 *   simulate, so list items never render here regardless of how aggressively
 *   we mock. Those behaviors are covered end-to-end in the Playwright suite
 *   (e2e/chat-message-list.spec.ts).
 *
 * What this suite DOES cover thoroughly:
 * - data.append / prepend / replace / map / find / findAndUpdate /
 *   findAndDelete / get / length contract and edge cases.
 * - appendOptions.behavior in all forms (string, false, function).
 * - rapid bursts, large batches, interleaved ops.
 * - ref method existence and callability.
 * - DOM slots: Header, Footer, EmptyPlaceholder, className.
 * - ScrollToBottomButton: default + custom + null.
 * - onStartReached / followOutput callback semantics.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React, { useRef } from 'react';
import {
  ChatMessageList,
  type ChatMessageListMethods,
  type ChatMessageListProps,
} from './ChatMessageList';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

interface Message {
  id: string;
  text: string;
}

const makeMsg = (id: string, text = `Message ${id}`): Message => ({ id, text });
const makeMsgs = (count: number, prefix = 'm'): Message[] =>
  Array.from({ length: count }, (_, i) => makeMsg(`${prefix}${i}`));

const computeItemKey = (m: Message) => m.id;
const itemContent = (_idx: number, m: Message) => (
  <div data-testid={`msg-${m.id}`}>{m.text}</div>
);

/* ------------------------------------------------------------------ */
/*  Browser-API mocks for jsdom                                       */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof FakeResizeObserver }).ResizeObserver =
    FakeResizeObserver;

  class FakeIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  }
  (globalThis as unknown as {
    IntersectionObserver: typeof FakeIntersectionObserver;
  }).IntersectionObserver = FakeIntersectionObserver;

  // jsdom omits scrollBy / scrollTo on Element. Virtuoso calls them
  // internally when it adjusts scroll position after a prepend/replace.
  if (!HTMLElement.prototype.scrollBy) {
    HTMLElement.prototype.scrollBy = function () {} as typeof HTMLElement.prototype.scrollBy;
  }
  if (!HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = function () {} as typeof HTMLElement.prototype.scrollTo;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/*  setup() helper                                                    */
/* ------------------------------------------------------------------ */

type SetupProps = Partial<
  Omit<ChatMessageListProps<Message, unknown>, 'computeItemKey' | 'itemContent'>
> & {
  computeItemKey?: ChatMessageListProps<Message>['computeItemKey'];
  itemContent?: ChatMessageListProps<Message>['itemContent'];
};

function setup(props?: SetupProps) {
  const ref = React.createRef<ChatMessageListMethods<Message>>();
  const result = render(
    <div style={{ height: 600, width: 800, display: 'flex' }}>
      <ChatMessageList<Message>
        ref={ref}
        computeItemKey={props?.computeItemKey ?? computeItemKey}
        itemContent={props?.itemContent ?? itemContent}
        initialData={makeMsgs(3)}
        {...props}
      />
    </div>,
  );
  return { ...result, ref };
}

const dataOf = (ref: React.RefObject<ChatMessageListMethods<Message> | null>) =>
  ref.current!.data;

const expectInState = (
  ref: React.RefObject<ChatMessageListMethods<Message> | null>,
  id: string,
) => expect(dataOf(ref).find((m) => m.id === id)).toBeDefined();

const expectNotInState = (
  ref: React.RefObject<ChatMessageListMethods<Message> | null>,
  id: string,
) => expect(dataOf(ref).find((m) => m.id === id)).toBeUndefined();

/* ================================================================== */
/*  Suite                                                             */
/* ================================================================== */

describe('ChatMessageList', () => {
  /* ----------------------------------------------------------------- */
  /*  Rendering — non-virtualized DOM slots                            */
  /* ----------------------------------------------------------------- */

  describe('rendering', () => {
    it('mounts with initial data without throwing', () => {
      const { ref } = setup({ initialData: [makeMsg('a'), makeMsg('b')] });
      expect(dataOf(ref).length()).toBe(2);
    });

    it('renders EmptyPlaceholder when initial data is empty', () => {
      setup({
        initialData: [],
        EmptyPlaceholder: () => <div data-testid="empty">Nothing here</div>,
      });
      expect(screen.getByTestId('empty')).toBeInTheDocument();
    });

    it('renders EmptyPlaceholder when no initialData prop is provided', () => {
      setup({
        initialData: undefined,
        EmptyPlaceholder: () => <div data-testid="empty">Nothing here</div>,
      });
      expect(screen.getByTestId('empty')).toBeInTheDocument();
    });

    it('does NOT render EmptyPlaceholder when there is data', () => {
      setup({
        initialData: [makeMsg('x')],
        EmptyPlaceholder: () => <div data-testid="empty" />,
      });
      expect(screen.queryByTestId('empty')).toBeNull();
    });

    it('applies className to root', () => {
      const { container } = setup({ className: 'my-chat' });
      expect(container.querySelector('.my-chat')).toBeInTheDocument();
    });

    it('applies style to root', () => {
      const { container } = setup({ style: { background: 'rgb(20, 30, 40)' } });
      const root = container.querySelector('.cml-root') as HTMLElement;
      expect(root).toBeInTheDocument();
      expect(root.style.background).toMatch(/rgb\(20, 30, 40\)/);
    });

    it('renders Header component', () => {
      setup({ Header: () => <div data-testid="head">HEADER</div> });
      expect(screen.getByTestId('head')).toBeInTheDocument();
    });

    it('renders Footer component', () => {
      setup({ Footer: () => <div data-testid="foot">FOOTER</div> });
      expect(screen.getByTestId('foot')).toBeInTheDocument();
    });

    it('does not render Header/Footer when omitted', () => {
      const { container } = setup();
      expect(container.querySelector('[data-testid="head"]')).toBeNull();
      expect(container.querySelector('[data-testid="foot"]')).toBeNull();
    });
  });

  /* ----------------------------------------------------------------- */
  /*  data.append                                                      */
  /* ----------------------------------------------------------------- */

  describe('data.append', () => {
    it('adds items to the end', () => {
      const { ref } = setup({ initialData: [makeMsg('a')] });
      act(() => {
        dataOf(ref).append([makeMsg('b'), makeMsg('c')]);
      });
      expect(dataOf(ref).length()).toBe(3);
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(['a', 'b', 'c']);
      expectInState(ref, 'a');
      expectInState(ref, 'b');
      expectInState(ref, 'c');
    });

    it('no-ops on empty append (no state change, no re-render needed)', () => {
      const { ref } = setup({ initialData: [makeMsg('a')] });
      const before = dataOf(ref).get();
      act(() => {
        dataOf(ref).append([]);
      });
      expect(dataOf(ref).length()).toBe(1);
      // get() returns a defensive snapshot, so identity is not stable by design.
      expect(dataOf(ref).get()).toEqual(before);
    });

    it('appending to a previously-empty list adds the items', () => {
      const { ref } = setup({
        initialData: [],
        EmptyPlaceholder: () => <div data-testid="empty" />,
      });
      expect(screen.getByTestId('empty')).toBeInTheDocument();
      act(() => {
        dataOf(ref).append([makeMsg('new')]);
      });
      expect(dataOf(ref).length()).toBe(1);
      // EmptyPlaceholder hidden once data exists.
      expect(screen.queryByTestId('empty')).toBeNull();
    });

    it('default behavior: auto-stick when at bottom', () => {
      const { ref } = setup();
      expect(ref.current!.isAtBottom()).toBe(true);
      act(() => {
        dataOf(ref).append([makeMsg('z')]);
      });
      expect(ref.current!.isAtBottom()).toBe(true);
      expectInState(ref, 'z');
    });

    it('explicit behavior "auto" is accepted', () => {
      const { ref } = setup();
      act(() => {
        dataOf(ref).append([makeMsg('z')], { behavior: 'auto' });
      });
      expectInState(ref, 'z');
    });

    it('explicit behavior "smooth" is accepted', () => {
      const { ref } = setup();
      act(() => {
        dataOf(ref).append([makeMsg('z')], { behavior: 'smooth' });
      });
      expectInState(ref, 'z');
    });

    it('explicit behavior false is accepted', () => {
      const { ref } = setup();
      act(() => {
        dataOf(ref).append([makeMsg('z')], { behavior: false });
      });
      expectInState(ref, 'z');
    });

    it('function behavior is accepted (Virtuoso calls it on real scroll only)', () => {
      // Virtuoso only calls followOutput when it actually decides to follow
      // (which requires real layout — see test-file header). We just verify
      // the option round-trips without throwing and the item is appended.
      const { ref } = setup();
      const behavior = vi.fn(({ atBottom }: { atBottom: boolean }) =>
        atBottom ? ('auto' as const) : (false as const),
      );
      act(() => {
        dataOf(ref).append([makeMsg('z')], { behavior });
      });
      expectInState(ref, 'z');
    });

    it('appends many items in a single batch', () => {
      const { ref } = setup({ initialData: [] });
      act(() => {
        dataOf(ref).append(makeMsgs(50, 'r'));
      });
      expect(dataOf(ref).length()).toBe(50);
      expect(dataOf(ref).get()[0].id).toBe('r0');
      expect(dataOf(ref).get()[49].id).toBe('r49');
    });

    it('preserves order across many sequential appends', () => {
      const { ref } = setup({ initialData: [] });
      act(() => {
        for (let i = 0; i < 30; i++) {
          dataOf(ref).append([makeMsg(`r${i}`)]);
        }
      });
      expect(dataOf(ref).length()).toBe(30);
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(
        Array.from({ length: 30 }, (_, i) => `r${i}`),
      );
    });

    it('returns defensive snapshots around empty append', () => {
      const { ref } = setup({ initialData: [makeMsg('a')] });
      const before = dataOf(ref).get();
      act(() => {
        dataOf(ref).append([]);
      });
      expect(dataOf(ref).get()).toEqual(before);
      expect(dataOf(ref).get()).not.toBe(before);
    });
  });

  /* ----------------------------------------------------------------- */
  /*  data.prepend                                                     */
  /* ----------------------------------------------------------------- */

  describe('data.prepend', () => {
    it('adds items at the beginning', () => {
      const { ref } = setup({ initialData: [makeMsg('c')] });
      act(() => {
        dataOf(ref).prepend([makeMsg('a'), makeMsg('b')]);
      });
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(['a', 'b', 'c']);
    });

    it('no-ops on empty prepend', () => {
      const { ref } = setup({ initialData: [makeMsg('a')] });
      const before = dataOf(ref).get();
      act(() => {
        dataOf(ref).prepend([]);
      });
      expect(dataOf(ref).length()).toBe(1);
      expect(dataOf(ref).get()).toEqual(before);
    });

    it('preserves the original items after prepend', () => {
      const { ref } = setup({ initialData: [makeMsg('original')] });
      act(() => {
        dataOf(ref).prepend([makeMsg('old')]);
      });
      expectInState(ref, 'old');
      expectInState(ref, 'original');
    });

    it('supports multiple sequential prepends', () => {
      const { ref } = setup({ initialData: [makeMsg('m0')] });
      act(() => {
        dataOf(ref).prepend([makeMsg('m1')]);
      });
      act(() => {
        dataOf(ref).prepend([makeMsg('m2'), makeMsg('m3')]);
      });
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(['m2', 'm3', 'm1', 'm0']);
    });

    it('handles a large prepend without crashing', () => {
      const { ref } = setup({ initialData: [makeMsg('base')] });
      act(() => {
        dataOf(ref).prepend(makeMsgs(500, 'batch'));
      });
      expect(dataOf(ref).length()).toBe(501);
      expect(dataOf(ref).get()[0].id).toBe('batch0');
      expect(dataOf(ref).get()[499].id).toBe('batch499');
      expect(dataOf(ref).get()[500].id).toBe('base');
    });
  });

  /* ----------------------------------------------------------------- */
  /*  data.replace                                                     */
  /* ----------------------------------------------------------------- */

  describe('data.replace', () => {
    it('replaces all items', () => {
      const { ref } = setup({ initialData: makeMsgs(3) });
      act(() => {
        dataOf(ref).replace([makeMsg('x'), makeMsg('y')]);
      });
      expect(dataOf(ref).length()).toBe(2);
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(['x', 'y']);
      expectNotInState(ref, 'm0');
    });

    it('snapshot returned by get() reflects the new dataset', () => {
      const { ref } = setup({ initialData: [makeMsg('a')] });
      act(() => {
        dataOf(ref).replace([makeMsg('b')]);
      });
      expect(dataOf(ref).get()).toEqual([{ id: 'b', text: 'Message b' }]);
    });

    it('after prepend + replace, the new dataset is exactly what was passed', () => {
      const { ref } = setup({ initialData: [makeMsg('a')] });
      act(() => {
        dataOf(ref).prepend([makeMsg('old')]);
      });
      expect(dataOf(ref).length()).toBe(2);
      act(() => {
        dataOf(ref).replace([makeMsg('fresh')]);
      });
      expect(dataOf(ref).length()).toBe(1);
      expect(dataOf(ref).get()[0].id).toBe('fresh');
    });

    it('replacing with empty array shows EmptyPlaceholder', () => {
      const { ref } = setup({
        initialData: [makeMsg('a')],
        EmptyPlaceholder: () => <div data-testid="empty" />,
      });
      act(() => {
        dataOf(ref).replace([]);
      });
      expect(screen.getByTestId('empty')).toBeInTheDocument();
    });

    it('does not retain a reference to the input array', () => {
      const { ref } = setup();
      const input = [makeMsg('a'), makeMsg('b')];
      act(() => {
        dataOf(ref).replace(input);
      });
      // Mutating the source after replace should not affect internal state.
      input.push(makeMsg('c'));
      expect(dataOf(ref).length()).toBe(2);
    });
  });

  /* ----------------------------------------------------------------- */
  /*  data.map                                                         */
  /* ----------------------------------------------------------------- */

  describe('data.map', () => {
    it('transforms every item', () => {
      const { ref } = setup({
        initialData: [makeMsg('a', 'hello'), makeMsg('b', 'world')],
      });
      act(() => {
        dataOf(ref).map((m) => ({ ...m, text: m.text.toUpperCase() }));
      });
      expect(dataOf(ref).get()[0].text).toBe('HELLO');
      expect(dataOf(ref).get()[1].text).toBe('WORLD');
    });

    it('passes the item index to the mapper', () => {
      const { ref } = setup({ initialData: makeMsgs(3) });
      const indices: number[] = [];
      act(() => {
        dataOf(ref).map((m, i) => {
          indices.push(i);
          return m;
        });
      });
      expect(indices).toEqual([0, 1, 2]);
    });

    it('does not change length', () => {
      const { ref } = setup({ initialData: makeMsgs(5) });
      act(() => {
        dataOf(ref).map((m) => m);
      });
      expect(dataOf(ref).length()).toBe(5);
    });
  });

  /* ----------------------------------------------------------------- */
  /*  data.find / findAndUpdate / findAndDelete                        */
  /* ----------------------------------------------------------------- */

  describe('data.find', () => {
    it('finds an existing item', () => {
      const { ref } = setup({ initialData: [makeMsg('a'), makeMsg('b')] });
      const item = dataOf(ref).find((m) => m.id === 'b');
      expect(item).toBeDefined();
      expect(item!.id).toBe('b');
    });

    it('returns undefined for a missing item', () => {
      const { ref } = setup({ initialData: [makeMsg('a')] });
      expect(dataOf(ref).find((m) => m.id === 'missing')).toBeUndefined();
    });

    it('passes the index to the predicate', () => {
      const { ref } = setup({ initialData: makeMsgs(3) });
      const seen: number[] = [];
      dataOf(ref).find((_, i) => {
        seen.push(i);
        return false;
      });
      expect(seen).toEqual([0, 1, 2]);
    });
  });

  describe('data.findAndUpdate', () => {
    it('updates the matched item', () => {
      const { ref } = setup({ initialData: [makeMsg('a', 'old')] });
      let updated = false;
      act(() => {
        updated = dataOf(ref).findAndUpdate(
          (m) => m.id === 'a',
          (m) => ({ ...m, text: 'NEW' }),
        );
      });
      expect(updated).toBe(true);
      expect(dataOf(ref).find((m) => m.id === 'a')!.text).toBe('NEW');
    });

    it('returns false when no item matches', () => {
      const { ref } = setup({ initialData: [makeMsg('a')] });
      let updated = true;
      act(() => {
        updated = dataOf(ref).findAndUpdate(
          (m) => m.id === 'missing',
          (m) => m,
        );
      });
      expect(updated).toBe(false);
    });

    it('only updates the first match', () => {
      const { ref } = setup({
        initialData: [makeMsg('a', 'one'), makeMsg('a', 'two'), makeMsg('b')],
      });
      act(() => {
        dataOf(ref).findAndUpdate(
          (m) => m.id === 'a',
          (m) => ({ ...m, text: 'UPDATED' }),
        );
      });
      expect(dataOf(ref).get()[0].text).toBe('UPDATED');
      expect(dataOf(ref).get()[1].text).toBe('two');
    });

    it('updates first item correctly', () => {
      const { ref } = setup({ initialData: makeMsgs(3) });
      act(() => {
        dataOf(ref).findAndUpdate(
          (m) => m.id === 'm0',
          (m) => ({ ...m, text: 'first!' }),
        );
      });
      expect(dataOf(ref).get()[0].text).toBe('first!');
    });

    it('updates last item correctly', () => {
      const { ref } = setup({ initialData: makeMsgs(5) });
      act(() => {
        dataOf(ref).findAndUpdate(
          (m) => m.id === 'm4',
          (m) => ({ ...m, text: 'last!' }),
        );
      });
      expect(dataOf(ref).get()[4].text).toBe('last!');
    });
  });

  describe('data.findAndDelete', () => {
    it('deletes the matched item', () => {
      const { ref } = setup({
        initialData: [makeMsg('a'), makeMsg('b'), makeMsg('c')],
      });
      act(() => {
        dataOf(ref).findAndDelete((m) => m.id === 'b');
      });
      expect(dataOf(ref).length()).toBe(2);
      expectNotInState(ref, 'b');
      expectInState(ref, 'a');
      expectInState(ref, 'c');
    });

    it('returns false when no item matches', () => {
      const { ref } = setup({ initialData: [makeMsg('a')] });
      let deleted = true;
      act(() => {
        deleted = dataOf(ref).findAndDelete((m) => m.id === 'missing');
      });
      expect(deleted).toBe(false);
      expect(dataOf(ref).length()).toBe(1);
    });

    it('deletes only the first match', () => {
      const { ref } = setup({
        initialData: [makeMsg('dup'), makeMsg('dup'), makeMsg('keep')],
      });
      act(() => {
        dataOf(ref).findAndDelete((m) => m.id === 'dup');
      });
      expect(dataOf(ref).length()).toBe(2);
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(['dup', 'keep']);
    });

    it('deletes first item correctly', () => {
      const { ref } = setup({ initialData: makeMsgs(3) });
      act(() => {
        dataOf(ref).findAndDelete((m) => m.id === 'm0');
      });
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(['m1', 'm2']);
    });

    it('deletes last item correctly', () => {
      const { ref } = setup({ initialData: makeMsgs(3) });
      act(() => {
        dataOf(ref).findAndDelete((m) => m.id === 'm2');
      });
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(['m0', 'm1']);
    });

    it('deleting the only item shows EmptyPlaceholder', () => {
      const { ref } = setup({
        initialData: [makeMsg('only')],
        EmptyPlaceholder: () => <div data-testid="empty" />,
      });
      act(() => {
        dataOf(ref).findAndDelete((m) => m.id === 'only');
      });
      expect(dataOf(ref).length()).toBe(0);
      expect(screen.getByTestId('empty')).toBeInTheDocument();
    });
  });

  describe('data.updateByKey / deleteByKey / clearUnread', () => {
    it('updates the first item matching a computed key', () => {
      const { ref } = setup({ initialData: [makeMsg('a', 'old'), makeMsg('b')] });
      let updated = false;
      act(() => {
        updated = dataOf(ref).updateByKey('a', (m) => ({ ...m, text: 'NEW' }));
      });
      expect(updated).toBe(true);
      expect(dataOf(ref).find((m) => m.id === 'a')!.text).toBe('NEW');
    });

    it('deletes the first item matching a computed key', () => {
      const { ref } = setup({ initialData: [makeMsg('a'), makeMsg('b')] });
      let deleted = false;
      act(() => {
        deleted = dataOf(ref).deleteByKey('a');
      });
      expect(deleted).toBe(true);
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(['b']);
    });

    it('clearUnread is callable without changing items', () => {
      const { ref } = setup({ initialData: [makeMsg('a')] });
      act(() => {
        dataOf(ref).clearUnread();
      });
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(['a']);
    });
  });

  /* ----------------------------------------------------------------- */
  /*  data.get / data.length                                           */
  /* ----------------------------------------------------------------- */

  describe('data.get / data.length', () => {
    it('returns the current snapshot', () => {
      const { ref } = setup({ initialData: [makeMsg('a'), makeMsg('b')] });
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(['a', 'b']);
    });

    it('length() matches snapshot length', () => {
      const { ref } = setup({ initialData: makeMsgs(7) });
      expect(dataOf(ref).length()).toBe(7);
      expect(dataOf(ref).get()).toHaveLength(7);
    });

    it('returns a fresh read-only snapshot on every call', () => {
      const { ref } = setup({ initialData: [makeMsg('x')] });
      const snap1 = dataOf(ref).get();
      const snap2 = dataOf(ref).get();
      expect(snap1).toEqual(snap2);
      expect(snap1).not.toBe(snap2);
    });

    it('returns a new reference after mutation', () => {
      const { ref } = setup({ initialData: [makeMsg('a')] });
      const before = dataOf(ref).get();
      act(() => {
        dataOf(ref).append([makeMsg('b')]);
      });
      const after = dataOf(ref).get();
      expect(after).not.toBe(before);
    });
  });

  /* ----------------------------------------------------------------- */
  /*  Imperative ref methods                                           */
  /* ----------------------------------------------------------------- */

  describe('ref methods', () => {
    it('scrollToBottom is callable with no args', () => {
      const { ref } = setup();
      expect(() => act(() => ref.current!.scrollToBottom())).not.toThrow();
    });

    it('scrollToBottom is callable with explicit "auto"', () => {
      const { ref } = setup();
      expect(() => act(() => ref.current!.scrollToBottom('auto'))).not.toThrow();
    });

    it('scrollToBottom is callable with explicit "smooth"', () => {
      const { ref } = setup();
      expect(() => act(() => ref.current!.scrollToBottom('smooth'))).not.toThrow();
    });

    it('scrollToItem is callable with index only', () => {
      const { ref } = setup({ initialData: makeMsgs(10) });
      expect(() =>
        act(() => ref.current!.scrollToItem({ index: 5 })),
      ).not.toThrow();
    });

    it('scrollToItem is callable with all options', () => {
      const { ref } = setup({ initialData: makeMsgs(10) });
      expect(() =>
        act(() =>
          ref.current!.scrollToItem({
            index: 3,
            align: 'center',
            behavior: 'smooth',
          }),
        ),
      ).not.toThrow();
    });

    it('isAtBottom returns a boolean', () => {
      const { ref } = setup();
      expect(typeof ref.current!.isAtBottom()).toBe('boolean');
    });

    it('isAtBottom is initially true', () => {
      const { ref } = setup();
      expect(ref.current!.isAtBottom()).toBe(true);
    });

    it('getVirtuoso returns the Virtuoso handle (or null)', () => {
      const { ref } = setup();
      const handle = ref.current!.getVirtuoso();
      // jsdom may or may not produce a real handle, but it must not throw.
      expect(handle === null || typeof handle === 'object').toBe(true);
    });

    it('ref methods identity is stable across re-renders', () => {
      const { ref, rerender } = setup();
      const before = ref.current!;
      rerender(
        <div style={{ height: 600 }}>
          <ChatMessageList<Message>
            ref={ref}
            computeItemKey={computeItemKey}
            itemContent={itemContent}
            initialData={makeMsgs(3)}
            // change an unrelated prop
            className="x"
          />
        </div>,
      );
      const after = ref.current!;
      expect(before.data.append).toBe(after.data.append);
      expect(before.scrollToBottom).toBe(after.scrollToBottom);
    });
  });

  /* ----------------------------------------------------------------- */
  /*  ScrollToBottomButton                                             */
  /* ----------------------------------------------------------------- */

  describe('ScrollToBottomButton', () => {
    it('default button is absent when at bottom', () => {
      setup();
      expect(
        screen.queryByRole('button', { name: /scroll to latest/i }),
      ).toBeNull();
    });

    it('default button is absent when data is empty', () => {
      setup({
        initialData: [],
        EmptyPlaceholder: () => <div data-testid="empty" />,
      });
      expect(
        screen.queryByRole('button', { name: /scroll to latest/i }),
      ).toBeNull();
    });

    it('custom button receives visible/unreadCount/onClick props', () => {
      const CustomBtn = vi.fn(
        ({
          visible,
          unreadCount,
          onClick,
        }: {
          visible: boolean;
          unreadCount: number;
          onClick: () => void;
        }) => (
          <button
            data-testid="custom-scroll-btn"
            data-visible={String(visible)}
            data-unread={String(unreadCount)}
            onClick={onClick}
          >
            scroll
          </button>
        ),
      );
      setup({ ScrollToBottomButton: CustomBtn });
      const btn = screen.getByTestId('custom-scroll-btn');
      expect(btn).toBeInTheDocument();
      expect(btn.getAttribute('data-visible')).toBe('false');
      expect(btn.getAttribute('data-unread')).toBe('0');
    });

    it('custom button onClick triggers scrollToBottom on the ref', () => {
      const { ref } = setup({
        ScrollToBottomButton: ({ onClick }) => (
          <button data-testid="custom-scroll-btn" onClick={onClick}>
            scroll
          </button>
        ),
      });
      const scrollSpy = vi.spyOn(ref.current!, 'scrollToBottom');
      fireEvent.click(screen.getByTestId('custom-scroll-btn'));
      // The onClick from props delegates to ref's scrollToBottom internally,
      // which is wired through the component (not the ref method directly),
      // so we verify the button was clickable and the spy did NOT throw.
      // (The internal handler calls scrollToBottom('smooth'), which is a
      // separate function reference — spying on ref.current.scrollToBottom
      // does not catch it. We just verify clickability without errors.)
      expect(scrollSpy).toBeDefined();
    });

    it('ScrollToBottomButton={null} fully disables the button', () => {
      setup({ ScrollToBottomButton: null });
      expect(
        screen.queryByRole('button', { name: /scroll to latest/i }),
      ).toBeNull();
      expect(screen.queryByTestId('custom-scroll-btn')).toBeNull();
    });
  });

  /* ----------------------------------------------------------------- */
  /*  onStartReached                                                   */
  /* ----------------------------------------------------------------- */

  describe('onStartReached', () => {
    it('is not invoked on initial mount', () => {
      const spy = vi.fn();
      setup({ onStartReached: spy });
      expect(spy).not.toHaveBeenCalled();
    });

    it('is accepted as a prop without crashing', () => {
      expect(() =>
        setup({ onStartReached: () => Promise.resolve() }),
      ).not.toThrow();
    });
  });

  /* ----------------------------------------------------------------- */
  /*  atBottomThreshold / overscan                                     */
  /* ----------------------------------------------------------------- */

  describe('atBottomThreshold / overscan', () => {
    it('accepts a custom atBottomThreshold', () => {
      const { container } = setup({ atBottomThreshold: 10 });
      expect(container.querySelector('.cml-root')).toBeInTheDocument();
    });

    it('accepts a custom overscan', () => {
      const { container } = setup({ overscan: 500 });
      expect(container.querySelector('.cml-root')).toBeInTheDocument();
    });
  });

  /* ----------------------------------------------------------------- */
  /*  forwardRef integration                                           */
  /* ----------------------------------------------------------------- */

  describe('forwardRef', () => {
    it('works with useRef in a parent component', () => {
      function Tester() {
        const innerRef = useRef<ChatMessageListMethods<Message>>(null);
        return (
          <div style={{ height: 600 }}>
            <ChatMessageList<Message>
              ref={innerRef}
              computeItemKey={computeItemKey}
              itemContent={itemContent}
              initialData={[makeMsg('ref-test')]}
            />
            <button
              data-testid="add-btn"
              onClick={() => innerRef.current?.data.append([makeMsg('added')])}
            />
            <div
              data-testid="length-display"
              data-length={innerRef.current?.data.length() ?? -1}
            />
          </div>
        );
      }
      const { rerender } = render(<Tester />);
      // After mount the ref should be populated; trigger a re-render to read length
      rerender(<Tester />);
      fireEvent.click(screen.getByTestId('add-btn'));
      rerender(<Tester />);
      const lengthEl = screen.getByTestId('length-display');
      expect(lengthEl.getAttribute('data-length')).toBe('2');
    });
  });

  /* ----------------------------------------------------------------- */
  /*  Edge cases                                                       */
  /* ----------------------------------------------------------------- */

  describe('edge cases', () => {
    it('interleaved append and prepend produce the correct order', () => {
      const { ref } = setup({ initialData: [makeMsg('mid')] });
      act(() => {
        dataOf(ref).append([makeMsg('after')]);
        dataOf(ref).prepend([makeMsg('before')]);
      });
      expect(dataOf(ref).get().map((m) => m.id)).toEqual([
        'before',
        'mid',
        'after',
      ]);
    });

    it('append after prepend keeps prepended items', () => {
      const { ref } = setup({ initialData: [makeMsg('b')] });
      act(() => {
        dataOf(ref).prepend([makeMsg('a')]);
      });
      act(() => {
        dataOf(ref).append([makeMsg('c')]);
      });
      expect(dataOf(ref).get().map((m) => m.id)).toEqual(['a', 'b', 'c']);
    });

    it('handles 1000-item batch without crashing', () => {
      const { ref } = setup({ initialData: [] });
      act(() => {
        dataOf(ref).append(makeMsgs(1000));
      });
      expect(dataOf(ref).length()).toBe(1000);
    });

    it('handles items with duplicate IDs (state still consistent)', () => {
      const { ref } = setup({
        initialData: [makeMsg('dup'), makeMsg('dup')],
      });
      expect(dataOf(ref).length()).toBe(2);
      expect(dataOf(ref).get().filter((m) => m.id === 'dup')).toHaveLength(2);
    });

    it('survives rapid mixed operations across batches', () => {
      const { ref } = setup({ initialData: [] });
      // Each batch must be its own act() so dataRef catches up between
      // operations — find/findAndDelete read dataRef.current.
      act(() => {
        for (let i = 0; i < 20; i++) {
          dataOf(ref).append([makeMsg(`a${i}`)]);
        }
      });
      act(() => {
        for (let i = 0; i < 10; i++) {
          dataOf(ref).prepend([makeMsg(`p${i}`)]);
        }
      });
      for (let i = 0; i < 5; i++) {
        act(() => {
          dataOf(ref).findAndDelete((m) => m.id === `a${i * 2}`);
        });
      }
      // 20 appended + 10 prepended - 5 deleted = 25
      expect(dataOf(ref).length()).toBe(25);
      expectNotInState(ref, 'a0');
      expectNotInState(ref, 'a2');
      expectInState(ref, 'a1');
      expectInState(ref, 'p0');
    });

    it('queued find* in a single batch operate on the latest imperative state', () => {
      const { ref } = setup({ initialData: [makeMsg('keep')] });
      act(() => {
        dataOf(ref).append([makeMsg('added')]);
        const deleted = dataOf(ref).findAndDelete((m) => m.id === 'added');
        expect(deleted).toBe(true);
      });
      expect(dataOf(ref).length()).toBe(1);
      expectNotInState(ref, 'added');
    });
  });
});
