import React, { useCallback, useRef, useState } from 'react';
import { AnnouncerContext, type AnnouncePriority } from './useAnnouncer';

type Announcement = {
  id: number;
  message: string;
  priority: AnnouncePriority;
};

export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const idRef = useRef(0);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const announce = useCallback((message: string, priority: AnnouncePriority = 'polite') => {
    const id = idRef.current++;
    setAnnouncements((prev) => [...prev, { id, message, priority }]);
    const timeout = setTimeout(() => {
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      timeoutsRef.current.delete(timeout);
    }, 1000);
    timeoutsRef.current.add(timeout);
  }, []);

  return (
    <AnnouncerContext.Provider value={{ announce }}>
      {children}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcements.filter((a) => a.priority === 'polite').map((a) => (
          <span key={a.id}>{a.message}</span>
        ))}
      </div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {announcements.filter((a) => a.priority === 'assertive').map((a) => (
          <span key={a.id}>{a.message}</span>
        ))}
      </div>
    </AnnouncerContext.Provider>
  );
}
