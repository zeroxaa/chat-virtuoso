import { useEffect, useRef, useState } from 'react';
import {
  ChatMessageList,
  type ChatMessageListMethods,
} from './ChatMessageList';
import './App.css';

interface Message {
  id: string;
  text: string;
  author: 'me' | 'them';
  ts: number;
}

const NAMES = ['Ada', 'Linus', 'Grace', 'Dennis'];
const SAMPLE_LINES = [
  'hey, did you see the new build?',
  'shipping virtualization is harder than it looks',
  'the bottom-anchored scroll trick is so satisfying',
  'we should add typing indicators next',
  'lol that emoji rendered as a box on my phone',
  'fwiw I think react-virtuoso handles this great',
  'can you double-check the prepend logic?',
  'good night',
  'morning! coffee acquired',
  'I just merged the PR, take a look',
  'tests are green, finally',
  'the scrollbar jitter is gone, nice',
  'wait, what does followOutput actually return?',
  'a string, a bool, or false — depends on the case',
  'okay that makes sense',
];

let _id = 0;
const nextId = () => `m_${++_id}`;

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: nextId(),
    text: SAMPLE_LINES[Math.floor(Math.random() * SAMPLE_LINES.length)],
    author: Math.random() < 0.5 ? 'me' : 'them',
    ts: Date.now() - Math.floor(Math.random() * 60_000),
    ...overrides,
  };
}

function makeBatch(n: number, baseTs: number): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < n; i++) {
    out.push(makeMessage({ ts: baseTs - (n - i) * 30_000 }));
  }
  return out;
}

function MessageBubble({ msg }: { msg: Message }) {
  const mine = msg.author === 'me';
  const name = mine ? 'You' : NAMES[msg.id.charCodeAt(2) % NAMES.length];
  return (
    <div className={`msg-row ${mine ? 'mine' : 'theirs'}`}>
      <div className="msg-bubble">
        <div className="msg-meta">
          <span className="msg-author">{name}</span>
          <span className="msg-time">
            {new Date(msg.ts).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
        <div className="msg-text">{msg.text}</div>
      </div>
    </div>
  );
}

export default function App() {
  const listRef = useRef<ChatMessageListMethods<Message>>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [initialOldestTs] = useState(() => Date.now() - 30 * 60_000);
  const oldestTsRef = useRef(initialOldestTs);
  const [draft, setDraft] = useState('');
  const autoSendRef = useRef<number | null>(null);
  const [autoSend, setAutoSend] = useState(false);

  // Seed once
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const initial = makeBatch(30, Date.now());
    listRef.current?.data.replace(initial);
  }, []);

  useEffect(() => {
    if (!autoSend) {
      if (autoSendRef.current) {
        window.clearInterval(autoSendRef.current);
        autoSendRef.current = null;
      }
      return;
    }
    autoSendRef.current = window.setInterval(() => {
      listRef.current?.data.append([
        makeMessage({ author: 'them', ts: Date.now() }),
      ]);
    }, 1500);
    return () => {
      if (autoSendRef.current) window.clearInterval(autoSendRef.current);
    };
  }, [autoSend]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    listRef.current?.data.append(
      [{ id: nextId(), text, author: 'me', ts: Date.now() }],
      { behavior: 'smooth' },
    );
    setDraft('');
  };

  const loadOlder = async () => {
    if (historyLoading) return;
    setHistoryLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    const baseTs = oldestTsRef.current;
    const older = makeBatch(20, baseTs);
    oldestTsRef.current = baseTs - 20 * 30_000;
    listRef.current?.data.prepend(older);
    setHistoryLoading(false);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <div className="app-avatar" aria-hidden>
            #
          </div>
          <div>
            <div className="app-channel">#general</div>
            <div className="app-subtitle">
              ChatMessageList demo · react-virtuoso (MIT)
            </div>
          </div>
        </div>
        <label className="auto-toggle">
          <input
            type="checkbox"
            checked={autoSend}
            onChange={(e) => setAutoSend(e.target.checked)}
          />
          simulate incoming
        </label>
      </header>

      <main className="chat-area">
        <ChatMessageList<Message>
          ref={listRef}
          computeItemKey={(m) => m.id}
          itemContent={(_, m) => <MessageBubble msg={m} />}
          onStartReached={loadOlder}
          Header={() =>
            historyLoading ? (
              <div className="history-loader">Loading older messages…</div>
            ) : (
              <div className="history-hint">
                Scroll to the top to load older messages
              </div>
            )
          }
        />
      </main>

      <footer className="composer">
        <input
          className="composer-input"
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          className="composer-send"
          onClick={handleSend}
          disabled={!draft.trim()}
        >
          Send
        </button>
      </footer>
    </div>
  );
}
