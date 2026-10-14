// Visual-only Electron fixture: uses production updater sections and a separate profile.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const ejs = require('ejs')
const Lang = require('../app/assets/js/langloader')

const workspace = path.resolve(__dirname, '..')
const runRoot = path.join(workspace, 'dist', 'updater-visual', new Date().toISOString().replace(/[:.]/g, '-'))
const profile = path.join(runRoot, 'profile')
fs.mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.disableHardwareAcceleration()

const productionFiles = ['app/assets/js/scripts/uicore.js', 'app/assets/js/scripts/settings.js', 'app/assets/css/launcher.css', 'app/app.ejs', 'app/settings.ejs', 'app/assets/lang/en_US.toml', 'app/assets/lang/_custom.toml']
const sourceHashes = Object.fromEntries(productionFiles.map(filename => [filename, digest(fs.readFileSync(path.join(workspace, filename)))]))
const observations = []
const actions = []
let win
let finished = false
let paintCount = 0

function digest(buffer){
    return crypto.createHash('sha256').update(buffer).digest('hex')
}

function section(source, start, end){
    const begin = source.indexOf(start)
    const finish = source.indexOf(end, begin)
    assert(begin >= 0 && finish > begin, `Missing production section ${start}`)
    return source.slice(begin, finish)
}

function writeJson(filename, value){
    fs.writeFileSync(path.join(runRoot, filename), JSON.stringify(value, null, 2))
}

function prepareFixture(){
    Lang.setupLanguage()
    const core = fs.readFileSync(path.join(workspace, 'app/assets/js/scripts/uicore.js'), 'utf8').replace(/\r\n/g, '\n')
    const settings = fs.readFileSync(path.join(workspace, 'app/assets/js/scripts/settings.js'), 'utf8').replace(/\r\n/g, '\n')
    const settingsMarkup = fs.readFileSync(path.join(workspace, 'app/settings.ejs'), 'utf8')
    const appMarkup = fs.readFileSync(path.join(workspace, 'app/app.ejs'), 'utf8')
    const notice = section(appMarkup, '<section id="updaterNotice"', '</section>') + '</section>'
    let updateTab = section(settingsMarkup, '<div id="settingsTabUpdate"', '    <script src="./assets/js/scripts/settings.js"')
    // The source ends with the Updates tab and its enclosing settings panel.
    updateTab = updateTab.trim().slice(0, -'</div>'.length)
    const bootstrap = `const { ipcRenderer, shell } = require('electron')
const remote = { app: { getVersion: () => '1.0.4' } }
const Lang = require(${JSON.stringify(path.join(workspace, 'app/assets/js/langloader'))})
Lang.setupLanguage()
const semver = require(${JSON.stringify(path.join(workspace, 'node_modules/semver'))})
const isDev = false
const loggerAutoUpdater = { info(){}, error(){} }
const VIEWS = { settings: '#settings' }
let visualView = '#landing'
let visualNavigationCount = 0
let visualSwitchCount = 0
function getCurrentView(){ return visualView }
function switchView(current, next, a, b, done){ visualSwitchCount++; visualView = next; done() }
function settingsNavItemListener(){ visualNavigationCount++; document.getElementById('settingsTabUpdate').style.display = 'block' }
`
    const renderer = [bootstrap,
        section(core, '// Initialize auto updates', '/* jQuery Example'),
        section(settings, 'function isPrerelease(', '/**\n * Utility method'),
        section(settings, 'function populateVersionInformation(', '/**\n * Retrieve the version information'),
        section(settings, 'const settingsTabUpdate ', '/**\n * Settings preparation functions.'),
        'prepareUpdateTab()'
    ].join('\n')
    fs.writeFileSync(path.join(runRoot, 'renderer.js'), renderer)
    const html = ejs.render(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>ShinobiCraft2 updater visual QA</title><base href="${pathToFileURL(path.join(workspace, 'app') + path.sep).href}"><link rel="stylesheet" href="assets/css/launcher.css"><style>
body{background:#171614;margin:32px}
#visualSurface{width:min(750px,100%)}
#settingsTabUpdate{display:block!important;height:auto!important;overflow:visible!important}
#settingsNavUpdate{margin-bottom:8px;background:none;border:1px solid rgba(126,126,126,.57);border-radius:3px;padding:6px 10px}
</style></head><body><main id="visualSurface"><button id="settingsNavUpdate" type="button">Atualizações</button>${updateTab}</main>${notice}<script src="${pathToFileURL(path.join(runRoot, 'renderer.js')).href}"></script></body></html>`, { lang: Lang.queryEJS })
    fs.writeFileSync(path.join(runRoot, 'fixture.html'), html)
}

async function evaluate(source){
    return win.webContents.executeJavaScript(source, true)
}

async function settlePaint(){
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120))))')
    win.webContents.invalidate()
    await new Promise(resolve => setTimeout(resolve, 120))
}

async function emit(event, info){
    win.webContents.send('autoUpdateNotification', event, info)
    await settlePaint()
}

async function capture(name){
    await settlePaint()
    const dom = await evaluate(`(() => {
        const ids = ['settingsUpdateTitle','settingsUpdateVersionValue','settingsUpdateActionButton','settingsUpdateDetail','updaterNotice','updaterNoticeTitle','updaterNoticeMessage','updaterNoticeAction','updaterNoticeDismiss']
        const values = Object.fromEntries(ids.map(id => {
            const e = document.getElementById(id), r = e.getBoundingClientRect(), css = getComputedStyle(e)
            return [id, {text:e.textContent,hidden:e.hidden,disabled:e.disabled,rect:{x:r.x,y:r.y,width:r.width,height:r.height},outline:css.outline,role:e.getAttribute('role'),ariaValueNow:e.getAttribute('aria-valuenow')}]
        }))
        return {state:launcherUpdateState.status,version:launcherUpdateState.info?.version,viewport:{width:innerWidth,height:innerHeight},focused:document.activeElement.id,values,documentOverflow:document.documentElement.scrollWidth > innerWidth}
    })()`)
    const screenshot = await win.webContents.capturePage()
    const png = screenshot.toPNG()
    assert(png.length > 3000, 'Screenshot contains no usable painted content')
    const filename = `${name}.png`
    fs.writeFileSync(path.join(runRoot, filename), png)
    const record = {name, filename, sha256:digest(png), pixelSize:screenshot.getSize(), paintCount, ...dom}
    observations.push(record)
    return record
}

async function focusByTab(target){
    await evaluate('document.activeElement.blur(); document.body.focus()')
    for(let i = 0; i < 8; i++){
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'})
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'})
        await settlePaint()
        if(await evaluate('document.activeElement.id') === target){
            const outline = await evaluate('getComputedStyle(document.activeElement).outlineStyle')
            assert.notEqual(outline, 'none', 'Keyboard focus has no visible outline')
            return
        }
    }
    throw new Error(`Tab did not focus ${target}`)
}

async function pressEnter(){
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'})
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13})
    await settlePaint()
}

async function run(){
    prepareFixture()
    await app.whenReady()
    win = new BrowserWindow({show:false,width:980,height:650,useContentSize:true,paintWhenInitiallyHidden:true,backgroundColor:'#171614',webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false,offscreen:true}})
    win.webContents.setFrameRate(60)
    win.webContents.on('paint', () => paintCount++)
    win.webContents.on('render-process-gone', (_event, details) => fail(new Error(`Renderer exited: ${details.reason}`)))
    ipcMain.on('autoUpdateAction', (_event, action) => actions.push(action))
    await win.loadFile(path.join(runRoot, 'fixture.html'))
    // Give Chromium a focused page while the operating-system window remains hidden.
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {enabled:true})
    const info = {version:'1.0.5',releaseName:'ShinobiCraft2 Launcher 1.0.5',releaseNotes:'<p>Atualização do launcher disponível para instalação.</p>'}
    await emit('checking-for-update')
    await emit('update-available', info)
    const available = await capture('01-available')
    assert.equal(available.values.updaterNotice.hidden, false)
    assert(available.values.updaterNoticeMessage.text.includes('1.0.5'))
    await evaluate('document.getElementById(\'updaterNoticeDismiss\').click()')
    await emit('update-available', info)
    assert(await evaluate('document.getElementById(\'updaterNotice\').hidden'), 'Available notice repeated for the same version')
    await emit('download-started', info)
    await emit('download-progress', {percent:37.4,transferred:42.1*1048576,total:112.1*1048576})
    const progress = await capture('02-progress')
    assert.equal(progress.values.settingsUpdateActionButton.text, 'Baixando... 37.4%')
    assert.equal(progress.values.settingsUpdateDetail.text, '42.1 MB / 112.1 MB')
    await emit('realerror', {message:'HTTP 404 from test fixture',stack:'Visual fixture error without code'})
    const error = await capture('03-error')
    assert.equal(error.state, 'error')
    assert.equal(error.values.settingsUpdateTitle.text, 'Falha ao atualizar')
    assert.equal(error.values.settingsUpdateActionButton.disabled, false)
    await focusByTab('settingsUpdateActionButton')
    await capture('04-error-keyboard-focus')
    await pressEnter()
    assert(actions.includes('checkForUpdate'), 'Keyboard retry did not send its IPC action')
    await emit('update-available', info)
    await emit('download-started', info)
    await emit('download-progress', {percent:100,transferred:112.1*1048576,total:112.1*1048576})
    await emit('update-downloaded', info)
    const ready = await capture('05-ready')
    assert.equal(ready.state, 'downloaded')
    assert.equal(ready.values.settingsUpdateTitle.text, 'Atualização pronta')
    assert.equal(ready.values.settingsUpdateActionButton.text, 'Instalar agora')
    assert.notEqual(ready.sha256, progress.sha256, 'Ready screenshot repeated the progress frame')
    assert.notEqual(error.sha256, progress.sha256, 'Error screenshot repeated the progress frame')
    win.setContentSize(420, 650)
    const narrowReady = await capture('06-ready-narrow-420')
    assert.equal(narrowReady.viewport.width, 420)
    assert.equal(narrowReady.documentOverflow, false, 'Updater fixture has horizontal overflow')
    for(const id of ['updaterNoticeAction','updaterNoticeDismiss']){
        const rect = narrowReady.values[id].rect
        assert(rect.x >= 0 && rect.x + rect.width <= 420 && rect.y + rect.height <= 650, `${id} is outside narrow viewport`)
    }
    await emit('realerror', {message:'Network disconnected in visual fixture'})
    const narrowError = await capture('07-error-narrow-420')
    assert.equal(narrowError.values.settingsUpdateActionButton.text, 'Tentar novamente')
    assert.equal(narrowError.documentOverflow, false)
    await evaluate('visualView = VIEWS.settings; document.getElementById(\'updaterNoticeAction\').click()')
    await settlePaint()
    assert.equal(await evaluate('launcherUpdateState.status'), 'checking')
    await emit('update-not-available', {version:'1.0.4'})
    const latest = await capture('08-latest-narrow-420')
    assert.equal(latest.values.updaterNotice.hidden, true)
    await emit('update-downloaded', { ...info,version:'1.0.6' })
    win.setContentSize(980,650)
    await focusByTab('settingsUpdateActionButton')
    await capture('09-ready-keyboard-focus')
    await pressEnter()
    assert.equal(actions.filter(action => action === 'installUpdateNow').length, 1)
    assert.equal(await evaluate('launcherUpdateState.status'), 'installing')
    const afterHashes = Object.fromEntries(productionFiles.map(filename => [filename,digest(fs.readFileSync(path.join(workspace,filename)))]))
    assert.deepEqual(afterHashes, sourceHashes, 'Production source changed during the visual run')
    const result = {status:'passed',runRoot,profile,electronVersion:process.versions.electron,chromiumVersion:process.versions.chrome,sourceHashes,productionUnchanged:true,actions,observations,boundary:'Real Electron offscreen rendering; production updater DOM/CSS/functions extracted unchanged. Simulated IPC events cover visual states; this fixture never downloads or installs and uses a dedicated profile. Host geometry only replaces the unrelated launcher shell.'}
    writeJson('result.json', result)
    console.log(JSON.stringify({status:result.status,runRoot,screenshots:observations.map(({name,filename}) => ({name,path:path.join(runRoot,filename)})),actions,paintCount}, null, 2))
    finished = true
    win.destroy()
    app.exit(0)
}

function fail(error){
    if(finished){ return }
    finished = true
    writeJson('failure.json', {message:error.message,stack:error.stack,runRoot})
    console.error(error.stack || error)
    app.exit(1)
}

process.on('uncaughtException', fail)
process.on('unhandledRejection', fail)
setTimeout(() => fail(new Error('Visual QA timed out after 45 seconds')), 45000).unref()
run().catch(fail)
