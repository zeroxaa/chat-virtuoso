/**
 * E2E test harness. The Playwright suite navigates to ?harness=1 and drives
 * the component via `window.__chat` (exposed below). Every message has a
 * deterministic id `m_<n>` and a fixed height bubble so scroll math is
 * predictable.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ChatMessageList,
  type ChatMessageListMethods,
} from './ChatMessageList';

declare global {
  interface Window {
    __chat: {
      append: (n: number, opts?: { behavior?: 'auto' | 'smooth' | false }) => void;
      prepend: (n: number) => void;
      replace: (n: number) => void;
      clear: () => void;
      length: () => number;
      isAtBottom: () => boolean;
      scrollToBottom: (behavior?: 'auto' | 'smooth') => void;
      setRtl: (rtl: boolean) => void;
      ids: () => string[];
      lastFiredStartReachedAt: number | null;
      methods: () => ChatMessageListMethods<HarnessMessage> | null;
    };
  }
}

interface HarnessMessage {
  id: string;
  text: string;
  sender: 'ada' | 'grace';
  day: 'Earlier' | 'Today';
}

let nextN = 0;
const mkBatch = (
  n: number,
  prefix = 'a',
  forceDay?: HarnessMessage['day'],
): HarnessMessage[] => {
  const out: HarnessMessage[] = [];
  for (let i = 0; i < n; i++) {
    const id = `${prefix}${nextN++}`;
    out.push({
      id,
      text: `${id}: lorem ipsum dolor sit amet`,
      sender: Math.floor(i / 2) % 2 === 0 ? 'ada' : 'grace',
      day: forceDay ?? (prefix === 'p' || i < Math.ceil(n / 6) ? 'Earlier' : 'Today'),
    });
  }
  return out;
};

export default function Harness() {
  const ref = useRef<ChatMessageListMethods<HarnessMessage>>(null);
  const [startReachedCount, setStartReachedCount] = useState(0);
  const [rtl, setRtl] = useState(false);

  useEffect(() => {
    window.__chat = {
      append: (n, opts) =>
        ref.current?.data.append(
          mkBatch(n, 'a', 'Today'),
          opts ? { behavior: opts.behavior } : undefined,
        ),
      prepend: (n) => ref.current?.data.prepend(mkBatch(n, 'p')),
      replace: (n) => {
        nextN = 0;
        ref.current?.data.replace(mkBatch(n));
      },
      clear: () => ref.current?.data.replace([]),
      length: () => ref.current?.data.length() ?? -1,
      isAtBottom: () => ref.current?.isAtBottom() ?? false,
      scrollToBottom: (behavior = 'smooth') =>
        ref.current?.scrollToBottom(behavior),
      setRtl,
      ids: () => (ref.current?.data.get() ?? []).map((m) => m.id),
      lastFiredStartReachedAt: null,
      methods: () => ref.current,
    };
  }, []);

  return (
    <div
      data-testid="harness-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '600px',
        width: '600px',
        margin: '0 auto',
        border: '1px solid #444',
        background: '#161a22',
        color: '#e6e9ef',
      }}
    >
      <div
        data-testid="harness-status"
        data-start-reached-count={startReachedCount}
        style={{ padding: 4, fontSize: 11, borderBottom: '1px solid #333' }}
      >
        debug
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <ChatMessageList<HarnessMessage>
          ref={ref}
          initialData={mkBatch(30)}
          computeItemKey={(m) => m.id}
          groupBy={(m) => m.day}
          StickyHeaderComponent={({ groupKey, messages }) => (
            <div
              data-testid="sticky-label"
              style={{
                margin: '6px auto',
                width: 'fit-content',
                padding: '3px 10px',
                borderRadius: 999,
                background: '#394150',
                color: '#f8fafc',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {groupKey} ({messages.length})
            </div>
          )}
          grouped
          rtl={rtl}
          itemContent={(idx, m, ctx) => (
            <div
              data-testid={`msg-${m.id}`}
              data-index={idx}
              data-sender={m.sender}
              data-day={m.day}
              data-first-in-group={String(ctx.isFirstInGroup)}
              data-last-in-group={String(ctx.isLastInGroup)}
              data-prev={ctx.prevItem?.id ?? ''}
              data-next={ctx.nextItem?.id ?? ''}
              style={{
                padding: '8px 12px',
                margin: `${ctx.isFirstInGroup ? 8 : 2}px 12px ${ctx.isLastInGroup ? 8 : 2}px`,
                height: 32,
                lineHeight: '16px',
                background: m.sender === 'ada' ? '#232a37' : '#263344',
                borderRadius: ctx.isFirstInGroup || ctx.isLastInGroup ? 8 : 4,
                fontSize: 13,
                overflow: 'hidden',
                textAlign: rtl ? 'right' : 'left',
              }}
            >
              {m.text}
            </div>
          )}
          onStartReached={() => {
            window.__chat.lastFiredStartReachedAt = Date.now();
            setStartReachedCount((c) => c + 1);
          }}
        />
      </div>
    </div>
  );
}
