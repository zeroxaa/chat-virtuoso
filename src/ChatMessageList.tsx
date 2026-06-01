import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  type ComponentType,
  type CSSProperties,
  type ForwardedRef,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import {
  appendItems,
  clearPendingAppendBehavior,
  clearUnread,
  createInitialState,
  deleteItemAt,
  findAndDeleteItem,
  findAndUpdateItem,
  findItem,
  getItems,
  getLength,
  prependItems,
  replaceMappedItems,
  replaceItems,
  setAtBottom,
  updateItemAt,
  type AppendBehaviorInput,
  type MessageListState,
} from './messageListLogic';

export type ChatScrollBehavior = 'auto' | 'smooth';

export type AppendBehavior =
  | ChatScrollBehavior
  | false
  | ((args: { atBottom: boolean }) => ChatScrollBehavior | false);

export interface AppendOptions {
  /**
   * How to react after the items are appended.
   * - `'smooth'` / `'auto'`: always scroll to the new bottom, with that behavior.
   * - `false`: never scroll (let the user stay where they are).
   * - function: decide based on whether the user was already at the bottom
   *   when the items arrived. Returning `false` keeps the current position.
   *
   * Default: `({ atBottom }) => (atBottom ? 'smooth' : false)` — auto-stick
   * to the bottom only if the user was already there.
   */
  behavior?: AppendBehavior;
}

export interface ChatMessageListData<T> {
  /** Append new messages at the bottom. */
  append: (items: T[], options?: AppendOptions) => void;
  /** Prepend older messages at the top while preserving the visible scroll position. */
  prepend: (items: T[]) => void;
  /** Replace the entire dataset. Resets the prepend offset. */
  replace: (items: T[]) => void;
  /** Apply an updater to every item (e.g. mark all as read). */
  map: (mapper: (item: T, index: number) => T) => void;
  /** Find a single item. */
  find: (predicate: (item: T, index: number) => boolean) => T | undefined;
  /** Find and update a single item in place. */
  findAndUpdate: (
    predicate: (item: T, index: number) => boolean,
    update: (item: T) => T,
  ) => boolean;
  /** Find and delete a single item. */
  findAndDelete: (predicate: (item: T, index: number) => boolean) => boolean;
  /** Update the first item whose computed key matches. */
  updateByKey: (key: string | number, update: (item: T) => T) => boolean;
  /** Delete the first item whose computed key matches. */
  deleteByKey: (key: string | number) => boolean;
  /** Reset the unread counter without changing scroll position. */
  clearUnread: () => void;
  /** Snapshot of the current dataset. */
  get: () => readonly T[];
  /** Current length. */
  length: () => number;
}

export interface ChatMessageListMethods<T> {
  data: ChatMessageListData<T>;
  /** Smoothly (or instantly) scroll to the newest message. */
  scrollToBottom: (behavior?: ChatScrollBehavior) => void;
  /** Scroll an item into view. */
  scrollToItem: (params: {
    index: number;
    behavior?: ChatScrollBehavior;
    align?: 'start' | 'center' | 'end';
  }) => void;
  /** Whether the viewport is currently pinned to the bottom. */
  isAtBottom: () => boolean;
  /** Escape hatch to the underlying Virtuoso instance. */
  getVirtuoso: () => VirtuosoHandle | null;
}

export interface ScrollToBottomButtonProps {
  onClick: () => void;
  /** Whether the button should be visible (user is not at bottom). */
  visible: boolean;
  /** Best-effort count of items appended since the user last saw the bottom. */
  unreadCount: number;
}

export interface ChatMessageListProps<T, C = unknown> {
  /** Initial dataset. After mount the list owns its data; use the ref methods to mutate it. */
  initialData?: T[];
  /** Stable key for each item (used by React + Virtuoso for recycling). */
  computeItemKey: (item: T, index: number) => string | number;
  /**
   * Render an item. Signature mirrors `react-virtuoso`'s `itemContent`:
   * `(index, item, context)`, where `index` is the position in the *visible*
   * dataset (0..length-1).
   */
  itemContent: (index: number, item: T, context: C) => ReactNode;
  /** Optional context object passed to itemContent. */
  context?: C;
  /**
   * Called when the user scrolls (or is already) at the very top — typically
   * to fetch older messages. Call `ref.current.data.prepend(...)` with the
   * loaded items; the scroll position is preserved automatically.
   */
  onStartReached?: () => void | Promise<void>;
  /** Render a custom scroll-to-bottom button. Pass `null` to hide it. */
  ScrollToBottomButton?: ComponentType<ScrollToBottomButtonProps> | null;
  Header?: ComponentType;
  Footer?: ComponentType;
  EmptyPlaceholder?: ComponentType;
  /** Threshold (px) within which the user is considered "at the bottom". Default 24. */
  atBottomThreshold?: number;
  /** Overscan in px on each side. Default 200. */
  overscan?: number;
  className?: string;
  style?: CSSProperties;
}

function DefaultScrollToBottomButton({
  onClick,
  visible,
  unreadCount,
}: ScrollToBottomButtonProps) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="cml-scroll-to-bottom"
      aria-label="Scroll to latest messages"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M6 9l6 6 6-6"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {unreadCount > 0 ? (
        <span className="cml-scroll-to-bottom-badge">{unreadCount}</span>
      ) : null}
    </button>
  );
}

type MessageListAction<T> =
  | { type: 'append'; items: T[]; behavior?: AppendBehaviorInput }
  | { type: 'prepend'; items: T[] }
  | { type: 'replace'; items: T[] }
  | { type: 'map'; items: T[] }
  | { type: 'updateAt'; index: number; item: T }
  | { type: 'deleteAt'; index: number }
  | { type: 'setAtBottom'; atBottom: boolean }
  | { type: 'clearUnread' }
  | { type: 'clearPendingAppendBehavior' }
  | { type: 'commit'; state: MessageListState<T> };

function messageListReducer<T>(
  state: MessageListState<T>,
  action: MessageListAction<T>,
): MessageListState<T> {
  switch (action.type) {
    case 'append':
      return appendItems(state, action.items, action.behavior);
    case 'prepend':
      return prependItems(state, action.items);
    case 'replace':
      return replaceItems(state, action.items);
    case 'map':
      return replaceMappedItems(state, action.items);
    case 'updateAt':
      return updateItemAt(state, action.index, action.item);
    case 'deleteAt':
      return deleteItemAt(state, action.index);
    case 'setAtBottom':
      return setAtBottom(state, action.atBottom);
    case 'clearUnread':
      return clearUnread(state);
    case 'clearPendingAppendBehavior':
      return clearPendingAppendBehavior(state);
    case 'commit':
      return action.state;
    default:
      return state;
  }
}

function ChatMessageListInner<T, C>(
  props: ChatMessageListProps<T, C>,
  forwardedRef: ForwardedRef<ChatMessageListMethods<T>>,
) {
  const {
    initialData,
    computeItemKey,
    itemContent,
    context,
    onStartReached,
    ScrollToBottomButton = DefaultScrollToBottomButton,
    Header,
    Footer,
    EmptyPlaceholder,
    atBottomThreshold = 24,
    overscan = 200,
    className,
    style,
  } = props;

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);

  const [state, rawDispatch] = useReducer(
    messageListReducer<T>,
    initialData,
    createInitialState<T>,
  );
  const stateRef = useRef(state);
  const anchorAfterReplaceRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatchAction = useCallback(
    (action: MessageListAction<T>) => {
      const previous = stateRef.current;
      const next = messageListReducer(previous, action);
      if (next === previous) return;
      stateRef.current = next;
      rawDispatch(action);
    },
    [rawDispatch],
  );

  const followOutput = useCallback((isAtBottom: boolean) => {
    const behavior = stateRef.current.pendingAppendBehavior;
    const resolved =
      typeof behavior === 'function' ? behavior({ atBottom: isAtBottom }) : behavior;
    return resolved === false ? false : resolved;
  }, []);

  useEffect(() => {
    if (state.pendingAppendBehavior !== false) {
      dispatchAction({ type: 'clearPendingAppendBehavior' });
    }
  }, [dispatchAction, state.pendingAppendBehavior]);

  const setAtBottomState = useCallback((isAtBottom: boolean) => {
    dispatchAction({ type: 'setAtBottom', atBottom: isAtBottom });
  }, [dispatchAction]);

  // Virtuoso's atBottomStateChange is the primary signal, but it can stay
  // stale after a programmatic scrollToIndex lands exactly on the threshold,
  // or when content shrinks. We back it up with our own scroll listener.
  const recomputeAtBottom = useCallback(() => {
    const s = scrollerElRef.current;
    if (!s) return;
    const distance = s.scrollHeight - s.clientHeight - s.scrollTop;
    setAtBottomState(distance <= atBottomThreshold);
  }, [atBottomThreshold, setAtBottomState]);

  const handleAtBottomStateChange = useCallback(
    (isAtBottom: boolean) => {
      setAtBottomState(isAtBottom);
      // Cross-check the geometry in case the threshold mismatch left us
      // ambiguously near the edge.
      queueMicrotask(recomputeAtBottom);
    },
    [recomputeAtBottom, setAtBottomState],
  );

  const handleScrollerRef = useCallback(
    (el: HTMLElement | Window | null) => {
      // Virtuoso's `scrollerRef` prop hands us the inner scroller. We attach
      // a scroll listener so we can recompute the at-bottom state ourselves —
      // this is what makes the scroll-to-bottom button hide reliably after
      // programmatic scrolls land within the threshold.
      const old = scrollerElRef.current;
      if (old) old.removeEventListener('scroll', recomputeAtBottom);
      scrollerElRef.current = el instanceof HTMLElement ? el : null;
      if (scrollerElRef.current) {
        scrollerElRef.current.addEventListener('scroll', recomputeAtBottom, {
          passive: true,
        });
        // Initial sync once we have the element.
        queueMicrotask(recomputeAtBottom);
      }
    },
    [recomputeAtBottom],
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const el = scrollerElRef.current;
      if (el) el.removeEventListener('scroll', recomputeAtBottom);
    };
  }, [recomputeAtBottom]);

  const startReachedInFlightRef = useRef(false);

  const handleStartReached = useCallback(() => {
    if (!onStartReached || startReachedInFlightRef.current) return;
    startReachedInFlightRef.current = true;
    let result: void | Promise<void>;
    try {
      result = onStartReached();
    } catch (error) {
      startReachedInFlightRef.current = false;
      throw error;
    }
    Promise.resolve(result)
      .catch((error) => {
        queueMicrotask(() => {
          throw error;
        });
      })
      .finally(() => {
        startReachedInFlightRef.current = false;
      });
  }, [onStartReached]);

  const scrollToBottom = useCallback((behavior: ChatScrollBehavior = 'smooth') => {
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior,
    });
  }, []);

  const scrollToItem = useCallback(
    ({
      index,
      behavior = 'smooth',
      align = 'center',
    }: {
      index: number;
      behavior?: ChatScrollBehavior;
      align?: 'start' | 'center' | 'end';
    }) => {
      // The public API uses dataset-relative indices; Virtuoso uses the
      // current data range index.
      virtuosoRef.current?.scrollToIndex({
        index,
        align,
        behavior,
      });
    },
    [],
  );

  const methods = useMemo<ChatMessageListMethods<T>>(
    () => ({
      data: {
        append: (items, options) => {
          if (items.length === 0) return;
          dispatchAction({
            type: 'append',
            items,
            behavior:
              options?.behavior ?? (({ atBottom: ab }) => (ab ? 'smooth' : false)),
          });
        },
        prepend: (items) => {
          if (items.length === 0) return;
          dispatchAction({ type: 'prepend', items });
        },
        replace: (items) => {
          anchorAfterReplaceRef.current = items.length > 0;
          dispatchAction({ type: 'replace', items });
        },
        map: (mapper) => {
          const mapped = stateRef.current.items.map(mapper);
          dispatchAction({ type: 'map', items: mapped });
        },
        find: (predicate) => findItem(stateRef.current, predicate),
        findAndUpdate: (predicate, update) => {
          const { state: next, found } = findAndUpdateItem(
            stateRef.current,
            predicate,
            update,
          );
          if (found) dispatchAction({ type: 'commit', state: next });
          return found;
        },
        findAndDelete: (predicate) => {
          const { state: next, found } = findAndDeleteItem(
            stateRef.current,
            predicate,
          );
          if (found) dispatchAction({ type: 'commit', state: next });
          return found;
        },
        updateByKey: (key, update) => {
          const { state: next, found } = findAndUpdateItem(
            stateRef.current,
            (item, index) => computeItemKey(item, index) === key,
            update,
          );
          if (found) dispatchAction({ type: 'commit', state: next });
          return found;
        },
        deleteByKey: (key) => {
          const { state: next, found } = findAndDeleteItem(
            stateRef.current,
            (item, index) => computeItemKey(item, index) === key,
          );
          if (found) dispatchAction({ type: 'commit', state: next });
          return found;
        },
        clearUnread: () => {
          dispatchAction({ type: 'clearUnread' });
        },
        get: () => getItems(stateRef.current),
        length: () => getLength(stateRef.current),
      },
      scrollToBottom,
      scrollToItem,
      isAtBottom: () => stateRef.current.atBottom,
      getVirtuoso: () => virtuosoRef.current,
    }),
    [computeItemKey, dispatchAction, scrollToBottom, scrollToItem],
  );

  useImperativeHandle(forwardedRef, () => methods, [methods]);

  const renderItem = useCallback(
    (absoluteIndex: number, item: T) => {
      const relIndex = absoluteIndex - state.firstItemIndex;
      return itemContent(relIndex, item, context as C);
    },
    [context, itemContent, state.firstItemIndex],
  );

  const renderKey = useCallback(
    (absoluteIndex: number, item: T) => {
      const relIndex = absoluteIndex - state.firstItemIndex;
      return computeItemKey(item, relIndex);
    },
    [computeItemKey, state.firstItemIndex],
  );

  const handleScrollToBottomClick = useCallback(() => {
    scrollToBottom('smooth');
  }, [scrollToBottom]);

  useEffect(() => {
    if (!anchorAfterReplaceRef.current) return;
    anchorAfterReplaceRef.current = false;
    if (state.items.length > 0) scrollToBottom('auto');
  }, [scrollToBottom, state.dataVersion, state.items.length]);

  const components = useMemo(
    () => ({
      Header: Header ? () => <Header /> : undefined,
      Footer: Footer ? () => <Footer /> : undefined,
    }),
    [Footer, Header],
  );

  const isEmpty = state.items.length === 0;

  return (
    <div
      className={['cml-root', className].filter(Boolean).join(' ')}
      style={style}
    >
      {isEmpty && EmptyPlaceholder ? (
        <EmptyPlaceholder />
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          scrollerRef={handleScrollerRef}
          data={state.items}
          firstItemIndex={state.firstItemIndex}
          initialTopMostItemIndex={Math.max(0, state.items.length - 1)}
          computeItemKey={renderKey}
          itemContent={renderItem}
          followOutput={followOutput}
          startReached={handleStartReached}
          atBottomStateChange={handleAtBottomStateChange}
          atBottomThreshold={atBottomThreshold}
          increaseViewportBy={{ top: overscan, bottom: overscan }}
          components={components}
          alignToBottom
          style={{ height: '100%' }}
        />
      )}
      {ScrollToBottomButton ? (
          <ScrollToBottomButton
            onClick={handleScrollToBottomClick}
            visible={!state.atBottom && state.items.length > 0}
            unreadCount={state.unreadCount}
          />
      ) : null}
    </div>
  );
}

/**
 * Reusable chat-style message list. Wraps the MIT-licensed `react-virtuoso`
 * `Virtuoso` component to give it the same affordances that the paid
 * `@virtuoso.dev/message-list` provides: bottom-anchored layout, auto-stick
 * on append, scroll-stable prepend, smooth animation, scroll-to-top hook
 * for loading history, and a scroll-to-bottom button when the user scrolls
 * away from the live edge.
 *
 * Data ownership is *inside* the component — drive it through the ref:
 *
 * ```tsx
 * const ref = useRef<ChatMessageListMethods<Message>>(null);
 * ref.current?.data.append([msg]);
 * ref.current?.data.prepend(olderMessages);
 * ref.current?.scrollToBottom();
 * ```
 */
export const ChatMessageList = forwardRef(ChatMessageListInner) as <T, C = unknown>(
  props: ChatMessageListProps<T, C> & { ref?: Ref<ChatMessageListMethods<T>> },
) => ReactElement;
