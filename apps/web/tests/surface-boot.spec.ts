import { describe, expect, it } from 'vitest'
import { filterSurfaceInjections } from '../src/surface-boot.ts'

const graph = {
  rev: 'r1',
  entries: [
    { id: '@deepseek-ai/dsh-client-modules', url: 'plugins/??modules/client.js&rev=1', rev: '1', immediately: true },
    { id: 'dsh-companion-example', url: 'plugins/??ab/client.js&rev=2', rev: '2', inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-connection'] },
    { id: '@deepseek-ai/dsh-client-ui-renderer', url: 'plugins/??ab/client.js&rev=2', rev: '2' },
    { id: '@deepseek-ai/dsh-client-connection', url: 'plugins/??ab/client.js&rev=2', rev: '2' },
    { id: '@deepseek-ai/dsh-client-ui-layout', url: 'plugins/??c/client.js&rev=3', rev: '3', inject: ['@deepseek-ai/dsh-client-shortcuts'] },
  ],
  batches: [
    { phase: 'bootstrap', url: 'plugins/??modules/client.js&rev=1', rev: '1', entries: ['@deepseek-ai/dsh-client-modules'] },
    { phase: 'application', url: 'plugins/??ab/client.js&rev=2', rev: '2', entries: ['dsh-companion-example', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-connection'] },
    { phase: 'application', url: 'plugins/??c/client.js&rev=3', rev: '3', entries: ['@deepseek-ai/dsh-client-ui-layout'] },
  ],
}

const injections = [
  { kind: 'global' as const, name: '__DSH_BOOT__', value: graph },
  { kind: 'script' as const, placement: 'head' as const, text: 'x' },
]

describe('surface boot filtering', () => {
  it('keeps the surface package, its dependency closure, and the bootstrap', () => {
    const filtered = filterSurfaceInjections(injections, 'dsh-companion-example')
    const boot = filtered[0] as { value: typeof graph }
    expect(boot.value.entries.map(entry => entry.id)).toEqual([
      '@deepseek-ai/dsh-client-modules',
      'dsh-companion-example',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-connection',
    ])
    expect(boot.value.batches.map(batch => batch.entries)).toEqual([
      ['@deepseek-ai/dsh-client-modules'],
      ['dsh-companion-example', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-connection'],
    ])
    expect(filtered[1]).toEqual(injections[1])
  })

  it('keeps only the bootstrap when the surface package is absent', () => {
    const filtered = filterSurfaceInjections(injections, 'not-installed')
    const boot = filtered[0] as { value: typeof graph }
    expect(boot.value.entries.map(entry => entry.id)).toEqual(['@deepseek-ai/dsh-client-modules'])
    expect(boot.value.batches).toHaveLength(1)
  })

  it('leaves injections without a boot graph untouched', () => {
    const rows = [{ kind: 'script' as const, placement: 'body' as const, text: 'y' }]
    expect(filterSurfaceInjections(rows, 'dsh-companion-example')).toEqual(rows)
  })
})
