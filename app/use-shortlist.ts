"use client";
import { useEffect, useState } from "react";
import { FAVORITES_KEY, FAVORITES_LIMIT, COMPARE_LIMIT, parseFavoriteIds, toggleId } from "../lib/shortlist.mjs";
export function useShortlist() {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  useEffect(() => {
    try { setFavorites(parseFavoriteIds(window.localStorage.getItem(FAVORITES_KEY))); }
    catch { setStorageWarning("브라우저 저장소를 사용할 수 없어 관심 단지는 이번 방문 동안만 유지됩니다."); }
    setStorageReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === FAVORITES_KEY || event.key === null) setFavorites(parseFavoriteIds(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function toggleFavorite(id: string) {
    if (!storageReady) return;
    const next = toggleId(favorites, id, FAVORITES_LIMIT);
    if (next === favorites) {
      setStorageWarning("관심 단지는 최대 200개까지 저장할 수 있습니다.");
      return;
    }
    setFavorites(next);
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      setStorageWarning("");
    } catch { setStorageWarning("관심 단지 저장에 실패했습니다. 이번 방문 동안만 유지됩니다."); }
  }
  function toggleCompare(id: string) { setCompareIds(current => toggleId(current, id, COMPARE_LIMIT)); }
  return {favorites, compareIds, toggleFavorite, toggleCompare, clearCompare: () => setCompareIds([]), storageReady, storageWarning};
}
