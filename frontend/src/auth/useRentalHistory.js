import { useCallback, useEffect, useState } from "react";
import { useCursorPage } from "../hooks/useCursorPage.js";
import { getMyRentalCounts, listMyRentals } from "../services/rentalService.js";
import { serviceError } from "../services/rentalDates.js";

export default function useRentalHistory({ activeOnly = false, withCounts = false } = {}) {
  const load = useCallback((cursor) => listMyRentals({ cursor, activeOnly }), [activeOnly]);
  const page = useCursorPage(load, activeOnly);
  const [counts, setCounts] = useState(null);
  const [countError, setCountError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!withCounts) return;
    let active = true;
    getMyRentalCounts().then((data) => {
      if (active) {
        setCounts(data);
        setCountError("");
      }
    }).catch((error) => {
      if (active) {
        setCounts(null);
        setCountError(serviceError(error, "대여 건수를 불러오지 못했습니다."));
      }
    });
    return () => { active = false; };
  }, [revision, withCounts]);

  const refresh = () => {
    page.reload();
    setRevision((current) => current + 1);
  };
  return { ...page, rentals: page.items, counts, countError, refresh };
}
