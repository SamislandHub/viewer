import { BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { join } from 'node:path'
import type { Point, Rect } from '@shared/types'
import { FileChooserBridge, type FileChooserRequest } from './dialog-bridge'

/** Layout of the shell window; tabs are vertical on the left, toolbar is one row. */
export const TITLEBAR_HEIGHT = 48
export const LEFT_PANEL_WIDTH = 210
export const RIGHT_PANEL_WIDTH = 300

export interface TabInfo {
  id: number
  title: string
  url: string
  loading: boolean
}

/** Lightweight new-tab page so the middle slot never appears black. */
const NEW_TAB_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#ffffff;font-family:ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif}
  .box{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#adb5bd;gap:8px}
  .box b{font-size:22px;color:#868e96;font-weight:500}
  .box span{font-size:12px}
</style></head><body><div class="box"><b>新标签页</b><span>在上方输入网址或搜索内容开始浏览</span></div></body></html>`)

/** Transparent overlay view: virtual cursor + in-app file picker, one layer. */
const CURSOR_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;
    font:13px/1.6 ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif;color:#212529}
  #cursor{position:absolute;left:0;top:0;width:16px;height:21px;pointer-events:none;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.55))}
  #cursor::before{content:"";position:absolute;inset:0;background:#ff9500;
    clip-path:polygon(0 0,0 82%,22% 62%,38% 100%,52% 94%,36% 57%,68% 55%)}
  #overlay{position:absolute;inset:0;background:rgba(15,20,30,.45);display:none;
    align-items:center;justify-content:center}
  .card{width:460px;max-width:90vw;background:#fff;border-radius:12px;padding:20px;
    box-shadow:0 18px 50px rgba(0,0,0,.3)}
  .title{font-size:15px;font-weight:600;margin-bottom:6px}
  .hint{font-size:12px;color:#868e96;margin-bottom:12px}
  .row{display:flex;gap:6px;margin-bottom:8px}
  .row input{flex:1;min-width:0;padding:6px 8px;border:1px solid #cbd2dd;border-radius:6px}
  button{padding:6px 10px;border:1px solid #cbd2dd;background:#fff;border-radius:6px;cursor:pointer}
  button:hover{background:#f1f3f5}
  button.primary{background:#4263eb;color:#fff;border-color:#4263eb}
  button.icon{width:28px;padding:0;font-size:13px}
  button:disabled{opacity:.4;cursor:not-allowed}
  button.primary:disabled{background:#a5b4fc;border-color:#a5b4fc}
  .list{height:220px;overflow:auto;border:1px solid #e3e7ee;border-radius:6px;padding:5px}
  .entry{display:flex;gap:7px;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:12px}
  .entry:hover{background:#f1f3f5}
  .entry.selected{background:#e7f1ff}
  .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
</style></head><body>
<div id="cursor"></div>
<div id="overlay">
  <div class="card">
    <div class="title">选择文件</div>
    <div id="hint" class="hint"></div>
    <div class="row">
      <button id="drives" class="icon" title="磁盘">□</button>
      <button id="up" class="icon" title="上一级">↑</button>
      <input id="dir" type="text" value="F:\\AI\\AIbrowser\\test" placeholder="输入路径后回车" />
    </div>
    <div id="list" class="list"></div>
    <div class="actions">
      <button id="cancel">取消</button>
      <button id="ok" class="primary" disabled>确定</button>
    </div>
  </div>
</div>
<script>
  const $=id=>document.getElementById(id);
  const c=$('cursor');
  window.api.onCursorVisible(v=>{ c.style.opacity=v?'1':'0'; });
  let pending=null, selected=[], entries=[], lastIndex=-1;
  const BS=String.fromCharCode(92);
  const MIME={
    'image':['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.avif','.ico'],
    'audio':['.mp3','.wav','.ogg','.m4a','.flac','.aac'],
    'video':['.mp4','.webm','.ogg','.mov','.avi','.mkv'],
    'text':['.txt','.md','.csv','.html','.css','.js','.json','.xml','.log'],
    'application/pdf':['.pdf'],
    'application/zip':['.zip','.rar','.7z','.tar','.gz']
  };
  function accepted(name,accept){
    if(!accept || !accept.length) return true;
    const n=name.toLowerCase();
    for(const raw of accept){
      const a=String(raw).trim().toLowerCase();
      if(!a) continue;
      if(a.startsWith('.')){ if(n.endsWith(a)) return true; continue }
      if(a.endsWith('/*')){
        const types=MIME[a.slice(0,-2)]||[];
        if(types.some(x=>n.endsWith(x))) return true;
        continue;
      }
      const types=MIME[a]||[];
      if(types.some(x=>n.endsWith(x))) return true;
    }
    return false;
  }
  function visibleEntries(){
    return entries.filter(e=>{
      if(pending && pending.directory) return e.isDirectory;
      return e.isDirectory || accepted(e.name, pending && pending.accept);
    });
  }
  function choose(entry,index,event){
    const multi=pending && (pending.multiple||pending.mode==='multiple'||pending.directory);
    const path=entry.path;
    if(event.ctrlKey||event.metaKey){
      selected=selected.includes(path)?selected.filter(p=>p!==path):[...selected,path];
    }else if(event.shiftKey && lastIndex>=0){
      const list=visibleEntries();
      const from=Math.min(lastIndex,index), to=Math.max(lastIndex,index);
      selected=list.slice(from,to+1).map(e=>e.path);
    }else{
      selected=[path];
    }
    lastIndex=index;
    render();
  }
  function render(){
    $('list').innerHTML='';
    const list=visibleEntries();
    for(let i=0;i<list.length;i++){
      const e=list[i];
      const row=document.createElement('div');
      row.className='entry'+(selected.includes(e.path)?' selected':'');
      const icon=document.createElement('span'); icon.textContent=e.isDirectory?'📁':'📄';
      const name=document.createElement('span'); name.textContent=e.name;
      row.append(icon,name);
      row.onclick=ev=>choose(e,i,ev);
      row.ondblclick=()=>{
        if(e.isDirectory){ $('dir').value=e.path; lastIndex=-1; load(e.path); return }
        selected=selected.includes(e.path)?selected:[e.path];
        send(selected);
      };
      $('list').appendChild(row);
    }
    $('up').disabled=!parentOf($('dir').value);
    $('ok').disabled=selected.length===0;
  }
  async function load(dir){
    try{ entries=await window.api.fsList(dir); $('dir').value=dir; lastIndex=-1; render() }
    catch(err){ $('hint').textContent='读取目录失败：'+err.message }
  }
  function respond(files){
    if(!pending) return;
    window.api.fileChooserRespond(pending.backendNodeId, files);
    pending=null; selected=[]; lastIndex=-1; $('overlay').style.display='none';
  }
  function send(files){ if(files.length) respond(files) }
  function trimSlashes(d){ while(d.endsWith(BS)||d.endsWith('/')) d=d.slice(0,-1); return d }
  function parentOf(d){
    d=trimSlashes(d);
    const i=Math.max(d.lastIndexOf(BS), d.lastIndexOf('/'));
    return i>0?d.slice(0,i):'';
  }
  async function showDrives(){
    const ds=await window.api.fsDrives();
    entries=ds.map(d=>({name:d,path:d,isDirectory:true}));
    $('dir').value=''; lastIndex=-1; render();
  }
  $('drives').onclick=()=>void showDrives();
  $('up').onclick=()=>{
    const parent=parentOf($('dir').value);
    if(parent) load(parent); else void showDrives();
  };
  $('dir').onkeydown=ev=>{ if(ev.key==='Enter') load($('dir').value) };
  $('cancel').onclick=()=>respond([]);
  $('ok').onclick=()=>send(selected);
  window.api.onFileChooser(req=>{
    pending={backendNodeId:req.backendNodeId,mode:req.mode,accept:req.accept,directory:req.directory,multiple:req.multiple};
    const limit=req.accept && req.accept.length?'（已按 accept 过滤）':'';
    const hint=req.directory?'选择文件夹；单击选中，双击进入，确定确认当前目录'
      :(req.multiple||req.mode==='multiple')?'Ctrl/Shift 多选，双击确认'
      :'单击选择，双击确认';
    $('hint').textContent=hint+limit;
    selected=[]; lastIndex=-1; $('overlay').style.display='flex'; load($('dir').value);
  });
  window.api.onFileChooserClose(()=>{ pending=null; $('overlay').style.display='none'; });
</script></body></html>`)

interface Tab {
  id: number
  view: WebContentsView
  fileChooserBridge: FileChooserBridge
  title: string
  url: string
  loading: boolean
}

/**
 * A frameless browser window whose tabs are separate WebContentsView instances —
 * each tab owns an independent Chromium webContents (a distinct "browser object").
 */
export class TabbedBrowser {
  readonly window: BrowserWindow
  private readonly tabs = new Map<number, Tab>()
  private activeId: number | null = null
  private nextId = 1
  private cursorView: WebContentsView | null = null
  private cursorPoint: Point = { x: 0, y: 0 }
  private fileChooserOpen = false
  private readonly chooserByTab = new Map<number, FileChooserRequest>()

  onTabsChange?: (tabs: TabInfo[], activeId: number | null) => void
  onLoadEvent?: (message: string) => void
  onFileChooser?: (request: FileChooserRequest) => void

  constructor() {
    this.window = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 960,
      minHeight: 520,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        // ESM preload (.mjs) requires the non-sandboxed renderer.
        sandbox: false
      }
    })

    this.window.on('resize', () => this.layoutActive())
    this.window.on('maximize', () => this.layoutActive())
    this.window.on('unmaximize', () => this.layoutActive())
    this.createTab()
    this.createCursorView()
    this.window.show()
    this.window.focus()
  }

  // ---------- tab management ----------

  createTab(url = NEW_TAB_URL): number {
    const id = this.nextId++
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    })
    view.setBackgroundColor('#ffffff')
    const wc = view.webContents
    const fileChooserBridge = new FileChooserBridge(wc)
    fileChooserBridge.onFileChooser = request => this.onFileChooser?.(request)
    fileChooserBridge.onError = message => this.onLoadEvent?.('FILE CHOOSER ERROR ' + message)
    fileChooserBridge.attach()

    const tab: Tab = { id, view, fileChooserBridge, title: '新标签页', url, loading: false }
    this.tabs.set(id, tab)

    // <a target="_blank"> and window.open should open a new TAB, not a window.
    wc.setWindowOpenHandler(details => {
      // Copy synchronously: the details object is only valid during this call.
      const url = details.url
      this.onLoadEvent?.(`window.open from tab ${id}: ${url} (${details.disposition})`)
      if (/^https?:\/\//i.test(url)) {
        setImmediate(() => this.createTab(url))
      }
      return { action: 'deny' }
    })

    const sync = (loading: boolean) => {
      tab.loading = loading
      tab.url = wc.getURL()
      tab.title = wc.getTitle() || '新标签页'
      this.emitTabs()
    }
    wc.on('did-start-loading', () => sync(true))
    wc.on('did-stop-loading', () => sync(false))
    wc.on('did-finish-load', () => {
      fileChooserBridge.refresh()
      this.onLoadEvent?.(`tab ${id} finished: ${wc.getURL()} title="${wc.getTitle()}"`)
      sync(false)
    })
    wc.on('did-fail-load', (_e, code, description, url) => {
      this.onLoadEvent?.(`tab ${id} FAILED ${code} ${description}: ${url}`)
      sync(false)
    })
    wc.on('render-process-gone', (_e, detail) => {
      this.onLoadEvent?.(`tab ${id} renderer gone: ${JSON.stringify(detail)}`)
    })
    wc.on('page-title-updated', () => sync(false))
    wc.on('did-navigate', () => sync(false))
    wc.on('did-navigate-in-page', () => sync(false))

    void wc.loadURL(url)
    this.activateTab(id)
    return id
  }

  closeTab(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (this.activeId === id) {
      this.window.contentView.removeChildView(tab.view)
      this.tabs.delete(id)
      const remaining = [...this.tabs.keys()]
      if (remaining.length) this.activateTab(remaining[remaining.length - 1])
      else {
        this.activeId = null
        this.createTab()
      }
    } else {
      this.tabs.delete(id)
    }
    this.chooserByTab.delete(id)
    tab.fileChooserBridge.detach()
    try { tab.view.webContents.close() } catch { /* already gone */ }
    this.emitTabs()
  }

  activateTab(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (this.activeId !== null && this.activeId !== id) {
      const previous = this.tabs.get(this.activeId)
      if (previous) this.window.contentView.removeChildView(previous.view)
    }
    this.activeId = id
    if (!this.window.contentView.children.includes(tab.view)) {
      // Insert below the shell renderer, which is transparent in the page slot.
      this.window.contentView.addChildView(tab.view, 0)
    }
    this.layoutActive()
    tab.view.webContents.focus()
    this.emitTabs()
  }

  active(): Tab | undefined {
    return this.activeId === null ? undefined : this.tabs.get(this.activeId)
  }

  activeIdValue(): number | null { return this.activeId }

  /** New-tab/about:blank pages have nothing for the virtual cursor to act on. */
  isActivePageBlank(): boolean {
    const tab = this.active()
    if (!tab) return true
    return tab.url === 'about:blank' || tab.url.startsWith('data:text/html')
  }

  /** Cursor layer lives in the same window, one view level above the page. */
  private createCursorView(): void {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    view.setBackgroundColor('#00000000')
    // Some Electron builds expose this on WebContents; ignore when unavailable.
    ;(view.webContents as unknown as { setIgnoreMouseEvents?: (ignore: boolean) => void })
      .setIgnoreMouseEvents?.(true)
    void view.webContents.loadURL(CURSOR_PAGE)
    this.cursorView = view
    this.window.contentView.addChildView(view)
    this.layoutActive()
  }

  /**
   * Move the tiny cursor view to follow the pointer. Keeping it small means
   * real mouse events pass through everywhere else on the page.
   */
  setCursorPosition(point: Point): void {
    this.cursorPoint = { ...point }
    if (!this.cursorView || this.fileChooserOpen) return
    // View bounds are relative to the window content, not to the screen.
    this.cursorView.setBounds({
      x: Math.round(LEFT_PANEL_WIDTH + point.x - 6),
      y: Math.round(TITLEBAR_HEIGHT + point.y - 4),
      width: 34,
      height: 28
    })
  }

  /** Show/hide the cursor view (new-tab pages hide it). */
  setCursorVisible(visible: boolean): void {
    const wc = this.cursorView?.webContents
    if (!wc || wc.isDestroyed()) return
    wc.send('cursor:visible', visible)
  }

  /** Window-content-relative rect of the web page area. */
  private pageBounds(): Rect {
    const win = this.window.getContentBounds()
    return {
      x: LEFT_PANEL_WIDTH,
      y: TITLEBAR_HEIGHT,
      width: Math.max(1, win.width - LEFT_PANEL_WIDTH - RIGHT_PANEL_WIDTH),
      height: Math.max(1, win.height - TITLEBAR_HEIGHT)
    }
  }

  /** The cursor view is the single overlay layer; expand it over the page only. */
  showFileChooser(request: FileChooserRequest): void {
    const id = this.activeId
    if (id === null) return
    this.chooserByTab.set(id, request)
    this.fileChooserOpen = true
    this.cursorView?.setBounds(this.pageBounds())
    this.cursorView?.webContents.send('filechooser:open', request)
  }

  hideFileChooser(): void {
    if (this.activeId !== null) this.chooserByTab.delete(this.activeId)
    this.cursorView?.webContents.send('filechooser:close')
    this.fileChooserOpen = false
    this.setCursorPosition(this.cursorPoint)
  }

  /** Restore the file picker belonging to the newly activated tab. */
  syncChooserForActiveTab(): void {
    const id = this.activeId
    const request = id === null ? undefined : this.chooserByTab.get(id)
    if (request) {
      this.fileChooserOpen = true
      this.cursorView?.setBounds(this.pageBounds())
      this.cursorView?.webContents.send('filechooser:open', request)
    } else if (this.fileChooserOpen) {
      this.cursorView?.webContents.send('filechooser:close')
      this.fileChooserOpen = false
      this.setCursorPosition(this.cursorPoint)
    }
  }

  isFileChooserOpen(): boolean { return this.fileChooserOpen }

  getOverlayBounds(): Rect | undefined { return this.cursorView?.getBounds() }

  getCursorWebContents(): WebContents | undefined {
    return this.cursorView?.webContents
  }

  respondFileChooser(backendNodeId: number, files: string[]): void {
    void this.active()?.fileChooserBridge.respond(backendNodeId, files)
    this.hideFileChooser()
  }

  list(): TabInfo[] {
    return [...this.tabs.values()].map(t => ({
      id: t.id, title: t.title, url: t.url, loading: t.loading
    }))
  }

  // ---------- navigation on the active tab ----------

  load(url: string): Promise<void> {
    const tab = this.active()
    if (!tab) return Promise.resolve()
    return tab.view.webContents.loadURL(url)
  }

  back(): void {
    const wc = this.active()?.view.webContents
    if (wc?.canGoBack()) wc.goBack()
  }

  forward(): void {
    const wc = this.active()?.view.webContents
    if (wc?.canGoForward()) wc.goForward()
  }

  reload(): void { this.active()?.view.webContents.reload() }

  /** Screen-DIP rectangle of the active page area (middle slot of the shell). */
  pageRect(): Rect {
    const win = this.window.getContentBounds()
    return {
      x: win.x + LEFT_PANEL_WIDTH,
      y: win.y + TITLEBAR_HEIGHT,
      width: Math.max(1, win.width - LEFT_PANEL_WIDTH - RIGHT_PANEL_WIDTH),
      height: Math.max(1, win.height - TITLEBAR_HEIGHT)
    }
  }

  focusPage(): void { this.active()?.view.webContents.focus() }

  refreshLayout(): void { this.layoutActive() }

  /** Keep the page view below the shell renderer so the virtual cursor stays visible. */
  sendPageToBack(): void {
    const tab = this.active()
    if (!tab) return
    const content = this.window.contentView
    if (content.children.includes(tab.view)) content.removeChildView(tab.view)
    content.addChildView(tab.view, 0)
    // Re-add the cursor view last so it sits directly above the page.
    if (this.cursorView) {
      if (content.children.includes(this.cursorView)) content.removeChildView(this.cursorView)
      content.addChildView(this.cursorView)
    }
    this.layoutActive()
  }

  // ---------- window controls ----------

  minimize(): void { this.window.minimize() }
  toggleMaximize(): void {
    if (this.window.isMaximized()) this.window.restore()
    else this.window.maximize()
  }
  close(): void { this.window.close() }
  isMaximized(): boolean { return this.window.isMaximized() }

  // ---------- internals ----------

  private layoutActive(): void {
    const tab = this.active()
    if (!tab) return
    const { width, height } = this.window.getContentBounds()
    const bounds = {
      x: LEFT_PANEL_WIDTH,
      y: TITLEBAR_HEIGHT,
      width: Math.max(1, width - LEFT_PANEL_WIDTH - RIGHT_PANEL_WIDTH),
      height: Math.max(1, height - TITLEBAR_HEIGHT)
    }
    tab.view.setBounds(bounds)
    if (this.fileChooserOpen) {
      // Keep the chooser overlay in sync with the resized page area.
      this.cursorView?.setBounds(bounds)
    } else {
      this.setCursorPosition(this.cursorPoint)
    }
    this.onLoadEvent?.(`layout: window=${width}x${height} view=${bounds.width}x${bounds.height}@${bounds.x},${bounds.y} children=${this.window.contentView.children.length}`)
  }

  private emitTabs(): void {
    this.onTabsChange?.(this.list(), this.activeId)
  }
}
