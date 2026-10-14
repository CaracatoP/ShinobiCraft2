// Own one updater operation at a time. electron-updater owns files and cache validation.
const { CancellationToken } = require('electron-updater')

function normalizeUpdaterError(error){
    return {
        code: String(error?.code || 'ERR_UPDATER_UNKNOWN'),
        message: String(error?.message || error || 'Unknown updater error'),
        stack: typeof error?.stack === 'string' ? error.stack : ''
    }
}

function createUpdaterController({ autoUpdater, notify, logger = console, platform = process.platform, downloadIdleTimeout = 120000 }){
    let initialized = false
    let checkPromise = null
    let downloadPromise = null
    let downloadToken = null
    let downloadTimer = null
    let downloadTimedOut = false
    let updateInfo = null
    let snapshot = null
    let reportedErrors = new WeakSet()
    let lastProgressLog = 0
    let lastProgressPercent = -10

    function publish(event, info){
        snapshot = { event, info }
        notify(event, info)
    }

    function clearDownloadTimer(){
        clearTimeout(downloadTimer)
        downloadTimer = null
    }

    function reportError(error){
        if(error && typeof error === 'object'){
            if(reportedErrors.has(error)){
                return
            }
            reportedErrors.add(error)
        }
        clearDownloadTimer()
        const info = normalizeUpdaterError(error)
        logger.error(`[Updater] ERROR\ncode: ${info.code}\nmessage: ${info.message}\nstack: ${info.stack}`)
        publish('realerror', info)
    }

    function armDownloadTimer(){
        clearDownloadTimer()
        downloadTimer = setTimeout(() => {
            downloadTimedOut = true
            const error = new Error(`Update download made no progress for ${downloadIdleTimeout / 1000} seconds. Please try again.`)
            error.code = 'ERR_UPDATER_DOWNLOAD_TIMEOUT'
            reportError(error)
            downloadToken.cancel()
        }, downloadIdleTimeout)
        downloadTimer.unref?.()
    }

    function download(info){
        if(downloadPromise || snapshot?.event === 'update-downloaded'){
            return downloadPromise
        }
        downloadToken = new CancellationToken()
        downloadTimedOut = false
        lastProgressLog = 0
        lastProgressPercent = -10
        logger.info('[Updater] starting full download')
        publish('download-started', info)
        armDownloadTimer()
        // Assign our guard before calling the library, including a synchronous error/event.
        downloadPromise = Promise.resolve().then(() => autoUpdater.downloadUpdate(downloadToken))
            .catch(error => {
                if(!downloadTimedOut){
                    reportError(error)
                }
            })
            .finally(() => {
                clearDownloadTimer()
                downloadToken.dispose()
                downloadToken = null
                downloadPromise = null
            })
        return downloadPromise
    }

    function initialize(){
        if(initialized){
            return
        }
        initialized = true
        autoUpdater.autoDownload = false
        autoUpdater.disableDifferentialDownload = true
        // Installation only follows the user's Install now action, including on normal quit.
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.logger = logger

        autoUpdater.on('checking-for-update', () => {
            logger.info('[Updater] checking')
            publish('checking-for-update')
        })
        autoUpdater.on('update-available', info => {
            updateInfo = info
            logger.info(`[Updater] update available: ${info.version}`)
            publish('update-available', info)
            // The macOS build ships only a DMG; preserve its existing manual installation.
            if(platform !== 'darwin'){
                download(info)
            }
        })
        autoUpdater.on('download-progress', progress => {
            if(downloadTimedOut || snapshot?.event === 'realerror'){
                return
            }
            armDownloadTimer()
            const now = Date.now()
            if(now - lastProgressLog >= 5000 || progress.percent - lastProgressPercent >= 10 || progress.percent >= 100){
                logger.info(`[Updater] ${progress.percent.toFixed(1)}%`)
                lastProgressLog = now
                lastProgressPercent = progress.percent
            }
            publish('download-progress', progress)
        })
        autoUpdater.on('update-downloaded', info => {
            if(downloadTimedOut){
                return
            }
            clearDownloadTimer()
            updateInfo = info
            logger.info('[Updater] download complete')
            publish('update-downloaded', info)
        })
        autoUpdater.on('update-not-available', info => {
            logger.info(`[Updater] no update available: ${info.version}`)
            updateInfo = null
            publish('update-not-available', info)
        })
        autoUpdater.on('error', reportError)
        autoUpdater.on('update-cancelled', () => {
            if(!downloadTimedOut){
                const error = new Error('Update download was cancelled. Please try again.')
                error.code = 'ERR_UPDATER_DOWNLOAD_CANCELLED'
                reportError(error)
            }
        })
        logger.info('[Updater] initialized')
    }

    function replay(){
        if(snapshot){
            // Progress does not contain the release version. Restore metadata first on reload.
            if(updateInfo && !['update-available', 'update-downloaded'].includes(snapshot.event)){
                notify('update-available', updateInfo)
            }
            notify(snapshot.event, snapshot.info)
        }
    }

    function check(){
        initialize()
        if(checkPromise || downloadPromise){
            replay()
            return checkPromise || downloadPromise
        }
        if(snapshot?.event === 'update-downloaded'){
            replay()
            return Promise.resolve()
        }
        reportedErrors = new WeakSet()
        checkPromise = Promise.resolve().then(() => autoUpdater.checkForUpdates())
            .catch(reportError)
            .finally(() => {
                checkPromise = null
            })
        return checkPromise
    }

    function install(){
        if(snapshot?.event !== 'update-downloaded'){
            const error = new Error('The update is not ready to install.')
            error.code = 'ERR_UPDATER_NOT_DOWNLOADED'
            reportError(error)
            return
        }
        logger.info('[Updater] install requested')
        try {
            autoUpdater.quitAndInstall(false, true)
        } catch(error){
            reportError(error)
        }
    }

    return { initialize, check, install, replay }
}

module.exports = { createUpdaterController, normalizeUpdaterError }
