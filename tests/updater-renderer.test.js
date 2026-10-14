const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Lang = require('../app/assets/js/langloader')
Lang.setupLanguage()

function renderer(){
    const elements = new Map()
    function element(id){
        if(!elements.has(id)){
            elements.set(id, { textContent: '', innerHTML: '', hidden: id === 'updaterNotice', disabled: false, onclick: null, style: {}, attributes: {},
                setAttribute(key, value){ this.attributes[key] = value },
                removeAttribute(key){ delete this.attributes[key] },
                getElementsByClassName(name){ return [element(name)] }
            })
        }
        return elements.get(id)
    }
    const sends = []
    const intervals = []
    const navigation = []
    const storage = new Map()
    let view = '#landing'
    const context = vm.createContext({
        document: { getElementById: element },
        window: { sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
        Lang, isDev: false,
        loggerAutoUpdater: { info(){}, error(){} },
        ipcRenderer: { on(){}, send: (...args) => sends.push(args) },
        remote: { app: { getVersion: () => '1.0.4' } },
        shell: { openExternal: url => navigation.push(url) },
        isPrerelease: () => false,
        setInterval: (handler, duration) => { intervals.push({ handler, duration }); return intervals.length },
        VIEWS: { settings: '#settings' },
        getCurrentView: () => view,
        switchView: (current, next, a, b, handler) => { view = next; handler() },
        settingsNavItemListener: item => navigation.push(item)
    })
    const core = fs.readFileSync(path.join(__dirname, '../app/assets/js/scripts/uicore.js'), 'utf8').replace(/\r\n/g, '\n')
    vm.runInContext(core.slice(core.indexOf('// Initialize auto updates'), core.indexOf('/* jQuery Example')), context)
    const settings = fs.readFileSync(path.join(__dirname, '../app/assets/js/scripts/settings.js'), 'utf8').replace(/\r\n/g, '\n')
    vm.runInContext(settings.slice(settings.indexOf('function populateVersionInformation('), settings.indexOf('/**\n * Retrieve the version information')), context)
    vm.runInContext(settings.slice(settings.indexOf('const settingsTabUpdate '), settings.indexOf('/**\n * Settings preparation functions.')), context)
    return { elements, element, sends, intervals, navigation, context,
        emit: (event, info) => context.handleAutoUpdateNotification(event, info),
        state: () => vm.runInContext('launcherUpdateState', context)
    }
}

test('startup check/30 minute timer runs once and no-update stays quiet', () => {
    const ui = renderer()
    ui.emit('ready')
    ui.emit('ready')
    assert.equal(ui.intervals.length, 1)
    assert.equal(ui.intervals[0].duration, 1800000)
    assert.deepEqual(ui.sends, [['autoUpdateAction', 'checkForUpdate']])
    ui.emit('checking-for-update')
    ui.emit('update-not-available', { version: '1.0.4' })
    assert.equal(ui.element('updaterNotice').hidden, true)
    assert.equal(ui.element('settingsUpdateActionButton').disabled, false)
    assert.equal(ui.state().status, 'latest')
})

test('available notices once, opens Updates, and real progress survives tab preparation', () => {
    const ui = renderer()
    const info = { version: '1.0.5', releaseNotes: 'Correção do updater' }
    ui.emit('update-available', info)
    assert.equal(ui.element('updaterNotice').hidden, false)
    assert.match(ui.element('updaterNoticeTitle').textContent, /Nova atualização disponível/)
    assert.match(ui.element('updaterNoticeMessage').textContent, /1\.0\.5/)
    ui.element('updaterNoticeAction').onclick()
    assert.equal(ui.navigation.at(-1), ui.element('settingsNavUpdate'))
    assert.equal(ui.element('updaterNotice').hidden, true)
    ui.emit('update-available', info)
    assert.equal(ui.element('updaterNotice').hidden, true)
    ui.emit('download-started', info)
    ui.emit('download-progress', { percent: 37.4, transferred: 42.1 * 1048576, total: 112.1 * 1048576 })
    assert.match(ui.element('settingsUpdateActionButton').textContent, /37\.4%/)
    assert.equal(ui.element('settingsUpdateDetail').textContent, '42.1 MB / 112.1 MB')
    ui.context.prepareUpdateTab()
    assert.equal(ui.state().status, 'downloading')
    assert.match(ui.element('settingsUpdateActionButton').textContent, /37\.4%/)
    assert.equal(ui.element('settingsUpdateActionButton').onclick, null)
})

test('any error exits downloading and exposes retry; downloaded only installs on click', () => {
    const ui = renderer()
    const info = { version: '1.0.5' }
    ui.emit('update-available', info)
    ui.emit('download-started', info)
    ui.emit('realerror', { message: 'HTTP 404', stack: 'Error: HTTP 404' })
    assert.equal(ui.state().status, 'error')
    assert.equal(ui.element('settingsUpdateTitle').textContent, 'Falha ao atualizar')
    assert.equal(ui.element('settingsUpdateActionButton').textContent, 'Tentar novamente')
    assert.equal(ui.element('settingsUpdateActionButton').disabled, false)
    ui.element('settingsUpdateActionButton').onclick()
    assert.deepEqual(ui.sends.at(-1), ['autoUpdateAction', 'checkForUpdate'])
    ui.emit('download-started', info)
    ui.emit('update-downloaded', info)
    assert.equal(ui.element('settingsUpdateTitle').textContent, 'Atualização pronta')
    assert.equal(ui.element('settingsUpdateActionButton').textContent, 'Instalar agora')
    assert.equal(ui.sends.some(args => args[1] === 'installUpdateNow'), false)
    ui.element('settingsUpdateActionButton').onclick()
    assert.deepEqual(ui.sends.at(-1), ['autoUpdateAction', 'installUpdateNow'])
    assert.equal(ui.element('settingsUpdateActionButton').disabled, true)
    ui.context.installLauncherUpdate()
    assert.equal(ui.sends.filter(args => args[1] === 'installUpdateNow').length, 1)
})
