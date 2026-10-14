// Packaged only by scripts/updater-e2e.js, never by the production build.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { autoUpdater } = require('electron-updater')
const remote = require('@electron/remote/main')
const { createUpdaterController } = require('./app/assets/js/updatercontroller')
const config = require('./e2e-config.json')

if(!app.isPackaged || config.appId !== 'shinobicraft2-updater-e2e'){
    throw new Error('This fixture must run from the isolated E2E package.')
}
fs.mkdirSync(config.runRoot, { recursive: true })
fs.mkdirSync(path.join(config.runRoot, 'profile'), { recursive: true })
app.setPath('userData', path.join(config.runRoot, 'profile'))
// Only electron-updater's cache is redirected; the isolated NSIS identity has its own registry key.
process.env.LOCALAPPDATA = path.join(config.runRoot, 'cache')
remote.initialize()
let win
let installRequested = false
let finishing = false

function record(kind, info){
    fs.appendFileSync(path.join(config.runRoot, 'events.jsonl'), `${JSON.stringify({ time: new Date().toISOString(), pid: process.pid, version: app.getVersion(), kind, info })}\n`)
}

function fail(error){
    const info = { message: String(error?.message || error), stack: error?.stack || '', version: app.getVersion() }
    record('failure', info)
    fs.writeFileSync(path.join(config.runRoot, 'failure.json'), JSON.stringify(info, null, 2))
    app.exit(1)
}

process.on('uncaughtException', fail)
process.on('unhandledRejection', fail)
const logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, message => record(`log:${level}`, String(message))]))
const controller = createUpdaterController({ autoUpdater, logger, notify(event, info){
    record(event, info)
    if(win && !win.webContents.isDestroyed()){
        win.webContents.send('autoUpdateNotification', event, info)
    }
} })
autoUpdater.installDirectory = config.installDirectory
const nativeQuitAndInstall = autoUpdater.quitAndInstall.bind(autoUpdater)
autoUpdater.quitAndInstall = (isSilent, isForceRunAfter) => {
    record('native-install-arguments', { isSilent, isForceRunAfter, harnessSilentOverride: true })
    if(isSilent !== false || isForceRunAfter !== true){
        throw new Error('Production controller install arguments changed unexpectedly.')
    }
    // The production action is tested above. This sole harness override avoids an unattended NSIS wizard.
    nativeQuitAndInstall(true, true)
}

ipcMain.on('autoUpdateAction', (event, action) => {
    record('ipc-action', action)
    if(action === 'initAutoUpdater'){
        controller.initialize()
        event.sender.send('autoUpdateNotification', 'ready')
        controller.replay()
    } else if(action === 'checkForUpdate'){
        controller.check()
    } else if(action === 'installUpdateNow'){
        if(installRequested){
            return fail(new Error('Duplicate installation request.'))
        }
        installRequested = true
        controller.install()
    }
})

ipcMain.handle('e2e-observation', async (event, observation) => {
    if(event.sender !== win.webContents){
        throw new Error('Unexpected E2E renderer.')
    }
    record('dom', observation)
    if(observation.error){
        fail(new Error(observation.error))
        return
    }
    if(observation.screenshot){
        await Promise.race([win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'), new Promise(resolve => setTimeout(resolve, 250))])
        await new Promise(resolve => setTimeout(resolve, 75))
        const capture = await win.webContents.capturePage()
        fs.writeFileSync(path.join(config.runRoot, `${observation.screenshot}.png`), capture.toPNG())
    }
    if(observation.complete && !finishing){
        finishing = true
        if(app.getVersion() !== config.targetVersion || !app.getPath('exe').startsWith(config.installDirectory)){
            return fail(new Error('The target did not reopen from the isolated install directory.'))
        }
        const result = { status: 'passed', baselineVersion: config.baselineVersion, installedVersion: app.getVersion(), executable: app.getPath('exe'), pid: process.pid, installDirectory: config.installDirectory, controllerSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'app/assets/js/updatercontroller.js'))).digest('hex'), reopenMode: process.argv.includes('--updater-e2e-explicit-reopen') ? 'explicit-harness-reopen' : 'native-nsis-reopen', boundary: 'Real NSIS installation and electron-updater, generic localhost feed, extracted production updater DOM/functions. The installer silent flag is overridden in this fixture. If NSIS shell reopening is unavailable, the harness explicitly opens the verified installed target.' }
        fs.writeFileSync(path.join(config.runRoot, 'result.json'), JSON.stringify(result, null, 2))
        setTimeout(() => app.quit(), 250)
    }
})

app.whenReady().then(async () => {
    record('started', { packaged: app.isPackaged, executable: app.getPath('exe'), arguments: process.argv, baselineVersion: config.baselineVersion, targetVersion: config.targetVersion })
    const priorResult = path.join(config.runRoot, 'result.json')
    if(app.getVersion() === config.targetVersion && fs.existsSync(priorResult) && JSON.parse(fs.readFileSync(priorResult, 'utf8')).status === 'passed'){
        record('late-reopen-after-completion', { arguments: process.argv })
        app.quit()
        return
    }
    win = new BrowserWindow({ show: false, width: 980, height: 650, backgroundColor: '#171614', webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } })
    remote.enable(win.webContents)
    win.webContents.on('render-process-gone', (_event, details) => fail(new Error(`Renderer exited: ${details.reason}`)))
    await win.loadFile(path.join(__dirname, 'app/updater-e2e.html'))
}).catch(fail)

app.on('window-all-closed', () => app.quit())
