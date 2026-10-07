/** Restores the Customer Service API's seed data (see ui/server/demoReset.js). */
export async function resetDemoData(): Promise<{ ok: boolean; results?: { name: string; ok: boolean; status: number; error?: string }[] }> {
  const res = await fetch('/api/demo/reset', { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.ok !== false, results: body.results };
}
