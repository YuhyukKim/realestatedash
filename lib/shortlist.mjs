export const FAVORITES_KEY = "naejibeodi.favorites.v1";
export const FAVORITES_LIMIT = 200;
export const COMPARE_LIMIT = 3;
export function parseFavoriteIds(raw) {
  try {
    if (typeof raw !== "string" || raw.length > 40000) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(id => typeof id === "string" && id.length > 0 && id.length <= 160 && id.trim() === id))].slice(0, FAVORITES_LIMIT);
  } catch { return []; }
}
export function toggleId(ids, id, limit) {
  if (ids.includes(id)) return ids.filter(value => value !== id);
  return ids.length >= limit ? ids : [...ids, id];
}
