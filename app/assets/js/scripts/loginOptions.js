const loginOptionsCancelContainer = document.getElementById('loginOptionCancelContainer')
const loginOptionMicrosoft = document.getElementById('loginOptionMicrosoft')
const loginOptionMojang = document.getElementById('loginOptionMojang')
const loginOptionsCancelButton = document.getElementById('loginOptionCancelButton')

let loginOptionsCancellable = false

let loginOptionsViewOnLoginSuccess
let loginOptionsViewOnLoginCancel
let loginOptionsViewOnCancel
let loginOptionsViewCancelHandler

function loginOptionsCancelEnabled(val){
    if(val){
        $(loginOptionsCancelContainer).show()
    } else {
        $(loginOptionsCancelContainer).hide()
    }
}

loginOptionMicrosoft.onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
        ipcRenderer.send(
            MSFT_OPCODE.OPEN_LOGIN,
            loginOptionsViewOnLoginSuccess,
            loginOptionsViewOnLoginCancel
        )
    })
}

loginOptionMojang.onclick = (e) => {
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        loginViewOnSuccess = loginOptionsViewOnLoginSuccess
        loginViewOnCancel = loginOptionsViewOnLoginCancel
        loginCancelEnabled(true)
    })
}

loginOptionsCancelButton.onclick = (e) => {
    switchView(getCurrentView(), loginOptionsViewOnCancel, 500, 500, () => {
        // Clear login values (Mojang login)
        // No cleanup needed for Microsoft.
        resetOfflineLogin()
        loginUsername.value = ''
        loginPassword.value = ''
        if(loginOptionsViewCancelHandler != null){
            loginOptionsViewCancelHandler()
            loginOptionsViewCancelHandler = null
        }
    })
}
const offlineLoginForm = document.getElementById('offlineLoginForm')
const offlineNick = document.getElementById('offlineNick')
const offlineLoginError = document.getElementById('offlineLoginError')
const loginOptionOffline = document.getElementById('loginOptionOffline')
let offlineLoginPending = false

function resetOfflineLogin() {
    offlineNick.value = ''
    offlineNick.removeAttribute('aria-invalid')
    offlineLoginError.textContent = ''
}

offlineNick.addEventListener('keydown', (event) => {
    if(event.key === 'Enter' && event.isComposing) event.preventDefault()
})

offlineNick.addEventListener('input', () => {
    offlineNick.removeAttribute('aria-invalid')
    offlineLoginError.textContent = ''
})

offlineLoginForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if(event.isComposing || offlineLoginPending) return
    const name = offlineNick.value.trim()
    if(!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
        offlineNick.setAttribute('aria-invalid', 'true')
        offlineLoginError.textContent = Lang.queryJS('loginOptions.offlineInvalidNick')
        offlineNick.focus()
        return
    }
    offlineLoginPending = true
    offlineLoginForm.setAttribute('aria-busy', 'true')
    const controls = [offlineNick, loginOptionOffline, loginOptionMicrosoft, loginOptionMojang, loginOptionsCancelButton]
    controls.forEach(control => { control.disabled = true })
    loginOptionOffline.textContent = Lang.queryJS('loginOptions.offlineLoggingIn')
    const finishOfflineLogin = () => {
        offlineLoginPending = false
        offlineLoginForm.removeAttribute('aria-busy')
        controls.forEach(control => { control.disabled = false })
        loginOptionOffline.textContent = Lang.queryJS('loginOptions.playOffline')
    }
    try {
        const account = await AuthManager.createOfflineUser(name)
        updateSelectedAccount(account)
        const destination = loginOptionsViewOnLoginSuccess || VIEWS.landing
        switchView(getCurrentView(), destination, 500, 500, async () => {
            resetOfflineLogin()
            finishOfflineLogin()
            if(destination === VIEWS.settings) await prepareSettings()
            loginOptionsViewOnLoginSuccess = VIEWS.landing
            loginOptionsViewCancelHandler = null
            loginOptionsCancelEnabled(false)
        })
    } catch(_err) {
        finishOfflineLogin()
        offlineLoginError.textContent = Lang.queryJS('loginOptions.offlineLoginFailed')
        offlineNick.focus()
    }
})
