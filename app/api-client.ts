declare const __GITHUB_PAGES__: boolean;

/** Keep the existing server build intact; Pages never requests a server API. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (typeof __GITHUB_PAGES__ !== "undefined" && __GITHUB_PAGES__) {
    const { staticApi } = await import("../pages/static-api");
    return staticApi(path, init);
  }
  return fetch(path, init);
}
