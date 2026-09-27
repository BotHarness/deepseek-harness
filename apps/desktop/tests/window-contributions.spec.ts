import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const windows: FakeWindow[] = []
  class FakeWindow extends EventEmitter {
    destroyed = false
    readonly loads: string[] = []
    readonly setAlwaysOnTop = vi.fn()
    readonly setVisibleOnAllWorkspaces = vi.fn()
    readonly setIgnoreMouseEvents = vi.fn()
    readonly showInactive = vi.fn()
    readonly webContents = { id: 0, setWindowOpenHandler: vi.fn() }
    constructor(readonly options: Record<string, unknown>) {
      super()
      this.webContents.id = windows.length + 1
      windows.push(this)
    }
    isDestroyed() { return this.destroyed }
    loadURL(url: string) { this.loads.push(url); return Promise.resolve() }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  return {
    windows,
    FakeWindow,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
    shell: { openExternal: vi.fn() },
  }
})

vi.mock('electron', () => ({ BrowserWindow: harness.FakeWindow, screen: harness.screen, shell: harness.shell }))

const { DesktopWindowContributions } = await import('../src/window-contributions.ts')

type FakeWindow = InstanceType<typeof harness.FakeWindow>

const spec = { id: 'companion-window', surface: 'dsh-companion-example', width: 260, height: 200, anchor: 'bottom-right' as const, margin: [24, 24] as const }

let closed: string[]
let contributions: InstanceType<typeof DesktopWindowContributions>

beforeEach(() => {
  harness.windows.length = 0
  closed = []
  contributions = new DesktopWindowContributions('/tmp/preload-surface.cjs', 'dsh-app://app/', (id) => { closed.push(id) })
})

afterEach(() => { vi.clearAllMocks() })

describe('desktop window contributions', () => {
  it('creates a transparent always-on-top window anchored to the work area', () => {
    expect(contributions.open(spec)).toBe('companion-window')
    const window = harness.windows[0] as FakeWindow
    expect(window.options).toMatchObject({
      x: 1440 - 260 - 24,
      y: 900 - 200 - 24,
      width: 260,
      height: 200,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      show: false,
      skipTaskbar: true,
    })
    const preferences = window.options.webPreferences as Record<string, unknown>
    expect(preferences.preload).toBe('/tmp/preload-surface.cjs')
    expect(preferences.additionalArguments).toEqual(['--dsh-surface=dsh-companion-example'])
    expect(window.loads).toEqual(['dsh-app://app/?dsh-surface=dsh-companion-example'])
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    expect(contributions.ownsWebContents(window.webContents.id)).toBe(true)
  })

  it('honours click-through and rejects duplicates', () => {
    contributions.open({ ...spec, clickThrough: true })
    const window = harness.windows[0] as FakeWindow
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
    expect(() => contributions.open(spec)).toThrow('already open')
  })

  it('answers open and close requests and reports closures', () => {
    const replies: Record<string, unknown>[] = []
    contributions.handleHostMessage({ type: 'window-open', requestId: 7, spec }, (reply) => { replies.push(reply as Record<string, unknown>) })
    expect(replies[0]).toEqual({ type: 'window-open-result', requestId: 7, windowId: 'companion-window' })
    contributions.handleHostMessage({ type: 'window-close', requestId: 8, windowId: 'companion-window' }, (reply) => { replies.push(reply as Record<string, unknown>) })
    expect(replies[1]).toEqual({ type: 'window-close-result', requestId: 8 })
    expect(closed).toEqual(['companion-window'])
    expect(contributions.ownsWebContents(1)).toBe(false)
  })

  it('answers a refusal instead of throwing for an invalid spec', () => {
    const replies: Record<string, unknown>[] = []
    contributions.handleHostMessage({ type: 'window-open', requestId: 9, spec: { id: 'BAD ID' } }, (reply) => { replies.push(reply as Record<string, unknown>) })
    expect(replies[0]).toMatchObject({ type: 'window-open-result', requestId: 9 })
    expect(String(replies[0]?.error)).toContain('lowercase slug')
  })

  it('destroys every contributed window on closeAll', () => {
    contributions.open(spec)
    contributions.open({ ...spec, id: 'second-window' })
    contributions.closeAll()
    expect(harness.windows.every(window => window.destroyed)).toBe(true)
    expect(contributions.ownsWebContents(1)).toBe(false)
  })
})
