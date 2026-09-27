/** Surface-window preload: boot readiness and the declared surface id, nothing else. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, SCHEME } from './ipc.ts'
import { markDocumentPlatform, syncWindowFullscreen } from './preload-platform.ts'
import { syncNativeTheme } from './preload-theme.ts'

/** Reads the `--dsh-surface=` argument the shell passes to a contributed window. */
function surfaceId(): string {
  const prefix = '--dsh-surface='
  const argument = process.argv.find(value => value.startsWith(prefix))
  return argument === undefined ? '' : argument.slice(prefix.length)
}

if (location.protocol === `${SCHEME}:` && location.hostname === 'app' && process.isMainFrame) {
  contextBridge.exposeInMainWorld('dshSurface', { id: surfaceId() })
  // The Web application boots through the same readiness call in every Desktop window.
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke(DESKTOP_IPC.boot) as Promise<unknown>,
    failed: (message: string) => ipcRenderer.invoke(DESKTOP_IPC.bootFailed, message) as Promise<void>,
  })
}

markDocumentPlatform()
syncWindowFullscreen()
syncNativeTheme()
