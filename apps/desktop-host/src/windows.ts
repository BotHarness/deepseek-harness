/** Contributed desktop windows: plugins declare, the Electron shell owns and creates them. */

import { Service, type Context } from '@deepseek-ai/cordis'

/** One contributed window's declarative spec; the Electron shell validates and owns every field. */
export interface DesktopWindowSpec {
  /** Stable id inside the profile; the shell rejects a second window with the same id. */
  readonly id: string
  /** Client surface id; the window loads the Web application with `?dsh-surface=<surface>`. */
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

/** Correlated answer to one `window-open` request. */
export interface DesktopWindowOpenReply {
  readonly type: 'window-open-result'
  readonly requestId: number
  readonly windowId?: string
  readonly error?: string
}

/** Correlated answer to one `window-close` request. */
export interface DesktopWindowCloseReply {
  readonly type: 'window-close-result'
  readonly requestId: number
  readonly error?: string
}

/** Any correlated answer the shell sends for a window request. */
export type DesktopWindowReply = DesktopWindowOpenReply | DesktopWindowCloseReply

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopWindows: DesktopWindowsService
  }

  interface Events {
    /** A contributed window closed, whether the shell, the user, or Host teardown closed it. */
    'desktop-window/closed'(windowId: string): void
  }
}

/** Request deadline; the shell answers on its own event loop and a lost reply must not hang a plugin. */
const WINDOW_REQUEST_TIMEOUT_MS = 10_000

/**
 * Host half of the desktop window contribution seam.
 *
 * Plugins inject this service and `open()` a window; the Electron shell creates
 * and owns the real window, loads the Web application with the declared
 * `?dsh-surface=` id, and reports closures back as `desktop-window/closed`.
 */
export class DesktopWindowsService extends Service {
  private nextRequestId = 1
  private readonly pending = new Map<number, {
    resolve: (reply: DesktopWindowReply) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  /**
   * @param ctx - owning Cordis context.
   * @param config - private IPC sender to the Electron shell.
   */
  constructor(ctx: Context, private readonly config: { readonly send: (message: object) => Promise<void> }) {
    super(ctx, 'desktopWindows')
  }

  /**
   * Ask the shell to open one contributed window.
   * @param spec - declarative window spec.
   * @returns the shell-assigned window id.
   */
  async open(spec: DesktopWindowSpec): Promise<string> {
    const reply = await this.request({ type: 'window-open', spec })
    if (reply.type !== 'window-open-result') throw new Error('desktop window: shell answered a different request')
    if (reply.error !== undefined) throw new Error(reply.error)
    if (reply.windowId === undefined) throw new Error('desktop window: shell answered without a window id')
    return reply.windowId
  }

  /**
   * Ask the shell to close one contributed window.
   * @param windowId - id returned by {@link open}.
   */
  async close(windowId: string): Promise<void> {
    const reply = await this.request({ type: 'window-close', windowId })
    if (reply.type !== 'window-close-result') throw new Error('desktop window: shell answered a different request')
    if (reply.error !== undefined) throw new Error(reply.error)
  }

  /** Settle one correlated reply from the shell. */
  settle(reply: DesktopWindowReply): void {
    const pending = this.pending.get(reply.requestId)
    if (pending === undefined) return
    this.pending.delete(reply.requestId)
    clearTimeout(pending.timer)
    pending.resolve(reply)
  }

  /** Announce one shell-owned window closure. */
  closed(windowId: string): void {
    this.ctx.emit('desktop-window/closed', windowId)
  }

  private request(
    message: { readonly type: 'window-open'; readonly spec: DesktopWindowSpec } | { readonly type: 'window-close'; readonly windowId: string },
  ): Promise<DesktopWindowReply> {
    const requestId = this.nextRequestId++
    return new Promise<DesktopWindowReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`desktop window: the shell did not answer ${message.type} within ${String(WINDOW_REQUEST_TIMEOUT_MS)}ms`))
      }, WINDOW_REQUEST_TIMEOUT_MS)
      timer.unref()
      this.pending.set(requestId, { resolve, reject, timer })
      this.config.send({ ...message, requestId }).catch((error: unknown) => {
        const pending = this.pending.get(requestId)
        if (pending === undefined) return
        this.pending.delete(requestId)
        clearTimeout(pending.timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }
}

export default DesktopWindowsService
