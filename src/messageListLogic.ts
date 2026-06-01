/**
 * Pure message-list state management — extracted from ChatMessageList.
 * No React, no DOM. 100% testable with plain unit tests.
 */
export const PREPEND_START_INDEX = 1_000_000;

export type AppendBehaviorInput =
  | 'auto'
  | 'smooth'
  | false
  | ((ctx: { atBottom: boolean }) => 'auto' | 'smooth' | false);

export interface MessageListState<T> {
  items: T[];
  dataVersion: number;
  atBottom: boolean;
  firstItemIndex: number;
  unreadCount: number;
  nextAppendBehavior: 'auto' | 'smooth' | false;
  pendingAppendBehavior: 'auto' | 'smooth' | false;
}

export function createInitialState<T>(initialData?: T[]): MessageListState<T> {
  return {
    items: initialData?.slice() ?? [],
    dataVersion: 0,
    atBottom: true,
    firstItemIndex: PREPEND_START_INDEX,
    unreadCount: 0,
    nextAppendBehavior: 'auto',
    pendingAppendBehavior: false,
  };
}

export function appendItems<T>(
  state: MessageListState<T>,
  newItems: T[],
  behavior?: AppendBehaviorInput,
): MessageListState<T> {
  const resolvedBehavior = behavior ?? state.nextAppendBehavior;

  let effectiveBehavior: 'auto' | 'smooth' | false;
  if (typeof resolvedBehavior === 'function') {
    effectiveBehavior = resolvedBehavior({ atBottom: state.atBottom });
  } else {
    effectiveBehavior = resolvedBehavior;
  }

  const items = [...state.items, ...newItems];

  const unreadCount =
    effectiveBehavior === false
      ? state.unreadCount + newItems.length
      : 0;

  return {
    ...state,
    items,
    dataVersion: state.dataVersion + 1,
    unreadCount,
    nextAppendBehavior: 'auto',
    pendingAppendBehavior: effectiveBehavior,
  };
}

export function prependItems<T>(
  state: MessageListState<T>,
  newItems: T[],
): MessageListState<T> {
  const items = [...newItems, ...state.items];
  return {
    ...state,
    items,
    dataVersion: state.dataVersion + 1,
    firstItemIndex: state.firstItemIndex - newItems.length,
    nextAppendBehavior: false,
    pendingAppendBehavior: false,
  };
}

export function replaceItems<T>(
  state: MessageListState<T>,
  items: T[],
): MessageListState<T> {
  const nextItems = items.slice();
  return {
    ...state,
    items: nextItems,
    dataVersion: state.dataVersion + 1,
    firstItemIndex: PREPEND_START_INDEX,
    atBottom: true,
    unreadCount: 0,
    nextAppendBehavior: 'auto',
    pendingAppendBehavior: false,
  };
}

export function mapItems<T>(
  state: MessageListState<T>,
  fn: (item: T, index: number) => T,
): MessageListState<T> {
  const items = state.items.map(fn);
  return replaceMappedItems(state, items);
}

export function replaceMappedItems<T>(
  state: MessageListState<T>,
  items: T[],
): MessageListState<T> {
  return {
    ...state,
    items: items.slice(),
    dataVersion: state.dataVersion + 1,
    nextAppendBehavior: false,
    pendingAppendBehavior: false,
  };
}

export function findItem<T>(
  state: MessageListState<T>,
  predicate: (item: T, index: number) => boolean,
): T | undefined {
  return state.items.find(predicate);
}

export function findAndUpdateItem<T>(
  state: MessageListState<T>,
  predicate: (item: T, index: number) => boolean,
  updater: (item: T) => T,
): { state: MessageListState<T>; found: boolean } {
  const idx = state.items.findIndex(predicate);
  if (idx === -1) return { state, found: false };
  const items = [...state.items];
  items[idx] = updater(items[idx]);
  return {
    state: {
      ...state,
      items,
      dataVersion: state.dataVersion + 1,
      nextAppendBehavior: false,
      pendingAppendBehavior: false,
    },
    found: true,
  };
}

export function findAndDeleteItem<T>(
  state: MessageListState<T>,
  predicate: (item: T, index: number) => boolean,
): { state: MessageListState<T>; found: boolean } {
  const idx = state.items.findIndex(predicate);
  if (idx === -1) return { state, found: false };
  const items = [...state.items.slice(0, idx), ...state.items.slice(idx + 1)];
  return {
    state: {
      ...state,
      items,
      dataVersion: state.dataVersion + 1,
      nextAppendBehavior: false,
      pendingAppendBehavior: false,
      firstItemIndex: state.firstItemIndex + 1,
    },
    found: true,
  };
}

export function updateItemAt<T>(
  state: MessageListState<T>,
  index: number,
  item: T,
): MessageListState<T> {
  if (index < 0 || index >= state.items.length) return state;
  const items = state.items.slice();
  items[index] = item;
  return {
    ...state,
    items,
    dataVersion: state.dataVersion + 1,
    nextAppendBehavior: false,
    pendingAppendBehavior: false,
  };
}

export function deleteItemAt<T>(
  state: MessageListState<T>,
  index: number,
): MessageListState<T> {
  if (index < 0 || index >= state.items.length) return state;
  const items = [...state.items.slice(0, index), ...state.items.slice(index + 1)];
  return {
    ...state,
    items,
    dataVersion: state.dataVersion + 1,
    nextAppendBehavior: false,
    pendingAppendBehavior: false,
    firstItemIndex: state.firstItemIndex + 1,
    atBottom: items.length === 0 ? true : state.atBottom,
    unreadCount: items.length === 0 ? 0 : state.unreadCount,
  };
}

export function setAtBottom<T>(
  state: MessageListState<T>,
  atBottom: boolean,
): MessageListState<T> {
  if (state.atBottom === atBottom && (!atBottom || state.unreadCount === 0)) {
    return state;
  }
  return {
    ...state,
    atBottom,
    unreadCount: atBottom ? 0 : state.unreadCount,
  };
}

export function clearUnread<T>(state: MessageListState<T>): MessageListState<T> {
  if (state.unreadCount === 0) return state;
  return {
    ...state,
    unreadCount: 0,
  };
}

export function getItems<T>(state: MessageListState<T>): readonly T[] {
  return state.items.slice();
}

export function getLength(state: MessageListState<unknown>): number {
  return state.items.length;
}
