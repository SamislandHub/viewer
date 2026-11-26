// Home is a persistent tab: never navigate it away. All links open new tabs.
for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
  link.addEventListener('click', e => {
    e.preventDefault()
    const href = link.getAttribute('href')
    if (!href) return
    if (href === 'viewer://settings') {
      void window.api.settingsOpen()
    } else if (href.startsWith('viewer://')) {
      void window.api.internalOpen(href)
    } else {
      // External links open in a new tab via window.open (handled as a tab).
      window.open(href, '_blank')
    }
  })
}
