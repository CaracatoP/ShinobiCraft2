// Appended after the actual updater sections from uicore.js/settings.js in the packaged fixture.
/* global ipcRenderer, remote, launcherUpdateState, settingsUpdateProgressPercent, document */
let e2eAvailable = false
let e2eProgress = false
let e2eCompleted = false
const e2eConfig = require('../e2e-config.json')

function e2eAssert(condition, message){
    if(!condition){
        throw new Error(message)
    }
}

ipcRenderer.on('autoUpdateNotification', async (_event, action, info) => {
    try {
        const notice = document.getElementById('updaterNotice')
        const button = document.getElementById('settingsUpdateActionButton')
        const detail = document.getElementById('settingsUpdateDetail')
        const observe = observation => ipcRenderer.invoke('e2e-observation', { action, ...observation })
        if(action === 'update-available' && !e2eAvailable){
            e2eAvailable = true
            e2eAssert(info.version === e2eConfig.targetVersion, 'Wrong update version.')
            e2eAssert(!notice.hidden, 'Available notification is hidden.')
            e2eAssert(document.getElementById('updaterNoticeMessage').textContent.includes(info.version), 'Available notification is missing the version.')
            await observe({ screenshot: '01-available', notice: notice.innerText, version: info.version })
            document.getElementById('updaterNoticeAction').click()
            e2eAssert(document.getElementById('settingsTabUpdate').style.display !== 'none', 'View update did not open Updates.')
            e2eAssert(notice.hidden, 'View update did not dismiss the notification.')
            await observe({ openedUpdates: true })
        } else if(action === 'download-progress' && info.percent > 0 && info.percent < 100 && !e2eProgress){
            e2eProgress = true
            e2eAssert(button.textContent.includes(`${settingsUpdateProgressPercent()}%`), 'Download percentage is missing.')
            e2eAssert(/\d+\.\d MB \/ \d+\.\d MB/.test(detail.textContent), 'Downloaded/total MB are missing.')
            await observe({ screenshot: '02-progress', percent: info.percent, button: button.textContent, detail: detail.textContent })
        } else if(action === 'update-downloaded' && !e2eCompleted){
            e2eCompleted = true
            e2eAssert(e2eAvailable && e2eProgress, 'The available/progress path was not observed.')
            e2eAssert(launcherUpdateState.status === 'downloaded', 'Renderer did not become ready.')
            e2eAssert(!button.disabled && typeof button.onclick === 'function', 'Install button is unavailable.')
            await observe({ screenshot: '03-downloaded', button: button.textContent, title: document.getElementById('settingsUpdateTitle').textContent, percent: launcherUpdateState.progress?.percent })
            button.click()
            e2eAssert(launcherUpdateState.status === 'installing', 'Install click did not transition the renderer.')
        } else if(action === 'update-not-available' && remote.app.getVersion() === e2eConfig.targetVersion){
            e2eAssert(notice.hidden, 'No-update result notified the user.')
            await observe({ screenshot: '04-installed', complete: true, installedVersion: remote.app.getVersion(), title: document.getElementById('settingsUpdateTitle').textContent })
        } else if(action === 'realerror'){
            await observe({ error: `${info.code}: ${info.message}` })
        }
    } catch(error){
        await ipcRenderer.invoke('e2e-observation', { error: String(error.message || error) })
    }
})

ipcRenderer.send('autoUpdateAction', 'initAutoUpdater')
ipcRenderer.send('autoUpdateAction', 'initAutoUpdater')
