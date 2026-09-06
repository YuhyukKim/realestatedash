type RuntimeGlobal = typeof globalThis & {
  __JAYDEN_RESEARCH_D1__?: D1Database;
};

/**
 * The worker entry receives bindings on every request. Keeping the current D1
 * binding on the isolate global lets route modules work in both Cloudflare and
 * the Node-based production-bundle tests without importing a cloudflare: URL.
 */
export function setRuntimeD1(binding: D1Database | undefined) {
  const runtime = globalThis as RuntimeGlobal;
  if (binding) runtime.__JAYDEN_RESEARCH_D1__ = binding;
  else delete runtime.__JAYDEN_RESEARCH_D1__;
}

export function getRuntimeD1() {
  return (globalThis as RuntimeGlobal).__JAYDEN_RESEARCH_D1__ ?? null;
}
