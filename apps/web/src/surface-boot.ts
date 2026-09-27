/** Surface-window boot: keep only the client entries a contributed window's surface needs. */

import type { applyIndexInjections } from '@deepseek-ai/dsh-client-web'

/** One structured index row, as the webserver defines it. */
type IndexInjection = Parameters<typeof applyIndexInjections>[0][number]

interface SurfaceBootEntry {
  id: string
  url: string
  rev: string
  inject?: string[]
  immediately?: boolean
  external?: string[]
}

interface SurfaceBootBatch {
  phase: 'bootstrap' | 'application'
  url: string
  rev: string
  entries: string[]
}

interface SurfaceBootGraph {
  rev: string
  entries: SurfaceBootEntry[]
  batches: SurfaceBootBatch[]
}

/** Entries every surface window boots: the module system itself. */
const SURFACE_BOOTSTRAP_ENTRIES = ['@deepseek-ai/dsh-client-modules']

/**
 * Rewrite the injected boot graph so a contributed window activates only its
 * surface plugin and that plugin's package-name dependency closure.
 *
 * The initial combos keep their advertised URLs (the module server serves
 * exact resources), so a filtered batch still loads its script while naming
 * only the entries this window keeps. A later server-side surface composition
 * can shrink the downloads too; this keeps the activation boundary real.
 *
 * @param injections - index injections reported by the Host.
 * @param surfaceId - the surface's client package name.
 * @returns injections whose boot graph keeps the closure.
 */
export function filterSurfaceInjections(injections: readonly IndexInjection[], surfaceId: string): readonly IndexInjection[] {
  return injections.map((row): IndexInjection => {
    if (row.kind !== 'global' || row.name !== '__DSH_BOOT__') return row
    const graph = row.value as SurfaceBootGraph | null
    if (graph === null || typeof graph !== 'object' || !Array.isArray(graph.entries) || !Array.isArray(graph.batches)) return row
    const byId = new Map(graph.entries.map(entry => [entry.id, entry]))
    const keep = new Set<string>(SURFACE_BOOTSTRAP_ENTRIES)
    if (byId.has(surfaceId)) keep.add(surfaceId)
    const queue = [...keep]
    while (queue.length > 0) {
      const entry = byId.get(queue.pop() as string)
      for (const dependency of entry?.inject ?? []) {
        if (!keep.has(dependency) && byId.has(dependency)) {
          keep.add(dependency)
          queue.push(dependency)
        }
      }
    }
    const entries = graph.entries.filter(entry => keep.has(entry.id))
    const batches = graph.batches
      .map(batch => ({ ...batch, entries: batch.entries.filter(id => keep.has(id)) }))
      .filter(batch => batch.entries.length > 0)
    return { kind: 'global', name: '__DSH_BOOT__', value: { ...graph, entries, batches } }
  })
}
