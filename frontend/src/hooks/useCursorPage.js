import { useEffect, useState } from "react";
import { serviceError } from "../services/rentalDates.js";

const firstPage = [null];

export function useCursorPage(load, key) {
  const [navigation, setNavigation] = useState({ key, cursors: firstPage, index: 0, revision: 0 });
  const [response, setResponse] = useState(null);
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
    let active = true;
    load(cursor).then((result) => {
      if (active) setResponse({ key, cursor, revision, load, result });
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

  const reload = () => setNavigation({ key, cursors, index, revision: revision + 1 });
  const reset = () => setNavigation({ key, cursors: firstPage, index: 0, revision: revision + 1 });

  return {
    items: current?.result?.items ?? [],
    error: current?.error ?? "",
    loading: !current,
    page: index + 1,
    hasNext: Boolean(nextCursor),
    next, previous, reload, reset,
  };
}
