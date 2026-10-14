/**
 * Core UI functions are initialized in this file. This prevents
 * unexpected errors from breaking the core features. Specifically,
 * actions in this file should not require the usage of any internal
 * modules, excluding dependencies.
 */
// Requirements
const $                              = require('jquery')
const {ipcRenderer, shell, webFrame} = require('electron')
const remote                         = require('@electron/remote')
const isDev                          = require('./assets/js/isdev')
const { LoggerUtil }                 = require('helios-core')
const Lang                           = require('./assets/js/langloader')

const loggerUICore             = LoggerUtil.getLogger('UICore')
const loggerAutoUpdater        = LoggerUtil.getLogger('AutoUpdater')

// Log deprecation and process warnings.
process.traceProcessWarnings = true
process.traceDeprecation = true

// Disable eval function.
window.eval = global.eval = function () {
    throw new Error('Sorry, this app does not support window.eval().')
}

// Display warning when devtools window is opened.
remote.getCurrentWebContents().on('devtools-opened', () => {
    console.log('%cThe console is dark and full of terrors.', 'color: white; -webkit-text-stroke: 4px #a02d2a; font-size: 60px; font-weight: bold')
    console.log('%cIf you\'ve been told to paste something here, you\'re being scammed.', 'font-size: 16px')
    console.log('%cUnless you know exactly what you\'re doing, close this window.', 'font-size: 16px')
})

// Disable zoom, needed for darwin.
webFrame.setZoomLevel(0)
webFrame.setVisualZoomLevelLimits(1, 1)

// Initialize auto updates in production environments.
let updateCheckListener
const launcherUpdateState = {status: 'idle', info: null, progress: null, error: null}
const shownUpdateNotices = new Set()
if(!isDev){
    ipcRenderer.on('autoUpdateNotification', (event, arg, info) => {
        handleAutoUpdateNotification(arg, info)
    })
}

function handleAutoUpdateNotification(arg, info){
    switch(arg){
        case 'checking-for-update':
            loggerAutoUpdater.info('Checking for update..')
            launcherUpdateState.status = 'checking'
            launcherUpdateState.error = null
            break
        case 'update-available':
            loggerAutoUpdater.info('New update available', info && info.version)
            launcherUpdateState.status = 'available'
            launcherUpdateState.info = info
            launcherUpdateState.progress = null
            launcherUpdateState.error = null
            showUpdateUI('available')
            break
        case 'download-started':
            launcherUpdateState.status = 'downloading'
            launcherUpdateState.info = info || launcherUpdateState.info
            launcherUpdateState.error = null
            break
        case 'download-progress':
            launcherUpdateState.status = 'downloading'
            launcherUpdateState.progress = info
            // Accept a version when present; main replays release info before progress.
            if(info && info.version){
                launcherUpdateState.info = {...launcherUpdateState.info, version: info.version}
            }
            break
        case 'update-downloaded':
            loggerAutoUpdater.info('Update ready to be installed.', info && info.version)
            launcherUpdateState.status = 'downloaded'
            launcherUpdateState.info = info || launcherUpdateState.info
            launcherUpdateState.error = null
            showUpdateUI('downloaded')
            break
        case 'update-not-available':
            loggerAutoUpdater.info('No new update found.')
            launcherUpdateState.status = 'latest'
            launcherUpdateState.info = null
            launcherUpdateState.progress = null
            launcherUpdateState.error = null
            hideUpdateNotice()
            break
        case 'ready':
            if(updateCheckListener == null){
                updateCheckListener = setInterval(() => {
                    ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                }, 1800000)
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
            }
            return
        case 'realerror':
            loggerAutoUpdater.error('Error during update.', info)
            launcherUpdateState.status = 'error'
            launcherUpdateState.error = info || {message: 'Unknown updater error'}
            launcherUpdateState.progress = null
            showUpdateUI('error')
            break
        default:
            loggerAutoUpdater.info('Unknown argument', arg)
            return
    }
    renderSettingsUpdateState()
    renderUpdateNotice()
}

function requestLauncherUpdateCheck(){
    if(isDev){
        return
    }
    launcherUpdateState.status = 'checking'
    launcherUpdateState.error = null
    renderSettingsUpdateState()
    renderUpdateNotice()
    ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
}

function installLauncherUpdate(){
    if(isDev || launcherUpdateState.status !== 'downloaded'){
        return
    }
    launcherUpdateState.status = 'installing'
    renderSettingsUpdateState()
    renderUpdateNotice()
    ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
}

/**
 * Send a notification to the main process changing the value of
 * allowPrerelease. If we are running a prerelease version, then
 * this will always be set to true, regardless of the current value
 * of val.
 * 
 * @param {boolean} val The new allow prerelease value.
 */
function changeAllowPrerelease(val){
    ipcRenderer.send('autoUpdateAction', 'allowPrereleaseChange', val)
}

function openLauncherUpdateTab(){
    hideUpdateNotice()
    const openTab = () => settingsNavItemListener(document.getElementById('settingsNavUpdate'), false)
    if(getCurrentView() === VIEWS.settings){
        openTab()
    } else {
        switchView(getCurrentView(), VIEWS.settings, 500, 500, openTab)
    }
}

function showUpdateUI(kind){
    const version = launcherUpdateState.info && launcherUpdateState.info.version
    if(kind !== 'error'){
        const key = `launcher-update-notice:${kind}:${version}`
        try {
            if(shownUpdateNotices.has(key) || window.sessionStorage.getItem(key)){
                return
            }
            window.sessionStorage.setItem(key, 'shown')
        } catch(err){
            // The in-memory guard still prevents duplicates when storage is unavailable.
            if(shownUpdateNotices.has(key)){
                return
            }
        }
        shownUpdateNotices.add(key)
    }
    document.getElementById('updaterNotice').hidden = false
}

function hideUpdateNotice(){
    document.getElementById('updaterNotice').hidden = true
}

function renderUpdateNotice(){
    const notice = document.getElementById('updaterNotice')
    if(notice.hidden){
        return
    }
    const state = launcherUpdateState
    const ready = state.status === 'downloaded' || state.status === 'installing'
    const failed = state.status === 'error'
    const checking = state.status === 'checking'
    const version = state.info && state.info.version
    setUpdateNoticeText('updaterNoticeTitle', Lang.queryJS(`settings.updates.${failed ? 'failedTitle' : checking ? 'checkingForUpdatesButton' : ready ? 'readyTitle' : 'newReleaseTitle'}`))
    const manual = state.info && state.info.manualDownloadUrl
    setUpdateNoticeText('updaterNoticeMessage', checking ? Lang.queryJS('settings.updates.retryingMessage') : Lang.queryJS(`uicore.autoUpdate.${failed ? 'failedMessage' : ready ? 'readyMessage' : manual ? 'manualAvailableMessage' : 'availableMessage'}`, {version: version || remote.app.getVersion()}))
    const percent = settingsUpdateProgressPercent()
    setUpdateNoticeText('updaterNoticeDetail', `${state.status === 'downloading' && percent != null ? `${percent}% · ` : ''}${settingsUpdateStatusText()}`)
    const action = document.getElementById('updaterNoticeAction')
    action.onclick = null
    action.disabled = state.status === 'installing' || state.status === 'checking'
    action.textContent = Lang.queryJS(failed ? 'settings.updates.retryButton' : ready ? 'uicore.autoUpdate.installNowButton' : 'uicore.autoUpdate.viewUpdateButton')
    if(!action.disabled){
        action.onclick = failed ? requestLauncherUpdateCheck : ready ? installLauncherUpdate : openLauncherUpdateTab
    }
    document.getElementById('updaterNoticeDismiss').onclick = hideUpdateNotice
}

function setUpdateNoticeText(id, text){
    const element = document.getElementById(id)
    if(element.textContent !== text){
        element.textContent = text
    }
}

/* jQuery Example
$(function(){
    loggerUICore.info('UICore Initialized');
})*/

document.addEventListener('readystatechange', function () {
    if (document.readyState === 'interactive'){
        loggerUICore.info('UICore Initializing..')

        // Bind close button.
        Array.from(document.getElementsByClassName('fCb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.close()
            })
        })

        // Bind restore down button.
        Array.from(document.getElementsByClassName('fRb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                if(window.isMaximized()){
                    window.unmaximize()
                } else {
                    window.maximize()
                }
                document.activeElement.blur()
            })
        })

        // Bind minimize button.
        Array.from(document.getElementsByClassName('fMb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.minimize()
                document.activeElement.blur()
            })
        })

        // Remove focus from social media buttons once they're clicked.
        Array.from(document.getElementsByClassName('mediaURL')).map(val => {
            val.addEventListener('click', e => {
                document.activeElement.blur()
            })
        })

    } else if(document.readyState === 'complete'){

        //266.01
        //170.8
        //53.21
        // Bind progress bar length to length of bot wrapper
        //const targetWidth = document.getElementById("launch_content").getBoundingClientRect().width
        //const targetWidth2 = document.getElementById("server_selection").getBoundingClientRect().width
        //const targetWidth3 = document.getElementById("launch_button").getBoundingClientRect().width

        document.getElementById('launch_details').style.maxWidth = 266.01
        document.getElementById('launch_progress').style.width = 170.8
        document.getElementById('launch_details_right').style.maxWidth = 170.8
        document.getElementById('launch_progress_label').style.width = 53.21
        
    }

}, false)

/**
 * Open web links in the user's default browser.
 */
$(document).on('click', 'a[href^="http"]', function(event) {
    event.preventDefault()
    shell.openExternal(this.href)
})

/**
 * Opens DevTools window if you hold (ctrl + shift + i).
 * This will crash the program if you are using multiple
 * DevTools, for example the chrome debugger in VS Code. 
 */
document.addEventListener('keydown', function (e) {
    if((e.key === 'I' || e.key === 'i') && e.ctrlKey && e.shiftKey){
        let window = remote.getCurrentWindow()
        window.toggleDevTools()
    }
})
