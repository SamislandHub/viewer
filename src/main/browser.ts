import { BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { join } from 'node:path'
import type { Point, Rect } from '@shared/types'
import { FileChooserBridge, type FileChooserRequest, type InspectedElement } from './dialog-bridge'
import { applyClientHints } from './fingerprint'

/** Layout of the shell window; tabs are vertical on the left, toolbar is one row. */
export const TITLEBAR_HEIGHT = 48
/** Width of the left tab strip. Updated by the collapse/expand control. */
export let LEFT_PANEL_WIDTH = 210
/** Input controls now live in their own window, so the page uses full width. */
export const RIGHT_PANEL_WIDTH = 0

function isInternalUrl(url: string): boolean {
  return url === 'viewer://settings' || url === 'viewer://home'
    || url === 'viewer://bookmarks' || url === 'viewer://history'
    || url === 'viewer://downloads' || url === 'viewer://newtab'
    || url.startsWith('viewer://files') || url.startsWith('viewer://preview')
}

function internalFile(url: string): string | null {
  if (url === 'viewer://settings') return join(__dirname, '../renderer/settings.html')
  if (url === 'viewer://home') return join(__dirname, '../renderer/home.html')
  if (url === 'viewer://bookmarks') return join(__dirname, '../renderer/bookmarks.html')
  if (url === 'viewer://history') return join(__dirname, '../renderer/history.html')
  if (url === 'viewer://downloads') return join(__dirname, '../renderer/downloads.html')
  if (url === 'viewer://newtab') return join(__dirname, '../renderer/newtab.html')
  if (url.startsWith('viewer://files')) return join(__dirname, '../renderer/files.html')
  if (url.startsWith('viewer://preview')) return join(__dirname, '../renderer/preview.html')
  return null
}

function internalUrlFromFile(fileUrl: string): string | null {
  if (fileUrl.endsWith('/settings.html')) return 'viewer://settings'
  if (fileUrl.endsWith('/home.html')) return 'viewer://home'
  if (fileUrl.endsWith('/bookmarks.html')) return 'viewer://bookmarks'
  if (fileUrl.endsWith('/history.html')) return 'viewer://history'
  if (fileUrl.endsWith('/downloads.html')) return 'viewer://downloads'
  if (fileUrl.endsWith('/newtab.html')) return 'viewer://newtab'
  if (fileUrl.includes('/files.html')) {
    const match = fileUrl.match(/[?&]path=([^&]*)/)
    if (match) {
      try { return `viewer://files/${encodeURIComponent(decodeURIComponent(match[1]))}` } catch { /* ignore */ }
    }
    return 'viewer://files'
  }
  if (fileUrl.includes('/preview.html')) {
    const match = fileUrl.match(/[?&]path=([^&]*)/)
    if (match) {
      try { return `viewer://preview/${encodeURIComponent(decodeURIComponent(match[1]))}` } catch { /* ignore */ }
    }
    return 'viewer://preview'
  }
  return null
}

function internalTitle(url: string): string | null {
  if (url === 'viewer://settings') return '设置'
  if (url === 'viewer://home') return '主页'
  if (url === 'viewer://bookmarks') return '收藏夹'
  if (url === 'viewer://history') return '历史记录'
  if (url === 'viewer://downloads') return '下载管理'
  if (url === 'viewer://newtab') return '新标签页'
  if (url.startsWith('viewer://files')) return '文件管理'
  if (url.startsWith('viewer://preview')) return '文件预览'
  return null
}

export interface TabInfo {
  id: number
  title: string
  url: string
  loading: boolean
  favicon: string
}

/** Transparent overlay view: virtual cursor + in-app file picker, one layer. */
const CURSOR_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;
    font:13px/1.6 ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif;color:#212529}
  #cursor{position:absolute;left:0;top:0;width:16px;height:21px;pointer-events:none;opacity:0;
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
  *{scrollbar-width:none;-ms-overflow-style:none}*::-webkit-scrollbar{display:none}
  .entry{display:flex;gap:7px;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:12px}
  .entry:hover{background:#f1f3f5}
  .entry.selected{background:#e7f1ff}
  .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
  #shot{position:absolute;inset:0;display:none;cursor:crosshair;background:rgba(0,0,0,.35)}
  #shot.previewing{background:transparent;pointer-events:none}
  #shotSel{position:absolute;box-sizing:border-box;border:2px solid #4263eb;background:rgba(66,99,235,.12);
    box-shadow:0 0 0 9999px rgba(0,0,0,.35);display:none;pointer-events:none}
  #shotTip{position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:7px 14px;border-radius:20px;
    background:rgba(33,37,41,.88);color:#fff;font-size:12px;white-space:nowrap;pointer-events:none}
  .shotBar{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:6px;padding:6px;
    background:#fff;border:1px solid #dfe3e9;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.2)}
  .shotBar button{padding:4px 12px;font-size:12px}
  #shotPreview{position:absolute;right:20px;bottom:20px;width:330px;display:none;gap:10px;padding:10px;
    background:#fff;border:1px solid #dfe3e9;border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,.2);pointer-events:auto}
  #shotPreview img{width:84px;height:56px;flex:none;object-fit:cover;border:1px solid #e9ecef;border-radius:5px;background:#f8f9fa}
  #shotInfo{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:4px}
  #shotInfo b{font-size:12px}
  #shotInfo span{font-size:10px;color:#adb5bd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .shotActions{display:flex;gap:4px;flex-wrap:wrap}
  .shotActions button{padding:3px 7px;font-size:11px}
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
<div id="shot">
  <div id="shotSel"></div>
  <div id="shotTip">拖动鼠标框选区域，或点击「整页截图」</div>
  <div class="shotBar">
    <button id="shotArea">区域截图</button>
    <button id="shotFull">整页截图</button>
    <button id="shotCancel">取消</button>
  </div>
  <div id="shotPreview">
    <img id="shotImg" />
    <div id="shotInfo">
      <b>截图已保存</b><span id="shotName"></span>
      <div class="shotActions">
        <button id="shotCopy">复制</button><button id="shotOpen">打开</button>
        <button id="shotFolder">文件夹</button><button id="shotClose">关闭</button>
      </div>
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

  // Chrome-style screenshot: this layer sits above the page view.
  const shot=$('shot'), shotSel=$('shotSel'), shotTip=$('shotTip'), shotPreview=$('shotPreview');
  let shotStart=null, shotActive=false, shotPath='';
  function closeShot(){
    shotActive=false; shotStart=null; shot.style.display='none'; shot.classList.remove('previewing');
    window.api.screenshotEnd();
  }
  function showShotPreview(r){
    shotPath=r.path; shot.classList.add('previewing');
    shotSel.style.display='none'; shotTip.style.display='none'; document.querySelector('.shotBar').style.display='none';
    shotPreview.style.display='flex'; $('shotImg').src=r.dataUrl;
    const parts=r.path.split(BS); $('shotName').textContent=parts[parts.length-1];
  }
  window.api.onScreenshotBegin(()=>{
    shotActive=true; shotStart=null; shot.style.display='block'; shot.classList.remove('previewing');
    shotSel.style.display='none'; shotPreview.style.display='none'; shotTip.style.display='block';
    shotTip.textContent='拖动鼠标框选区域，或点击「整页截图」'; document.querySelector('.shotBar').style.display='flex';
  });
  window.api.onScreenshotEnd(()=>{
    shotActive=false; shotStart=null; shot.style.display='none'; shot.classList.remove('previewing');
  });
  shot.addEventListener('mousedown', ev=>{
    if(!shotActive || shot.classList.contains('previewing') || ev.target.closest('.shotBar')) return;
    shotStart={x:ev.clientX,y:ev.clientY};
    shotSel.style.display='block';
    shotSel.style.left=ev.clientX+'px'; shotSel.style.top=ev.clientY+'px';
    shotSel.style.width='0px'; shotSel.style.height='0px';
    shotTip.textContent='松开鼠标完成区域截图';
  });
  window.addEventListener('mousemove', ev=>{
    if(!shotStart) return;
    shotSel.style.left=Math.min(shotStart.x,ev.clientX)+'px';
    shotSel.style.top=Math.min(shotStart.y,ev.clientY)+'px';
    shotSel.style.width=Math.abs(ev.clientX-shotStart.x)+'px';
    shotSel.style.height=Math.abs(ev.clientY-shotStart.y)+'px';
  });
  window.addEventListener('mouseup', ev=>{
    if(!shotStart) return;
    const start=shotStart; shotStart=null;
    const w=Math.abs(ev.clientX-start.x), h=Math.abs(ev.clientY-start.y);
    if(w<6||h<6){
      shotSel.style.display='none';
      shotTip.textContent='拖动鼠标框选区域，或点击「整页截图」';
      return;
    }
    window.api.screenshotCapture({rect:{
      x:Math.round(Math.min(start.x,ev.clientX)), y:Math.round(Math.min(start.y,ev.clientY)),
      width:Math.round(w), height:Math.round(h)
    }}).then(showShotPreview).catch(e=>{
      shotSel.style.display='none'; shotTip.textContent='截图失败：'+e.message;
    });
  });
  $('shotArea').onclick=()=>{ shotTip.textContent='按住鼠标拖动，框选要截取的区域'; };
  $('shotFull').onclick=()=>{
    window.api.screenshotCapture({fullPage:true}).then(showShotPreview).catch(e=>{ shotTip.textContent='截图失败：'+e.message; });
  };
  $('shotCancel').onclick=closeShot;
  $('shotCopy').onclick=()=>{
    window.api.screenshotCopy($('shotImg').src).then(()=>{ $('shotCopy').textContent='已复制'; })
      .catch(e=>{ $('shotName').textContent='复制失败：'+e.message; });
  };
  $('shotOpen').onclick=()=>{ window.api.screenshotOpen(shotPath); };
  $('shotFolder').onclick=()=>{ window.api.screenshotReveal(shotPath); };
  $('shotClose').onclick=closeShot;
  document.addEventListener('keydown', ev=>{ if(ev.key==='Escape'&&shotActive) closeShot(); });
</script></body></html>`)
interface Tab {
  id: number
  view: WebContentsView
  fileChooserBridge: FileChooserBridge
  title: string
  url: string
  loading: boolean
  favicon: string
  /** The persistent home tab is never shown in the tab strip. */
  isHome: boolean
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
  private toolbarView: WebContentsView | null = null
  private sidebarView: WebContentsView | null = null
  private rendererBase: string | null = null
  private cursorPoint: Point = { x: 0, y: 0 }
  private fileChooserOpen = false
  private screenshotOpen = false
  private readonly chooserByTab = new Map<number, FileChooserRequest>()

  onTabsChange?: (tabs: TabInfo[], activeId: number | null, hasPage: boolean) => void
  onLoadEvent?: (message: string) => void
  onCursorLayerReady?: () => void
  onFileChooser?: (request: FileChooserRequest) => void
  onInspectResult?: (element: InspectedElement) => void
  onInspectChange?: (active: boolean) => void
  onNavigate?: (url: string, title: string) => void
  onBeforeInput?: (event: Electron.Event, input: Electron.Input) => void

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
    this.createHomeTab()
    this.createCursorView()
    this.createSidebarView()
    this.createToolbarView()
    this.window.show()
    this.window.focus()
  }

  // ---------- tab management ----------

  createTab(url = 'viewer://newtab', isHome = false): number {
    const id = this.nextId++
    const view = new WebContentsView({
      webPreferences: {
        ...(isInternalUrl(url)
          ? { preload: join(__dirname, '../preload/index.mjs'), sandbox: false }
          : {}),
        contextIsolation: true,
        nodeIntegration: false,
        // No native alert/confirm/prompt windows at all.
        disableDialogs: true
      }
    })
    view.setBackgroundColor('#ffffff')
    const wc = view.webContents
    const fileChooserBridge = new FileChooserBridge(wc)
    fileChooserBridge.onFileChooser = request => this.onFileChooser?.(request)
    fileChooserBridge.onInspect = element => {
      this.onInspectResult?.(element)
      this.onInspectChange?.(false)
    }
    fileChooserBridge.onInspectCancel = () => this.onInspectChange?.(false)
    fileChooserBridge.onError = message => this.onLoadEvent?.('DIALOG BRIDGE ERROR ' + message)
    fileChooserBridge.attach()
    void applyClientHints(wc)
    wc.on('did-finish-load', () => { void applyClientHints(wc) })

    const tab: Tab = { id, view, fileChooserBridge, title: '新标签页', url, loading: false, favicon: '', isHome }
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
      if (loading && fileChooserBridge.isInspecting()) {
        void fileChooserBridge.stopInspect()
        this.onInspectChange?.(false)
      }
      const actual = wc.getURL()
      // Map internal html files back to their viewer:// URL.
      const internal = internalUrlFromFile(actual)
      tab.url = internal ?? actual
      tab.title = wc.getTitle() || internalTitle(tab.url) || '新标签页'
      this.emitTabs()
    }
    /** Only real web pages go into history: not internal pages or new tabs. */
    const record = () => {
      if (!/^(https?:|file:)/i.test(tab.url)) return
      this.onNavigate?.(tab.url, tab.title)
    }
    wc.on('before-input-event', (event, input) => this.onBeforeInput?.(event, input))
    wc.on('did-start-loading', () => sync(true))
    wc.on('did-stop-loading', () => sync(false))
    wc.on('did-finish-load', () => {
      fileChooserBridge.refresh()
      this.onLoadEvent?.(`tab ${id} finished: ${wc.getURL()} title="${wc.getTitle()}"`)
      sync(false)
      record()
    })
    wc.on('did-fail-load', (_e, code, description, url) => {
      this.onLoadEvent?.(`tab ${id} FAILED ${code} ${description}: ${url}`)
      sync(false)
    })
    wc.on('render-process-gone', (_e, detail) => {
      this.onLoadEvent?.(`tab ${id} renderer gone: ${JSON.stringify(detail)}`)
    })
    wc.on('page-title-updated', () => { sync(false); record() })
    wc.on('did-navigate', () => { tab.favicon = ''; sync(false) })
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? ''
      this.emitTabs()
    })
    wc.on('did-navigate-in-page', () => sync(false))

    const file = internalFile(url)
    if (file) void this.loadInternal(wc, file, this.internalQuery(url))
    else void wc.loadURL(url)
    this.activateTab(id)
    return id
  }

  closeTab(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab || tab.isHome) return
    if (this.activeId === id) this.endScreenshot()
    if (this.activeId === id) {
      this.window.contentView.removeChildView(tab.view)
      this.tabs.delete(id)
      const remaining = [...this.tabs.entries()].filter(([, t]) => !t.isHome)
      if (remaining.length) this.activateTab(remaining[remaining.length - 1][0])
      else this.home()
    } else {
      this.tabs.delete(id)
    }
    this.chooserByTab.delete(id)
    if (tab.fileChooserBridge.isInspecting()) this.onInspectChange?.(false)
    tab.fileChooserBridge.detach()
    try { tab.view.webContents.close() } catch { /* already gone */ }
    this.emitTabs()
  }

  activateTab(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (this.activeId !== null && this.activeId !== id) {
      this.endScreenshot()
      const previous = this.tabs.get(this.activeId)
      if (previous) {
        if (previous.fileChooserBridge.isInspecting()) {
          void previous.fileChooserBridge.stopInspect()
          this.onInspectChange?.(false)
        }
        this.window.contentView.removeChildView(previous.view)
      }
    }
    this.activeId = id
    if (!this.window.contentView.children.includes(tab.view)) {
      // Insert below the shell renderer, which is transparent in the page slot.
      this.window.contentView.addChildView(tab.view, 0)
    }
    this.layoutActive()
    // Do not steal keyboard focus from the shell toolbar here. A child view
    // gets focus naturally when the user clicks inside the page.
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

  /** Toolbar and sidebar are overlay views above every page view. */
  private createToolbarView(): void {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    })
    view.setBackgroundColor('#00000000')
    this.toolbarView = view
    this.window.contentView.addChildView(view)
    this.layoutActive()
  }

  private createSidebarView(): void {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    })
    view.setBackgroundColor('#00000000')
    this.sidebarView = view
    this.window.contentView.addChildView(view)
    this.layoutActive()
  }

  setRendererBase(base: string | null): void { this.rendererBase = base }
  rendererBaseUrl(): string | null { return this.rendererBase }

  private internalQuery(url: string): Record<string, string> | undefined {
    for (const prefix of ['viewer://files/', 'viewer://preview/']) {
      if (url.startsWith(prefix)) {
        try { return { path: decodeURIComponent(url.slice(prefix.length)) } } catch { /* ignore */ }
      }
    }
    return undefined
  }

  private loadInternal(wc: WebContents, file: string, query?: Record<string, string>): Promise<void> {
    if (this.rendererBase) {
      try {
        const name = file.split(/[\\/]/).pop() ?? file
        const url = new URL(name, this.rendererBase)
        if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
        return wc.loadURL(url.toString())
      } catch { /* fall through to built file */ }
    }
    return wc.loadFile(file, { query })
  }

  /** Re-load internal tabs so they pick up the dev server (HMR) after bootstrap. */
  reloadInternalTabs(): void {
    for (const tab of this.tabs.values()) {
      const file = internalFile(tab.url)
      if (file) void this.loadInternal(tab.view.webContents, file, this.internalQuery(tab.url))
    }
  }

  loadToolbar(url: string): Promise<void> {
    if (!this.toolbarView) return Promise.resolve()
    return this.toolbarView.webContents.loadURL(url)
  }

  loadToolbarFile(path: string): Promise<void> {
    if (!this.toolbarView) return Promise.resolve()
    return this.toolbarView.webContents.loadFile(path)
  }

  loadSidebar(url: string): Promise<void> {
    if (!this.sidebarView) return Promise.resolve()
    return this.sidebarView.webContents.loadURL(url)
  }

  loadSidebarFile(path: string): Promise<void> {
    if (!this.sidebarView) return Promise.resolve()
    return this.sidebarView.webContents.loadFile(path)
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
    ;(view.webContents as unknown as { setIgnoreMouseEvents?: (ignore: boolean) => void })
      .setIgnoreMouseEvents?.(true)
    void view.webContents.loadURL(CURSOR_PAGE)
    view.webContents.on('did-finish-load', () => {
      this.onCursorLayerReady?.()
    })
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
    if (!this.cursorView || this.fileChooserOpen || this.screenshotOpen) return
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
    if (this.screenshotOpen) this.endScreenshot()
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

  /** Screenshot UI lives on the topmost cursor layer, above the page view. */
  beginScreenshot(): void {
    if (this.fileChooserOpen) return
    this.screenshotOpen = true
    this.cursorView?.setBounds(this.pageBounds())
    this.cursorView?.webContents.send('screenshot:begin')
  }

  endScreenshot(): void {
    if (!this.screenshotOpen) return
    this.screenshotOpen = false
    this.cursorView?.webContents.send('screenshot:end')
    this.setCursorPosition(this.cursorPoint)
  }

  isScreenshotOpen(): boolean { return this.screenshotOpen }

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
      id: t.id, title: t.title, url: t.url, loading: t.loading, favicon: t.favicon
    }))
  }

  /** Tabs shown in the strip. The home page is a real tab but stays hidden. */
  visibleList(): TabInfo[] {
    return this.list().filter(t => t.url !== 'viewer://home')
  }

  // ---------- navigation on the active tab ----------

  load(url: string): Promise<void> {
    // Navigating an ordinary tab to viewer:// would skip its preload, so give
    // internal pages a dedicated tab instead.
    if (isInternalUrl(url)) {
      this.openInternalTab(url)
      return Promise.resolve()
    }
    let tab = this.active()
    // Home is persistent: external navigation from it opens a new tab.
    if (tab?.isHome && !isInternalUrl(url)) {
      this.createTab(url)
      return Promise.resolve()
    }
    if (!tab) {
      this.createTab()
      tab = this.active()
      if (!tab) return Promise.resolve()
    }
    const file = internalFile(url)
    if (file) return this.loadInternal(tab.view.webContents, file, this.internalQuery(url))
    return tab.view.webContents.loadURL(url)
  }

  /** Internal pages need their own tab so the privileged preload is attached. */
  openInternalTab(url: string): number {
    const existing = [...this.tabs.values()].find(t => t.url === url)
    if (existing) { this.activateTab(existing.id); return existing.id }
    return this.createTab(url)
  }

  /** Open the settings page in a dedicated tab, like chrome://settings. */
  openSettingsTab(): number {
    return this.openInternalTab('viewer://settings')
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

  // ---------- element selection ----------

  async startElementPick(): Promise<boolean> {
    const tab = this.active()
    if (!tab || tab.isHome || this.isActivePageBlank()) return false
    try {
      await tab.fileChooserBridge.startInspect()
      const active = tab.fileChooserBridge.isInspecting()
      this.onInspectChange?.(active)
      return active
    } catch (error) {
      this.onLoadEvent?.(`element pick failed: ${String(error)}`)
      return false
    }
  }

  stopElementPick(): void {
    const tab = this.active()
    if (!tab?.fileChooserBridge.isInspecting()) return
    void tab.fileChooserBridge.stopInspect()
    this.onInspectChange?.(false)
  }

  async captureFullPage(): Promise<Buffer | undefined> {
    const tab = this.active()
    if (!tab || tab.isHome) return undefined
    try {
      return await tab.fileChooserBridge.captureFullPage()
    } catch (error) {
      this.onLoadEvent?.(`full page capture failed: ${String(error)}`)
      return undefined
    }
  }

  /** The home tab always exists; clicking home just activates it. */
  home(): void {
    for (const tab of this.tabs.values()) {
      if (tab.isHome) { this.activateTab(tab.id); return }
    }
  }

  private createHomeTab(): void {
    const id = this.createTab('viewer://home', true)
    this.activateTab(id)
  }

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

  /** Push a state update to the shell and to every internal page tab. */
  broadcast(channel: string, payload?: unknown): void {
    const targets = [
      this.window.webContents,
      ...(this.toolbarView ? [this.toolbarView.webContents] : []),
      ...(this.sidebarView ? [this.sidebarView.webContents] : []),
      ...[...this.tabs.values()].map(tab => tab.view.webContents)
    ]
    for (const wc of targets) {
      if (!wc.isDestroyed()) wc.send(channel, payload)
    }
  }

  focusPage(): void { this.active()?.view.webContents.focus() }

  /** Give keyboard focus back to the shell renderer (toolbar / address bar). */
  /** Navigate an existing file-manager tab in place, keeping its webContents. */
  updateActiveFileUrl(url: string): void {
    const tab = this.active()
    if (tab && tab.url.startsWith('viewer://files')) {
      tab.url = url
      this.emitTabs()
    }
  }

  navigateFiles(webContentsId: number, path: string): void {
    const tab = [...this.tabs.values()].find(t => t.view.webContents.id === webContentsId)
    if (!tab) return
    tab.url = path ? `viewer://files/${encodeURIComponent(path)}` : 'viewer://files'
    const file = internalFile(tab.url)
    if (file) void this.loadInternal(tab.view.webContents, file, path ? { path } : undefined)
    this.emitTabs()
  }

  focusShell(): void { this.window.webContents.focus() }
  toolbarWebContents(): WebContents | undefined { return this.toolbarView?.webContents }

  focusToolbar(): void { this.toolbarView?.webContents.focus() }

  focusSidebar(): void { this.sidebarView?.webContents.focus() }

  refreshLayout(): void { this.layoutActive() }

  setLeftPanelWidth(width: number): void {
    LEFT_PANEL_WIDTH = Math.max(44, Math.min(320, Math.round(width)))
    this.refreshLayout()
  }

  /** Keep the page view below the shell renderer so the virtual cursor stays visible. */
  sendPageToBack(): void {
    const tab = this.active()
    if (!tab) return
    const content = this.window.contentView
    if (content.children.includes(tab.view)) content.removeChildView(tab.view)
    content.addChildView(tab.view, 0)
    // Toolbar and sidebar above the page, cursor layer topmost.
    // Top to bottom: toolbar (address bar) > sidebar > cursor > page.
    if (this.cursorView) {
      if (content.children.includes(this.cursorView)) content.removeChildView(this.cursorView)
      content.addChildView(this.cursorView)
    }
    if (this.sidebarView) {
      if (content.children.includes(this.sidebarView)) content.removeChildView(this.sidebarView)
      content.addChildView(this.sidebarView)
    }
    if (this.toolbarView) {
      if (content.children.includes(this.toolbarView)) content.removeChildView(this.toolbarView)
      content.addChildView(this.toolbarView)
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
    this.toolbarView?.setBounds({ x: 0, y: 0, width, height: TITLEBAR_HEIGHT })
    this.sidebarView?.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width: LEFT_PANEL_WIDTH, height: Math.max(1, height - TITLEBAR_HEIGHT) })
    if (this.fileChooserOpen || this.screenshotOpen) {
      this.cursorView?.setBounds(bounds)
    } else {
      this.setCursorPosition(this.cursorPoint)
    }
    this.onLoadEvent?.(`layout: window=${width}x${height} view=${bounds.width}x${bounds.height}@${bounds.x},${bounds.y} children=${this.window.contentView.children.length}`)
  }

  private emitTabs(): void {
    this.onTabsChange?.(this.visibleList(), this.activeId, this.tabs.size > 0)
  }
}
