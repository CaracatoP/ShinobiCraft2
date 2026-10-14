const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const { createUpdaterController, normalizeUpdaterError } = require('../app/assets/js/updatercontroller')

const release = { version: '1.0.5', files: [{ url: 'ShinobiCraft2.Launcher-setup-1.0.5.exe' }] }
const tick = () => new Promise(resolve => setImmediate(resolve))

function fixture(options = {}){
    const updater = new EventEmitter()
    const events = []
    const logs = []
    updater.checkForUpdates = async () => {
        updater.emit('checking-for-update')
        updater.emit('update-available', release)
    }
    updater.downloadUpdate = async () => {}
    updater.quitAndInstall = (...args) => { updater.installArgs = args }
    const controller = createUpdaterController({
        autoUpdater: updater,
        notify: (event, info) => events.push({ event, info }),
        logger: Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, text => logs.push({ level, text })])),
        platform: 'win32',
        ...options
    })
    return { updater, controller, events, logs }
}

test('initialization is idempotent; startup/download/install follow one operation', async () => {
    const { updater, controller, events, logs } = fixture()
    let downloads = 0
    let finish
    updater.downloadUpdate = () => {
        downloads++
        return new Promise(resolve => { finish = resolve })
    }
    controller.initialize()
    controller.initialize()
    assert.equal(updater.listenerCount('update-available'), 1)
    assert.equal(updater.listenerCount('error'), 1)
    assert.equal(updater.autoDownload, false)
    assert.equal(updater.disableDifferentialDownload, true)
    assert.equal(updater.autoInstallOnAppQuit, false)
    const check = controller.check()
    assert.equal(controller.check(), check)
    await check
    await tick()
    assert.equal(downloads, 1)
    updater.emit('download-progress', { percent: 37.4, transferred: 42100000, total: 112100000 })
    controller.check()
    assert.equal(downloads, 1)
    updater.emit('update-downloaded', release)
    finish(['installer.exe'])
    await tick()
    await controller.check()
    assert.equal(downloads, 1)
    assert.equal(events.at(-1).event, 'update-downloaded')
    assert.ok(events.some(item => item.event === 'download-progress' && item.info.percent === 37.4))
    controller.install()
    assert.deepEqual(updater.installArgs, [false, true])
    assert.equal(logs.filter(item => item.text === '[Updater] initialized').length, 1)
})

test('error without code is preserved once; retry performs a fresh download', async () => {
    const { updater, controller, events } = fixture()
    const error = new Error('404: wrong installer asset name')
    let attempts = 0
    updater.downloadUpdate = async () => {
        attempts++
        if(attempts === 1){
            updater.emit('error', error)
            throw error
        }
        updater.emit('update-downloaded', release)
        return ['installer.exe']
    }
    await controller.check()
    await tick()
    const errors = events.filter(item => item.event === 'realerror')
    assert.equal(errors.length, 1)
    assert.equal(errors[0].info.code, 'ERR_UPDATER_UNKNOWN')
    assert.equal(errors[0].info.message, error.message)
    assert.equal(errors[0].info.stack, error.stack)
    await controller.check()
    await tick()
    assert.equal(attempts, 2)
    assert.equal(events.at(-1).event, 'update-downloaded')
})

test('stalled transfer leaves downloading, cancels, and releases the retry guard', async () => {
    const { updater, controller, events } = fixture({ downloadIdleTimeout: 20 })
    let token
    updater.downloadUpdate = cancellationToken => {
        token = cancellationToken
        return cancellationToken.createPromise(() => {})
    }
    await controller.check()
    await delay(50)
    assert.equal(token.cancelled, true)
    assert.equal(events.at(-1).event, 'realerror')
    assert.equal(events.at(-1).info.code, 'ERR_UPDATER_DOWNLOAD_TIMEOUT')
    updater.emit('download-progress', { percent: 50, transferred: 5, total: 10 })
    assert.equal(events.at(-1).event, 'realerror')
    updater.downloadUpdate = async () => updater.emit('update-downloaded', release)
    await controller.check()
    await tick()
    assert.equal(events.at(-1).event, 'update-downloaded')
})

test('no update and failed checks both exit checking and allow later checks', async () => {
    const { updater, controller, events } = fixture()
    let checks = 0
    updater.checkForUpdates = async () => {
        checks++
        updater.emit('checking-for-update')
        if(checks === 1){
            const error = Object.assign(new Error('Offline'), { code: 'ENOTFOUND' })
            updater.emit('error', error)
            throw error
        }
        updater.emit('update-not-available', { version: '1.0.4' })
    }
    await controller.check()
    assert.equal(events.at(-1).event, 'realerror')
    assert.equal(events.at(-1).info.code, 'ENOTFOUND')
    await controller.check()
    assert.equal(events.at(-1).event, 'update-not-available')
    assert.equal(checks, 2)
})

test('renderer reconnect restores release metadata before progress', async () => {
    const { updater, controller, events } = fixture()
    let finish
    updater.downloadUpdate = () => new Promise(resolve => { finish = resolve })
    await controller.check()
    updater.emit('download-progress', { percent: 10, total: 10, transferred: 1 })
    events.length = 0
    controller.replay()
    assert.deepEqual(events.map(item => item.event), ['update-available', 'download-progress'])
    assert.equal(events[0].info.version, '1.0.5')
    updater.emit('update-downloaded', release)
    finish([])
    await tick()
})

test('installation requires a complete verified file and unknown errors remain visible', () => {
    const { updater, controller, logs, events } = fixture()
    controller.initialize()
    controller.install()
    assert.equal(updater.installArgs, undefined)
    assert.equal(events.at(-1).info.code, 'ERR_UPDATER_NOT_DOWNLOADED')
    assert.deepEqual(normalizeUpdaterError('failure'), { code: 'ERR_UPDATER_UNKNOWN', message: 'failure', stack: '' })
    assert.equal(logs.filter(item => item.level === 'error').length, 1)
})
