// Windows-only integration test. Builds/installs a separate application; never publishes.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { Transform } = require('node:stream')
const Module = require('node:module')
const ejs = require('ejs')
const asar = require('@electron/asar')
const Lang = require('../app/assets/js/langloader')

const workspace = path.resolve(__dirname, '..')
const runRoot = path.join(workspace, 'dist', 'updater-e2e', new Date().toISOString().replace(/[:.]/g, '-'))
const project = path.join(runRoot, 'project')
const installDirectory = path.join(runRoot, 'installed')
const appId = 'shinobicraft2-updater-e2e'
const productName = 'ShinobiCraft2 Updater Test'
const baselineVersion = '1.0.4'
const targetVersion = '1.0.5'
let feedDirectory
let server

function writeJson(filename, value){
    fs.writeFileSync(filename, JSON.stringify(value, null, 2))
}

function section(source, start, end){
    const startIndex = source.indexOf(start)
    const endIndex = source.indexOf(end, startIndex)
    if(startIndex < 0 || endIndex < 0){
        throw new Error(`Production updater section changed: ${start}`)
    }
    return source.slice(startIndex, endIndex)
}

function copyProductionDependencies(dependencies){
    const copied = new Set()
    const pending = Object.keys(dependencies).map(name => ({ name, from: workspace, optional: false }))
    const sourceRoot = path.join(workspace, 'node_modules')
    while(pending.length){
        const { name, from, optional } = pending.pop()
        const source = Module._nodeModulePaths(from).map(directory => path.join(directory, name)).find(directory => fs.existsSync(path.join(directory, 'package.json')))
        if(!source){
            if(optional){ continue }
            throw new Error(`Missing test dependency ${name} required from ${from}`)
        }
        if(copied.has(source)){ continue }
        copied.add(source)
        const destination = path.join(project, 'node_modules', path.relative(sourceRoot, source))
        fs.cpSync(source, destination, { recursive: true, filter: filename => path.basename(filename) !== 'node_modules' })
        const dependency = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
        for(const child of Object.keys(dependency.dependencies || {})){
            pending.push({ name: child, from: source, optional: false })
        }
        for(const child of Object.keys(dependency.optionalDependencies || {})){
            pending.push({ name: child, from: source, optional: true })
        }
    }
}

function command(executable, args, logName, timeout = 300000){
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(path.join(runRoot, logName), { flags: 'a' })
        const child = spawn(executable, args, { cwd: project, windowsHide: true, env: { ...process.env, ELECTRON_IS_DEV: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
        child.stdout.on('data', chunk => { output.write(chunk); process.stdout.write(chunk) })
        child.stderr.on('data', chunk => { output.write(chunk); process.stderr.write(chunk) })
        const timer = setTimeout(() => { child.kill(); reject(new Error(`${logName} timed out.`)) }, timeout)
        child.on('error', error => { clearTimeout(timer); output.end(); reject(error) })
        child.on('exit', code => {
            clearTimeout(timer)
            output.end()
            if(code === 0){ resolve() } else { reject(new Error(`${logName} exited ${code}.`)) }
        })
    })
}

function startFeed(){
    return new Promise(resolve => {
        server = http.createServer((request, response) => {
            const name = path.basename(decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
            const filename = feedDirectory && path.join(feedDirectory, name)
            fs.appendFileSync(path.join(runRoot, 'http.jsonl'), `${JSON.stringify({ time: new Date().toISOString(), method: request.method, url: request.url, filename })}\n`)
            if(!filename || !fs.existsSync(filename)){
                response.writeHead(404)
                response.end('No such test artifact')
                return
            }
            response.writeHead(200, { 'Content-Length': fs.statSync(filename).size, 'Content-Type': name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream', 'Cache-Control': 'no-store' })
            if(request.method === 'HEAD'){
                response.end()
                return
            }
            const source = fs.createReadStream(filename, { highWaterMark: 65536 })
            // Ensure intermediate progress is observed even with a fast loopback interface.
            if(name.endsWith('.exe')){
                source.pipe(new Transform({ transform(chunk, encoding, callback){ setTimeout(() => callback(null, chunk), 5) } })).pipe(response)
            } else {
                source.pipe(response)
            }
        })
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
    })
}

function prepareRenderer(){
    const core = fs.readFileSync(path.join(project, 'app/assets/js/scripts/uicore.js'), 'utf8').replace(/\r\n/g, '\n')
    const settings = fs.readFileSync(path.join(project, 'app/assets/js/scripts/settings.js'), 'utf8').replace(/\r\n/g, '\n')
    const appMarkup = fs.readFileSync(path.join(project, 'app/app.ejs'), 'utf8')
    const settingsMarkup = fs.readFileSync(path.join(project, 'app/settings.ejs'), 'utf8')
    const notice = section(appMarkup, '<section id="updaterNotice"', '</section>') + '</section>'
    const updateTab = settingsMarkup.slice(settingsMarkup.indexOf('<div id="settingsTabUpdate"'), settingsMarkup.indexOf('    <script src="./assets/js/scripts/settings.js"'))
    Lang.setupLanguage()
    const html = ejs.render(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Updater E2E</title><link rel="stylesheet" href="assets/css/launcher.css"><style>body{background:#171614;margin:32px;color:#eee}#settingsTabUpdate{display:block!important;position:static!important;opacity:1!important;height:auto!important;width:750px!important}#updaterNotice{position:fixed;right:24px;top:24px}#e2eHeading{margin-bottom:24px}</style></head><body><h1 id="e2eHeading">ShinobiCraft2 Updater Test</h1><button id="settingsNavUpdate">Updates</button>${updateTab}${notice}<script src="updater-e2e-renderer.js"></script></body></html>`, { lang: Lang.queryEJS })
    const bootstrap = 'const { ipcRenderer, shell } = require(\'electron\')\nconst remote = require(\'@electron/remote\')\nconst Lang = require(\'./assets/js/langloader\')\nLang.setupLanguage()\nconst semver = require(\'semver\')\nconst isDev = require(\'./assets/js/isdev\')\nconst loggerAutoUpdater = console\nconst VIEWS = { settings: \'#settings\' }\nlet e2eView = \'#landing\'\nfunction getCurrentView(){ return e2eView }\nfunction switchView(current, next, a, b, done){ e2eView = next; done() }\nfunction settingsNavItemListener(){ document.getElementById(\'settingsTabUpdate\').style.display = \'block\' }\n'
    const rendererSource = [bootstrap, section(core, '// Initialize auto updates', '/* jQuery Example'), section(settings, 'function isPrerelease(', '/**\n * Utility method'), section(settings, 'function populateVersionInformation(', '/**\n * Retrieve the version information'), section(settings, 'const settingsTabUpdate ', '/**\n * Settings preparation functions.'), fs.readFileSync(path.join(workspace, 'tests/updater-e2e-renderer.js'), 'utf8')].join('\n')
    fs.writeFileSync(path.join(project, 'app/updater-e2e.html'), html)
    fs.writeFileSync(path.join(project, 'app/updater-e2e-renderer.js'), rendererSource)
}

async function waitForResult(installedExe){
    const deadline = Date.now() + 240000
    let explicitlyReopened = false
    while(Date.now() < deadline){
        const failure = path.join(runRoot, 'failure.json')
        const result = path.join(runRoot, 'result.json')
        if(fs.existsSync(failure)){
            throw new Error(fs.readFileSync(failure, 'utf8'))
        }
        if(fs.existsSync(result)){
            return JSON.parse(fs.readFileSync(result, 'utf8'))
        }
        const eventFile = path.join(runRoot, 'events.jsonl')
        if(!explicitlyReopened && fs.existsSync(eventFile)){
            const events = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(line => JSON.parse(line))
            const install = events.find(event => event.kind === 'native-install-arguments')
            const reopened = events.some(event => event.kind === 'started' && event.version === targetVersion)
            if(install && !reopened && Date.now() - Date.parse(install.time) > 180000){
                let installedVersion
                try {
                    installedVersion = JSON.parse(asar.extractFile(path.join(installDirectory, 'resources/app.asar'), 'package.json').toString()).version
                } catch(_error){
                    // The installer may still be extracting its archive.
                }
                if(installedVersion === targetVersion){
                    explicitlyReopened = true
                    fs.appendFileSync(eventFile, `${JSON.stringify({ time: new Date().toISOString(), kind: 'harness-reopen', info: 'NSIS installed the target; the harness explicitly reopens it because shell auto-launch did not occur.' })}\n`)
                    spawn(installedExe, ['--updater-e2e-explicit-reopen'], { cwd: installDirectory, windowsHide: true, stdio: 'ignore' }).on('error', error => writeJson(failure, { message: error.message }))
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('The isolated updater did not install and reopen the target within four minutes.')
}

async function main(){
    if(process.platform !== 'win32'){
        throw new Error('This real NSIS integration test requires Windows.')
    }
    fs.mkdirSync(project, { recursive: true })
    fs.cpSync(path.join(workspace, 'app'), path.join(project, 'app'), { recursive: true })
    fs.cpSync(path.join(workspace, 'build'), path.join(project, 'build'), { recursive: true })
    fs.copyFileSync(path.join(workspace, 'tests/updater-e2e-main.js'), path.join(project, 'e2e-main.js'))
    const feedUrl = await startFeed()
    writeJson(path.join(project, 'e2e-config.json'), { appId, runRoot, installDirectory, baselineVersion, targetVersion })
    const originalPackage = require('../package.json')
    const packageInfo = { ...originalPackage, name: appId, productName, version: baselineVersion, main: 'e2e-main.js', scripts: {} }
    writeJson(path.join(project, 'package.json'), packageInfo)
    copyProductionDependencies(packageInfo.dependencies)
    prepareRenderer()
    const builderCli = path.join(workspace, 'node_modules/electron-builder/cli.js')
    const builderConfig = { appId, productName, electronVersion: require('../node_modules/electron/package.json').version, artifactName: 'ShinobiCraft2.Updater.Test-setup-${version}.${ext}', asar: true, compression: 'normal', npmRebuild: false, files: ['**/*', '!build/**/*'], directories: { buildResources: 'build' }, win: { icon: 'build/icon.ico', target: [{ target: 'nsis', arch: 'x64' }], signAndEditExecutable: false }, nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false }, publish: { provider: 'generic', url: feedUrl } }
    console.log(`E2E evidence: ${runRoot}`)
    for(const version of [baselineVersion, targetVersion]){
        packageInfo.version = version
        writeJson(path.join(project, 'package.json'), packageInfo)
        const output = path.join(runRoot, version)
        writeJson(path.join(project, 'electron-builder.json'), { ...builderConfig, directories: { ...builderConfig.directories, output } })
        await command(process.execPath, [builderCli, '--projectDir', project, '--config', path.join(project, 'electron-builder.json'), '--win', 'nsis', '--x64', '--publish', 'never'], `build-${version}.log`)
        if(version === targetVersion){ feedDirectory = output }
    }
    writeJson(path.join(runRoot, 'test-boundaries.json'), { identity: appId, productName, feedUrl, installDirectory, baselineVersion, targetVersion, boundaries: ['Real electron-updater and NSIS installers; same controller and updater renderer code copied at build time.', 'Generic localhost feed replaces GitHub only through builder publish configuration.', 'Unrelated launcher boot/login/modpack is excluded by a dedicated fixture entrypoint.', 'Controller install arguments false,true are asserted; the test then uses native quitAndInstall(true,true) for unattended NSIS.', 'NSIS may register only this dedicated test identity and store its dedicated prior-installer cache in LocalAppData.'] })
    const baselineInstaller = path.join(runRoot, baselineVersion, `ShinobiCraft2.Updater.Test-setup-${baselineVersion}.exe`)
    await command(baselineInstaller, ['/S', `/D=${installDirectory}`], 'baseline-install.log', 120000)
    const installedExe = path.join(installDirectory, `${productName}.exe`)
    if(!fs.existsSync(installedExe)){
        throw new Error(`Baseline installation is absent: ${installedExe}`)
    }
    const child = spawn(installedExe, [], { cwd: installDirectory, windowsHide: true, detached: false, stdio: 'ignore' })
    child.on('error', error => writeJson(path.join(runRoot, 'failure.json'), { message: error.message }))
    const result = await waitForResult(installedExe)
    console.log(JSON.stringify(result, null, 2))
}

main().catch(error => {
    console.error(error.stack || error)
    process.exitCode = 1
}).finally(() => {
    server?.closeAllConnections()
    server?.close()
})
