import { app, session, type WebContents } from 'electron'

/**
 * Non-injection fingerprint alignment.
 *
 * Everything here is set through Electron configuration or CDP emulation —
 * no script is injected into the page. Only these signals can be aligned this
 * way; window.chrome, navigator.plugins and pdfViewerEnabled need script
 * shims and are intentionally left alone.
 */

const WINDOWS_PLATFORM = 'Win32'
const ACCEPT_LANGUAGE = 'zh-CN,zh,en'

function chromiumVersion(): string {
  return process.versions.chrome ?? '142.0.0.0'
}

function majorVersion(): string {
  return chromiumVersion().split('.')[0]
}

export function chromeUserAgent(): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion()}.0.0.0 Safari/537.36`
}

/** Call after app is ready, before windows are created. */
export function installGlobalUserAgent(): void {
  app.userAgentFallback = chromeUserAgent()
  session.defaultSession.setUserAgent(chromeUserAgent())
}

/**
 * Per-target Client Hints override. This makes navigator.userAgentData report
 * Google Chrome instead of only Chromium. CDP is a browser-level protocol;
 * the page cannot observe the session or tell that the values were overridden.
 */
export async function applyClientHints(wc: WebContents): Promise<void> {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    const full = chromiumVersion()
    const major = majorVersion()
    await wc.debugger.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: chromeUserAgent(),
      acceptLanguage: ACCEPT_LANGUAGE,
      platform: WINDOWS_PLATFORM,
      userAgentMetadata: {
        brands: [
          { brand: 'Chromium', version: major },
          { brand: 'Google Chrome', version: major },
          { brand: 'Not_A Brand', version: '24' }
        ],
        fullVersionList: [
          { brand: 'Chromium', version: full },
          { brand: 'Google Chrome', version: full },
          { brand: 'Not_A Brand', version: '24.0.0.0' }
        ],
        fullVersion: full,
        platform: 'Windows',
        platformVersion: '15.0.0',
        architecture: 'x86',
        model: '',
        mobile: false,
        bitness: '64',
        wow64: false
      }
    })
  } catch {
    // Best effort: leave Chromium defaults if the target is gone.
  }
}
