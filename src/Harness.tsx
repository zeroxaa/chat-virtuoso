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
      ids: () => string[];
      lastFiredStartReachedAt: number | null;
      methods: () => ChatMessageListMethods<HarnessMessage> | null;
    };
  }
}

interface HarnessMessage {
  id: string;
  text: string;
}

let nextN = 0;
const mkBatch = (n: number, prefix = 'a'): HarnessMessage[] => {
  const out: HarnessMessage[] = [];
  for (let i = 0; i < n; i++) {
    const id = `${prefix}${nextN++}`;
    out.push({ id, text: `${id}: lorem ipsum dolor sit amet` });
  }
  return out;
};

export default function Harness() {
  const ref = useRef<ChatMessageListMethods<HarnessMessage>>(null);
  const [startReachedCount, setStartReachedCount] = useState(0);

  useEffect(() => {
    window.__chat = {
      append: (n, opts) =>
        ref.current?.data.append(mkBatch(n), opts ? { behavior: opts.behavior } : undefined),
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
          itemContent={(idx, m) => (
            <div
              data-testid={`msg-${m.id}`}
              data-index={idx}
              style={{
                padding: '8px 12px',
                margin: '4px 12px',
                height: 32,
                lineHeight: '16px',
                background: '#232a37',
                borderRadius: 8,
                fontSize: 13,
                overflow: 'hidden',
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
