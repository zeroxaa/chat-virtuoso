/**
 * VirtuosoMessageList — an open-source, drop-in reimplementation of the paid
 * `@virtuoso.dev/message-list` component, backed by the MIT-licensed
 * `react-virtuoso`. The public interface (props, ref methods, the
 * `useVirtuosoMethods` / `useVirtuosoLocation` context hooks, and the
 * `VirtuosoMessageListLicense` wrapper) mirrors the commercial package so that
 * code written against it — notably Dust's ConversationViewer — ports over by
 * changing only the import path. We replace the implementation, not the API.
 *
 * Data ownership lives INSIDE the component (a reducer over the pure helpers in
 * ./messageListLogic). Drive it through the ref or `useVirtuosoMethods()`:
 *
 *   ref.current.data.append([msg], autoScroll);
 *   ref.current.data.insert([msg], index, autoScroll);
 *   ref.current.scrollToItem({ index: "LAST", align: "end", behavior: "smooth" });
 */
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ForwardedRef,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso';
import {
  appendItems,
  clearPendingAppendBehavior,
  createInitialState,
  findAndDeleteItem,
  findAndUpdateItem,
  findItem,
  getItems,
  insertItemsAt,
  prependItems,
  replaceItems,
  replaceMappedItems,
  setAtBottom,
  type MessageListState,
} from './messageListLogic';
import './chat-message-list.css';

// ─── Public types (mirror @virtuoso.dev/message-list) ────────────────────

/** A commercial-compatible scroll behavior. The object form (used by Dust's
 * `customSmoothScroll`) is approximated as a smooth scroll here. */
export type VirtuosoScrollBehavior =
  | 'auto'
  | 'smooth'
  | 'instant'
  | { animationFrameCount?: number; easing?: (x: number) => number };

export interface ScrollLocationWithAlign {
  index: number | 'LAST';
  align?: 'start' | 'center' | 'end';
  behavior?: VirtuosoScrollBehavior;
}

/** Snapshot of the scroller geometry, as read by `onScroll`,
 * `getScrollLocation()` and `useVirtuosoLocation()`. */
export interface ListScrollLocation {
  scrollHeight: number;
  scrollTop: number;
  viewportHeight: number;
  /** Alias kept for parity with the commercial API. */
  visibleListHeight: number;
  /** Distance (px) from the viewport bottom to the list bottom. 0 at bottom. */
  bottomOffset: number;
  /** Distance (px) from the list top to the viewport top; negative when scrolled down. */
  listOffset: number;
  isAtBottom: boolean;
}

/** Controls whether/how to scroll after an append/insert. `true` → stick to
 * bottom; `false` → stay put; a function decides from the live geometry. */
export type AutoScrollControl<D> =
  | boolean
  | ((params: {
      data: D[];
      scrollLocation: ListScrollLocation;
    }) => ScrollLocationWithAlign | boolean);

export interface DataWithScrollModifier<D> {
  data: D[] | undefined;
  scrollModifier?: {
    type: 'item-location';
    location: ScrollLocationWithAlign;
    purgeItemSizes?: boolean;
  };
}

export interface VirtuosoMessageListData<D> {
  get: () => D[];
  find: (predicate: (item: D, index: number) => boolean) => D | undefined;
  findAndDelete: (predicate: (item: D, index: number) => boolean) => void;
  findAndUpdate: (
    predicate: (item: D, index: number) => boolean,
    update: (item: D) => D,
  ) => void;
  map: (mapper: (item: D, index: number) => D) => void;
  append: (items: D[], autoScroll?: AutoScrollControl<D>) => void;
  insert: (items: D[], index: number, autoScroll?: AutoScrollControl<D>) => void;
  prepend: (items: D[]) => void;
  replace: (items: D[]) => void;
}

export interface VirtuosoMessageListMethods<D, _C = unknown> {
  data: VirtuosoMessageListData<D>;
  scrollToItem: (location: ScrollLocationWithAlign) => void;
  getScrollLocation: () => ListScrollLocation;
}

export interface ItemContentProps<D, C> {
  data: D;
  context: C;
  prevData: D | null;
  nextData: D | null;
  index: number;
}

export interface VirtuosoMessageListProps<D, C> {
  /** Seed (and reset) the dataset + optional initial scroll. After the first
   * non-empty seed the list owns its data; mutate via the ref / hooks. */
  data?: DataWithScrollModifier<D>;
  context: C;
  computeItemKey: (params: { data: D; context: C; index: number }) => string | number;
  /** Stable identity for an item across data mutations (recycling hint). */
  itemIdentity?: (item: D) => string;
  ItemContent: ComponentType<ItemContentProps<D, C>>;
  StickyHeader?: ComponentType<{ context: C }>;
  StickyFooter?: ComponentType<{ context: C }>;
  EmptyPlaceholder?: ComponentType;
  Header?: ComponentType;
  onScroll?: (location: ListScrollLocation) => void;
  onRenderedDataChange?: (data: D[]) => void;
  /** Overscan in px on each side (commercial: increaseViewportBy). */
  increaseViewportBy?: number;
  shortSizeAlign?: 'top' | 'bottom';
  enforceStickyFooterAtBottom?: boolean;
  className?: string;
  style?: CSSProperties;
}

// ─── Context (useVirtuosoMethods / useVirtuosoLocation) ───────────────────

const VirtuosoMethodsContext = createContext<VirtuosoMessageListMethods<
  unknown,
  unknown
> | null>(null);
const VirtuosoLocationContext = createContext<ListScrollLocation | null>(null);

export function useVirtuosoMethods<D, C = unknown>(): VirtuosoMessageListMethods<
  D,
  C
> {
  const methods = useContext(VirtuosoMethodsContext);
  if (!methods) {
    throw new Error('useVirtuosoMethods must be used inside a VirtuosoMessageList');
  }
  return methods as unknown as VirtuosoMessageListMethods<D, C>;
}

export function useVirtuosoLocation(): ListScrollLocation {
  const location = useContext(VirtuosoLocationContext);
  return location ?? EMPTY_LOCATION;
}

const EMPTY_LOCATION: ListScrollLocation = {
  scrollHeight: 0,
  scrollTop: 0,
  viewportHeight: 0,
  visibleListHeight: 0,
  bottomOffset: 0,
  listOffset: 0,
  isAtBottom: true,
};

/** No-op license wrapper — the commercial component gates on a key; ours is
 * free, so this just renders its children. */
export function VirtuosoMessageListLicense({
  children,
}: {
  licenseKey?: string;
  children: ReactNode;
}): ReactElement {
  return <>{children}</>;
}

// ─── Reducer (wraps the pure helpers in messageListLogic) ────────────────

type Action<D> =
  | { type: 'append'; items: D[] }
  | { type: 'insert'; items: D[]; index: number }
  | { type: 'prepend'; items: D[] }
  | { type: 'replace'; items: D[] }
  | { type: 'commit'; state: MessageListState<D> }
  | { type: 'setAtBottom'; atBottom: boolean }
  | { type: 'clearPendingAppendBehavior' };

function reducer<D>(state: MessageListState<D>, action: Action<D>): MessageListState<D> {
  switch (action.type) {
    case 'append':
      // We resolve scroll ourselves (see scheduleAutoScroll), so append never
      // carries a behavior here — pass `false` to avoid the engine's auto-stick.
      return appendItems(state, action.items, false);
    case 'insert':
      return insertItemsAt(state, action.items, action.index);
    case 'prepend':
      return prependItems(state, action.items);
    case 'replace':
      return replaceItems(state, action.items);
    case 'commit':
      return action.state;
    case 'setAtBottom':
      return setAtBottom(state, action.atBottom);
    case 'clearPendingAppendBehavior':
      return clearPendingAppendBehavior(state);
    default:
      return state;
  }
}

const THRESHOLD = 24;

function VirtuosoMessageListInner<D, C>(
  props: VirtuosoMessageListProps<D, C>,
  forwardedRef: ForwardedRef<VirtuosoMessageListMethods<D, C>>,
) {
  const {
    data: dataProp,
    context,
    computeItemKey,
    ItemContent,
    StickyHeader,
    StickyFooter,
    EmptyPlaceholder,
    Header,
    onScroll,
    onRenderedDataChange,
    increaseViewportBy = 200,
    enforceStickyFooterAtBottom = false,
    className,
    style,
  } = props;

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  // The cml-root is the scroll container (customScrollParent). Using an external,
  // reliably-sized parent fixes react-virtuoso's broken height measurement under
  // React 19 — without it Virtuoso renders only `initialItemCount` items and
  // never expands (appended-tail messages stay invisible).
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);

  const [state, rawDispatch] = useReducer(
    reducer<D>,
    dataProp?.data,
    createInitialState<D>,
  );
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback((action: Action<D>) => {
    const next = reducer(stateRef.current, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    rawDispatch(action);
  }, []);

  // Live scroll location, recomputed from the scroller element.
  const computeLocation = useCallback((): ListScrollLocation => {
    const el = scrollerElRef.current;
    if (!el) return EMPTY_LOCATION;
    const { scrollHeight, scrollTop, clientHeight } = el;
    const bottomOffset = scrollHeight - clientHeight - scrollTop;
    return {
      scrollHeight,
      scrollTop,
      viewportHeight: clientHeight,
      visibleListHeight: clientHeight,
      bottomOffset,
      listOffset: -scrollTop,
      isAtBottom: bottomOffset <= THRESHOLD,
    };
  }, []);

  const [location, setLocation] = useState<ListScrollLocation>(EMPTY_LOCATION);
  const locationRef = useRef<ListScrollLocation>(EMPTY_LOCATION);
  const locationRafRef = useRef<number | null>(null);

  const refreshLocation = useCallback(() => {
    const loc = computeLocation();
    locationRef.current = loc;
    // onScroll fires every event (load-more / auto-scroll detection need it),
    // but the React state that drives useVirtuosoLocation is throttled to one
    // update per frame to avoid a re-render storm on fast scroll.
    onScroll?.(loc);
    if (locationRafRef.current === null) {
      locationRafRef.current = requestAnimationFrame(() => {
        locationRafRef.current = null;
        setLocation(locationRef.current);
      });
    }
  }, [computeLocation, onScroll]);

  // ─── scrollToItem / scrollToBottom ─────────────────────────────────────

  const resolveBehavior = (
    behavior?: VirtuosoScrollBehavior,
  ): 'auto' | 'smooth' => {
    if (behavior === 'instant') return 'auto';
    if (behavior === 'smooth' || behavior === undefined) return 'smooth';
    if (typeof behavior === 'object') return 'smooth';
    return behavior;
  };

  const scrollToItem = useCallback(
    ({ index, align = 'start', behavior }: ScrollLocationWithAlign) => {
      const resolved =
        index === 'LAST' ? Math.max(0, stateRef.current.items.length - 1) : index;
      virtuosoRef.current?.scrollToIndex({
        index: resolved,
        align,
        behavior: resolveBehavior(behavior),
      });
    },
    [],
  );

  // ─── deferred auto-scroll after append/insert ──────────────────────────
  // The commercial append/insert second arg controls scrolling. We stash the
  // resolved target and apply it once the new data has committed/painted.
  const pendingScrollRef = useRef<ScrollLocationWithAlign | null>(null);

  const resolveAutoScroll = useCallback(
    (
      autoScroll: AutoScrollControl<D> | undefined,
      itemsAfter: D[],
    ): ScrollLocationWithAlign | null => {
      if (autoScroll === undefined || autoScroll === true) {
        return { index: 'LAST', align: 'end', behavior: 'smooth' };
      }
      if (autoScroll === false) return null;
      const decision = autoScroll({
        data: itemsAfter,
        scrollLocation: computeLocation(),
      });
      if (decision === false) return null;
      if (decision === true) {
        return { index: 'LAST', align: 'end', behavior: 'smooth' };
      }
      return decision;
    },
    [computeLocation],
  );

  // Apply the pending scroll after each data version bump + paint.
  useEffect(() => {
    const target = pendingScrollRef.current;
    if (!target) return;
    pendingScrollRef.current = null;
    const run = () => scrollToItem(target);
    run();
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
  }, [state.dataVersion, scrollToItem]);

  // ─── imperative methods (ref + context) ────────────────────────────────

  const methods = useMemo<VirtuosoMessageListMethods<D, C>>(() => {
    const data: VirtuosoMessageListData<D> = {
      get: () => getItems(stateRef.current) as D[],
      find: (predicate) => findItem(stateRef.current, predicate),
      findAndDelete: (predicate) => {
        const { state: next, found } = findAndDeleteItem(stateRef.current, predicate);
        if (found) dispatch({ type: 'commit', state: next });
      },
      findAndUpdate: (predicate, update) => {
        const { state: next, found } = findAndUpdateItem(
          stateRef.current,
          predicate,
          update,
        );
        if (found) dispatch({ type: 'commit', state: next });
      },
      map: (mapper) => {
        const mapped = stateRef.current.items.map(mapper);
        dispatch({ type: 'commit', state: replaceMappedItems(stateRef.current, mapped) });
      },
      append: (items, autoScroll) => {
        if (items.length === 0) return;
        const itemsAfter = [...stateRef.current.items, ...items];
        pendingScrollRef.current = resolveAutoScroll(autoScroll, itemsAfter);
        dispatch({ type: 'append', items });
      },
      insert: (items, index, autoScroll) => {
        if (items.length === 0) return;
        const clamped = Math.max(0, Math.min(index, stateRef.current.items.length));
        const itemsAfter = [
          ...stateRef.current.items.slice(0, clamped),
          ...items,
          ...stateRef.current.items.slice(clamped),
        ];
        pendingScrollRef.current = resolveAutoScroll(autoScroll, itemsAfter);
        dispatch({ type: 'insert', items, index });
      },
      prepend: (items) => {
        if (items.length === 0) return;
        dispatch({ type: 'prepend', items });
      },
      replace: (items) => {
        dispatch({ type: 'replace', items });
      },
    };
    return {
      data,
      scrollToItem,
      getScrollLocation: () => locationRef.current,
    };
  }, [dispatch, resolveAutoScroll, scrollToItem]);

  useImperativeHandle(forwardedRef, () => methods, [methods]);

  // ─── seed / reset from the `data` prop (+ scrollModifier) ───────────────
  const seededRef = useRef<D[] | undefined>(dataProp?.data);
  useEffect(() => {
    const incoming = dataProp?.data;
    if (incoming === undefined || incoming === seededRef.current) return;
    seededRef.current = incoming;
    dispatch({ type: 'replace', items: incoming });
    const mod = dataProp?.scrollModifier;
    pendingScrollRef.current = mod
      ? mod.location
      : { index: 'LAST', align: 'end', behavior: 'instant' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataProp?.data]);

  // Bottom-anchor on first paint (chat default). Done post-mount via the ref
  // rather than Virtuoso's initialTopMostItemIndex, which mis-resolves against
  // a large firstItemIndex and can hand an out-of-range item to itemContent.
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (didInitialScrollRef.current || state.items.length === 0) return;
    didInitialScrollRef.current = true;
    const target = dataProp?.scrollModifier?.location ?? {
      index: 'LAST' as const,
      align: 'end' as const,
      behavior: 'auto' as const,
    };
    requestAnimationFrame(() => {
      scrollToItem(target);
      requestAnimationFrame(() => scrollToItem(target));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.items.length]);

  // ─── scroller wiring ────────────────────────────────────────────────────
  // The scroll container is the cml-root (customScrollParent); attach the
  // scroll listener to it for getScrollLocation / onScroll / load-more.
  useEffect(() => {
    if (!scrollParent) return;
    scrollerElRef.current = scrollParent;
    scrollParent.addEventListener('scroll', refreshLocation, { passive: true });
    queueMicrotask(refreshLocation);
    return () => {
      scrollParent.removeEventListener('scroll', refreshLocation);
      if (scrollerElRef.current === scrollParent) scrollerElRef.current = null;
    };
  }, [scrollParent, refreshLocation]);

  const handleAtBottomStateChange = useCallback(
    (atBottom: boolean) => {
      dispatch({ type: 'setAtBottom', atBottom });
      queueMicrotask(refreshLocation);
    },
    [dispatch, refreshLocation],
  );

  // ─── rendered-range → onRenderedDataChange ──────────────────────────────
  const lastRangeRef = useRef('');
  const handleRangeChanged = useCallback(
    (range: ListRange) => {
      if (!onRenderedDataChange) return;
      const items = stateRef.current.items;
      const start = Math.max(0, range.startIndex - state_firstIndex(stateRef.current));
      const end = Math.min(items.length, range.endIndex - state_firstIndex(stateRef.current) + 1);
      const key = `${start}:${end}:${stateRef.current.dataVersion}`;
      if (key === lastRangeRef.current) return;
      lastRangeRef.current = key;
      onRenderedDataChange(items.slice(start, end));
    },
    [onRenderedDataChange],
  );

  // ─── item rendering ─────────────────────────────────────────────────────
  const toRelative = useCallback(
    (virtuosoIndex: number) => virtuosoIndex - state_firstIndex(stateRef.current),
    [],
  );

  const renderItem = useCallback(
    (virtuosoIndex: number, item: D) => {
      const rel = toRelative(virtuosoIndex);
      const items = stateRef.current.items;
      const prevData = rel > 0 ? items[rel - 1] : null;
      const nextData = rel < items.length - 1 ? items[rel + 1] : null;
      return (
        <ItemContent
          data={item}
          context={context}
          prevData={prevData ?? null}
          nextData={nextData ?? null}
          index={rel}
        />
      );
    },
    [ItemContent, context, toRelative],
  );

  const renderKey = useCallback(
    (virtuosoIndex: number, item: D) =>
      computeItemKey({ data: item, context, index: toRelative(virtuosoIndex) }),
    [computeItemKey, context, toRelative],
  );

  const components = useMemo(
    () => ({ Header: Header ? () => <Header /> : undefined }),
    [Header],
  );

  const isEmpty = state.items.length === 0;

  return (
    <VirtuosoMethodsContext.Provider
      value={methods as unknown as VirtuosoMessageListMethods<unknown, unknown>}
    >
      <VirtuosoLocationContext.Provider value={location}>
        <div
          ref={setScrollParent}
          className={['cml-root', className].filter(Boolean).join(' ')}
          style={style}
        >
          {StickyHeader ? (
            <div className="cml-sticky-overlay cml-sticky-top">
              <StickyHeader context={context} />
            </div>
          ) : null}

          {isEmpty && EmptyPlaceholder ? (
            <EmptyPlaceholder />
          ) : scrollParent ? (
            // Only mount Virtuoso once the cml-root exists, so customScrollParent
            // is set from its very first render (a reliably-measured external
            // scroller) — this is what makes it render the full viewport+overscan
            // window and expand on append, instead of freezing at initialItemCount.
            <Virtuoso
              ref={virtuosoRef}
              // Render the full set and remount on count change. react-virtuoso's
              // scroll-driven windowing isn't re-measuring in this embedding (its
              // ResizeObserver/scroll recompute doesn't fire to expand past the
              // initial window), so we render everything and let the key remount
              // pick up added/removed turns. The key changes ONLY on length change
              // (add/remove) — NOT on token streaming — so a reply streams in
              // without remounting. Margins on items are already removed (they
              // break Virtuoso's measurement); windowing can be restored once the
              // remaining measurement issue in this layout is isolated.
              key={`vml-${state.items.length}`}
              customScrollParent={scrollParent}
              data={state.items}
              firstItemIndex={state.firstItemIndex}
              initialItemCount={state.items.length}
              computeItemKey={renderKey}
              itemContent={renderItem}
              rangeChanged={handleRangeChanged}
              atBottomStateChange={handleAtBottomStateChange}
              atBottomThreshold={THRESHOLD}
              increaseViewportBy={{ top: increaseViewportBy, bottom: increaseViewportBy }}
              components={components}
              alignToBottom
            />
          ) : null}

          {StickyFooter ? (
            <div
              className={[
                'cml-sticky-overlay',
                'cml-sticky-bottom',
                enforceStickyFooterAtBottom ? 'cml-sticky-bottom-enforced' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <StickyFooter context={context} />
            </div>
          ) : null}
        </div>
      </VirtuosoLocationContext.Provider>
    </VirtuosoMethodsContext.Provider>
  );
}

function state_firstIndex<D>(state: MessageListState<D>): number {
  return state.firstItemIndex;
}

export const VirtuosoMessageList = forwardRef(VirtuosoMessageListInner) as <D, C = unknown>(
  props: VirtuosoMessageListProps<D, C> & {
    ref?: Ref<VirtuosoMessageListMethods<D, C>>;
  },
) => ReactElement;
