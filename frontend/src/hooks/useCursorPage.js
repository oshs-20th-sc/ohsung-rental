import { useEffect, useRef, useState } from "react";
import { serviceError } from "../services/rentalDates.js";

const firstPage = [null];
const cacheLifetime = 15000;
const cacheSize = 6;

export function useCursorPage(load, key) {
  const [navigation, setNavigation] = useState({ key, cursors: firstPage, index: 0, revision: 0 });
  const [response, setResponse] = useState(null);
  const cacheRef = useRef(null);
  const { cursors, index, revision } = navigation.key === key
    ? navigation
    : { cursors: firstPage, index: 0, revision: navigation.revision };
  const cursor = cursors[index];

  useEffect(() => {
    setNavigation((previous) => previous.key === key ? previous : {
      key, cursors: firstPage, index: 0, revision: previous.revision,
    });
  }, [key]);

  useEffect(() => {
    // Each mounted route belongs to one session. A filter, loader, or revision change discards its pages.
    if (cacheRef.current?.key !== key || cacheRef.current?.load !== load || cacheRef.current?.revision !== revision) {
      cacheRef.current = { key, load, revision, pages: new Map() };
    }
    const { pages } = cacheRef.current;
    const cached = pages.get(cursor);
    pages.delete(cursor);
    if (cached && performance.now() - cached.receivedAt < cacheLifetime) {
      pages.set(cursor, cached);
      setResponse(cached);
      return;
    }

    let active = true;
    load(cursor).then((result) => {
      if (!active) return;
      const page = { key, cursor, revision, load, result, receivedAt: performance.now() };
      if (pages.size >= cacheSize) pages.delete(pages.keys().next().value);
      pages.set(cursor, page);
      setResponse(page);
    }).catch((error) => {
      if (active) setResponse({ key, cursor, revision, load, error: serviceError(error, "목록을 불러오지 못했습니다.") });
    });
    return () => { active = false; };
  }, [cursor, key, load, revision]);

  const current = response?.key === key && response.cursor === cursor &&
    response.revision === revision && response.load === load ? response : null;
  const nextCursor = current?.result?.nextCursor;
  const next = () => {
    if (nextCursor) setNavigation({ key, cursors: [...cursors.slice(0, index + 1), nextCursor], index: index + 1, revision });
  };

  const previous = () => {
    if (index > 0) setNavigation({ key, cursors, index: index - 1, revision });
  };

  const reload = ({ moveBack = false } = {}) => setNavigation((current) => ({
    ...current,
    index: moveBack && current.key === key && current.index === index ? Math.max(0, index - 1) : current.index,
    revision: current.revision + 1,
  }));
  const reset = () => setNavigation((current) => ({
    ...current,
    cursors: firstPage,
    index: 0,
    revision: current.revision + 1,
  }));

  return {
    items: current?.result?.items ?? [],
    error: current?.error ?? "",
    loading: !current,
    page: index + 1,
    hasNext: Boolean(nextCursor),
    next, previous, reload, reset,
  };
}
