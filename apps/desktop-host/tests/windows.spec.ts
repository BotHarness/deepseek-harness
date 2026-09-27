import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DesktopWindowsService, type DesktopWindowReply } from '../src/windows.ts'

let ctx: Context
let sent: Record<string, unknown>[]
let service: DesktopWindowsService

const spec = { id: 'companion-window', surface: 'dsh-companion-example', width: 260, height: 200 }

beforeEach(() => {
  ctx = new Context()
  sent = []
  service = new DesktopWindowsService(ctx, { send: async (message) => { sent.push(message as Record<string, unknown>) } })
})

afterEach(async () => { await ctx.fiber.dispose() })

function replyFor(requestId: unknown): DesktopWindowReply {
  return { type: 'window-open-result', requestId: requestId as number, windowId: 'companion-window' }
}

describe('desktop window service', () => {
  it('sends one correlated open request and resolves the shell window id', async () => {
    const opening = service.open(spec)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'window-open', spec })
    const requestId = sent[0]?.requestId
    expect(Number.isSafeInteger(requestId)).toBe(true)
    service.settle(replyFor(requestId))
    await expect(opening).resolves.toBe('companion-window')
  })

  it('rejects a shell refusal with its message', async () => {
    const opening = service.open(spec)
    service.settle({ type: 'window-open-result', requestId: sent[0]?.requestId as number, error: 'desktop window: too many contributed windows' })
    await expect(opening).rejects.toThrow('too many contributed windows')
  })

  it('rejects a reply without a window id', async () => {
    const opening = service.open(spec)
    service.settle({ type: 'window-open-result', requestId: sent[0]?.requestId as number })
    await expect(opening).rejects.toThrow('without a window id')
  })

  it('correlates close requests and ignores unknown replies', async () => {
    const closing = service.close('companion-window')
    expect(sent[0]).toMatchObject({ type: 'window-close', windowId: 'companion-window' })
    service.settle({ type: 'window-close-result', requestId: 999_999 })
    service.settle({ type: 'window-close-result', requestId: sent[0]?.requestId as number })
    await expect(closing).resolves.toBeUndefined()
  })

  it('announces a shell-side closure as a Cordis event', async () => {
    const closed: string[] = []
    ctx.on('desktop-window/closed', (id) => { closed.push(id) })
    service.closed('companion-window')
    expect(closed).toEqual(['companion-window'])
  })
})
