/** Electron-owned windows contributed by Host plugins through the desktop window service. */

import { BrowserWindow, screen, shell } from 'electron'
import type { DesktopWindowRequest } from './host-process.ts'

/** One contributed window's declarative spec, validated here before any BrowserWindow exists. */
export interface DesktopWindowSpec {
  readonly id: string
  readonly surface: string
  readonly width: number
  readonly height: number
  readonly anchor?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  readonly margin?: readonly [number, number]
  readonly alwaysOnTop?: boolean
  readonly transparent?: boolean
  readonly clickThrough?: boolean
  readonly skipTaskbar?: boolean
  readonly resizable?: boolean
}

/** One profile never needs more floating surfaces than this; a runaway plugin must not open windows forever. */
const MAX_CONTRIBUTED_WINDOWS = 8
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

/**
 * Owns every contributed window: creation, placement, input mode, and teardown.
 *
 * The Host declares; the shell creates. Renderers never receive Electron APIs,
 * and a contributed window keeps the same sandbox, preload isolation, and Host
 * cookie forwarding as the main window.
 */
export class DesktopWindowContributions {
  private readonly windows = new Map<string, BrowserWindow>()

  /**
   * @param preload - dedicated surface preload path.
   * @param applicationUrl - the shell's application document URL.
   * @param notifyClosed - reports a window closure back to the Host.
   */
  constructor(
    private readonly preload: string,
    private readonly applicationUrl: string,
    private readonly notifyClosed: (windowId: string) => void,
  ) {}

  /**
   * Open one contributed window.
   * @param spec - validated declarative spec.
   * @returns the window id (the spec id).
   */
  open(spec: DesktopWindowSpec): string {
    if (this.windows.has(spec.id)) throw new Error(`desktop window: "${spec.id}" is already open`)
    if (this.windows.size >= MAX_CONTRIBUTED_WINDOWS) throw new Error('desktop window: too many contributed windows')
    const bounds = this.place(spec)
    const window = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: spec.transparent ?? true,
      resizable: spec.resizable ?? false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: spec.skipTaskbar ?? true,
      hasShadow: false,
      alwaysOnTop: spec.alwaysOnTop ?? true,
      acceptFirstMouse: true,
      webPreferences: {
        preload: this.preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        devTools: true,
        additionalArguments: [`--dsh-surface=${spec.surface}`],
      },
    })
    this.windows.set(spec.id, window)
    if (spec.alwaysOnTop ?? true) window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    if (spec.clickThrough === true) window.setIgnoreMouseEvents(true, { forward: true })
    window.once('ready-to-show', () => { if (!window.isDestroyed()) window.showInactive() })
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (['http:', 'https:'].includes(new URL(url).protocol)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    window.on('closed', () => {
      this.windows.delete(spec.id)
      this.notifyClosed(spec.id)
    })
    void window.loadURL(`${this.applicationUrl}?dsh-surface=${encodeURIComponent(spec.surface)}`)
    return spec.id
  }

  /**
   * Close one contributed window.
   * @param windowId - id returned by {@link open}.
   * @returns whether a live window was closed.
   */
  close(windowId: string): boolean {
    const window = this.windows.get(windowId)
    if (window === undefined) return false
    this.windows.delete(windowId)
    if (!window.isDestroyed()) window.destroy()
    return true
  }

  /**
   * Whether one WebContents belongs to a contributed window.
   * @param webContentsId - the id carried by a WebSocket handshake.
   */
  ownsWebContents(webContentsId: number): boolean {
    for (const window of this.windows.values()) {
      if (!window.isDestroyed() && window.webContents.id === webContentsId) return true
    }
    return false
  }

  /** Destroy every contributed window during quit. */
  closeAll(): void {
    for (const window of [...this.windows.values()]) {
      if (!window.isDestroyed()) window.destroy()
    }
    this.windows.clear()
  }

  /**
   * Route one Host request; the Host service correlates the reply.
   * @param request - a `window-open` or `window-close` request.
   * @param respond - sends the correlated reply back over the private IPC channel.
   */
  handleHostMessage(request: DesktopWindowRequest, respond: (reply: object) => void): void {
    try {
      if (request.type === 'window-open') {
        respond({ type: 'window-open-result', requestId: request.requestId, windowId: this.open(validateSpec(request.spec)) })
      } else {
        this.close(request.windowId)
        respond({ type: 'window-close-result', requestId: request.requestId })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (request.type === 'window-open') respond({ type: 'window-open-result', requestId: request.requestId, error: message })
      else respond({ type: 'window-close-result', requestId: request.requestId, error: message })
    }
  }

  private place(spec: DesktopWindowSpec): { x: number; y: number; width: number; height: number } {
    const { workArea } = screen.getPrimaryDisplay()
    const margin = spec.margin ?? [24, 24]
    const right = workArea.x + workArea.width - spec.width - margin[0]
    const bottom = workArea.y + workArea.height - spec.height - margin[1]
    switch (spec.anchor ?? 'bottom-right') {
      case 'top-left':
        return { x: workArea.x + margin[0], y: workArea.y + margin[1], width: spec.width, height: spec.height }
      case 'top-right':
        return { x: right, y: workArea.y + margin[1], width: spec.width, height: spec.height }
      case 'bottom-left':
        return { x: workArea.x + margin[0], y: bottom, width: spec.width, height: spec.height }
      default:
        return { x: right, y: bottom, width: spec.width, height: spec.height }
    }
  }
}

function validateSpec(input: unknown): DesktopWindowSpec {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('desktop window: spec must be an object')
  const record = input as Record<string, unknown>
  const id = record.id
  const surface = record.surface
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('desktop window: id must be a lowercase slug')
  if (typeof surface !== 'string' || !ID_PATTERN.test(surface)) throw new Error('desktop window: surface must be a lowercase slug')
  const width = record.width
  const height = record.height
  if (!Number.isSafeInteger(width) || (width as number) < 1 || (width as number) > 4096) throw new Error('desktop window: width must be an integer from 1 through 4096')
  if (!Number.isSafeInteger(height) || (height as number) < 1 || (height as number) > 4096) throw new Error('desktop window: height must be an integer from 1 through 4096')
  const anchor = record.anchor
  if (anchor !== undefined && !ANCHORS.includes(anchor as typeof ANCHORS[number])) throw new Error('desktop window: anchor is unknown')
  const margin = record.margin
  if (margin !== undefined && (!Array.isArray(margin) || margin.length !== 2
    || margin.some(value => !Number.isSafeInteger(value) || value < 0 || value > 1024))) {
    throw new Error('desktop window: margin must be two integers from 0 through 1024')
  }
  for (const flag of ['alwaysOnTop', 'transparent', 'clickThrough', 'skipTaskbar', 'resizable'] as const) {
    if (record[flag] !== undefined && typeof record[flag] !== 'boolean') throw new Error(`desktop window: ${flag} must be boolean`)
  }
  const spec: Mutable<DesktopWindowSpec> = { id, surface, width: width as number, height: height as number }
  if (anchor !== undefined) spec.anchor = anchor as NonNullable<DesktopWindowSpec['anchor']>
  if (margin !== undefined) spec.margin = margin as [number, number]
  for (const flag of ['alwaysOnTop', 'transparent', 'clickThrough', 'skipTaskbar', 'resizable'] as const) {
    const value = record[flag]
    if (value !== undefined) spec[flag] = value as boolean
  }
  return spec
}

/** Strips `readonly` so validated fields can be assigned one by one. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }
