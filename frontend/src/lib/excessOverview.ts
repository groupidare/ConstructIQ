import type { ExcessWasteRecord } from "@/types/excess";

// The Excess page's Overview figures. The Excess report reads the same ones, so
// their numbers match.

function average(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function excessOverviewOf(records: ExcessWasteRecord[], projects: { id: number; name: string; status: string }[]) {
  const wasteRecords  = records.filter(e => !e.isReusable);
  const excessRecords = records.filter(e => e.isReusable);

  const totalWasteRate  = average(wasteRecords.map(e => e.excessPercent));
  const totalExcessRate = average(records.map(e => e.excessPercent));

  const reusableMaterialsCount = new Set(excessRecords.map(e => e.materialId)).size;

  const byProjectMap = new Map<number, { project: string; wasteRates: number[]; excessRates: number[] }>();

  // Completed projects always get a bar, even with 0% so far — they're the
  // ones with a final excess/waste story worth tracking to completion.
  for (const p of projects) {
    if (p.status === "Completed") byProjectMap.set(p.id, { project: p.name, wasteRates: [], excessRates: [] });
  }

  for (const e of records) {
    if (!byProjectMap.has(e.projectId)) byProjectMap.set(e.projectId, { project: e.projectName, wasteRates: [], excessRates: [] });
    const bucket = byProjectMap.get(e.projectId)!;
    (e.isReusable ? bucket.excessRates : bucket.wasteRates).push(e.excessPercent);
  }
  const chartData = Array.from(byProjectMap.values())
    .map(p => ({ project: p.project, wasteRate: average(p.wasteRates), excessRate: average(p.excessRates) }))
    .sort((a, b) => (b.wasteRate + b.excessRate) - (a.wasteRate + a.excessRate))
    .slice(0, 8);

  return { totalWasteRate, totalExcessRate, reusableMaterialsCount, chartData };
}
