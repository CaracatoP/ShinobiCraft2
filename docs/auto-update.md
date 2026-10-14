# Auto-update — investigação e correção 1.0.4

## Causa raiz

A release pública `v1.0.3` contém `ShinobiCraft2.Launcher-setup-1.0.3.exe`, mas seu `latest.yml` aponta, tanto em `files[0].url` quanto em `path`, para `ShinobiCraft2-Launcher-setup-1.0.3.exe`.

As requisições verificadas em 14/10/2026 retornaram:

| Recurso | HTTP |
| --- | --- |
| `latest.yml` | 200 |
| EXE com hífen indicado no manifesto | **404** |
| EXE com ponto publicado na release | 200 |

O SHA256 dos três arquivos locais 1.0.3 corresponde aos digests dos assets públicos. A inspeção local do YAML representa, portanto, o arquivo publicado. O `GitHubProvider` do `electron-updater` 6.7.3 resolve o nome do manifesto e apenas troca espaços por hífen; não converte hífen em ponto. O HTTP 200 do asset com ponto não prova que o arquivo requisitado pelo updater está disponível.

O defeito de transporte fica oculto por dois defeitos de interface: `index.js` enviava somente `message` e `stack`, enquanto `uicore.js` ignorava `realerror` sem `code`. Mesmo os erros com `code` não restauravam o botão. A UI entrava em “Downloading...” ao receber `update-available`, e não tinha handler de `download-progress`.

Também não havia guarda contra listeners registrados novamente por `initAutoUpdater`, nem contra intervalos criados novamente em cada `ready`. O feed de release notes e o download manual macOS ainda apontavam para Helios.

## Fluxo corrigido

1. `showMainUI` solicita `initAutoUpdater` pelo IPC existente.
2. `index.js` mantém o renderer atual e inicializa um único controller. `ready` cria um único intervalo de 30 minutos e solicita o check inicial.
3. O controller registra os eventos uma vez e impede checks/downloads concorrentes. Checks posteriores preservam uma atualização já pronta.
4. `checking-for-update` atualiza a aba Updates. `update-not-available` volta à versão instalada e não abre aviso.
5. `update-available` informa a versão e abre um aviso não modal, uma vez por versão por sessão: **Nova atualização disponível**, **Ver atualização**, **Continuar**. A navegação abre Settings → Updates.
6. No Windows, com `autoDownload=false`, o handler inicia explicitamente `downloadUpdate(token)`. Não existe um segundo caminho de download automático.
7. `disableDifferentialDownload=true`, suportado pela versão instalada, seleciona o EXE completo no NSIS. A mesma aba mostra porcentagem com uma casa decimal e bytes convertidos para MB; o aviso acompanha o estado sem bloquear o launcher.
8. `update-downloaded` muda para **Atualização pronta** e habilita **Instalar agora**. Somente o clique chama `quitAndInstall(false, true)`.
9. Qualquer `error` ou rejeição de Promise vira `{code,message,stack}`. A falta de código recebe `ERR_UPDATER_UNKNOWN`. O renderer sai de Downloading, mostra **Falha ao atualizar** e habilita **Tentar novamente**.
10. Sem progresso durante 120 segundos, o controller cancela com `CancellationToken`, informa `ERR_UPDATER_DOWNLOAD_TIMEOUT` e aguarda a operação nativa terminar antes de permitir outro download. O watchdog mede eventos de progresso, inclusive períodos de validação do arquivo.

`autoInstallOnAppQuit=false`: fechar o launcher normalmente não instala uma atualização sem escolha explícita. Downloads concluídos continuam no cache nativo e são revalidados no próximo check. O macOS, cuja configuração atual gera apenas DMG, mantém instalação manual pela página de release do próprio projeto, sem adivinhar nome de asset.

## Cache e logs

O cache existente é `%LOCALAPPDATA%\shinobicraft2-launcher-updater`. A inspeção encontrou `installer.exe` (cópia normal do instalador anterior), `pending` vazio e nenhum `current.blockmap`. Não foi necessário limpar ou substituir o cache.

O `DownloadedUpdateHelper` nativo já compara SHA512 e descarta metadados/arquivos inconsistentes. Downloads com falha também usam a limpeza nativa. A correção não cria outro cache nem usa o instalador antigo para download diferencial.

Os eventos e erros ficam em `%APPDATA%\shinobicraft2-launcher\logs\updater.log`, conforme `app.getPath('userData')`, além do console. O progresso é limitado a aproximadamente um log a cada cinco segundos ou dez pontos percentuais. O caminho exato pode mudar conforme o perfil de execução. Erros preservam código, mensagem e stack. Recarregar o renderer restaura metadados e o último estado sem registrar novos listeners.

## Arquivos alterados

- `index.js`: integração do controller, destino IPC atual e log persistente.
- `app/assets/js/updatercontroller.js`: operação única, eventos, download completo explícito, normalização de erros, timeout e instalação.
- `app/assets/js/scripts/uicore.js`: estado comum do renderer, todos os eventos, aviso e ações.
- `app/assets/js/scripts/settings.js`: progresso/bytes, retry, pronto/instalando, estado preservado e release notes do projeto.
- `app/app.ejs`, `app/settings.ejs`, `app/assets/css/launcher.css`: aviso compacto e uma linha de status na aba existente.
- `app/assets/lang/en_US.toml`, `_custom.toml`: fallback inglês e mensagens do updater em português.
- `electron-builder.yml`: nome ASCII explícito do instalador e exclusão das ferramentas de teste do pacote.
- `package.json`, `package-lock.json`: próxima versão livre 1.0.4 e comandos de teste/validação. Os arquivos já tinham alterações locais para 1.0.3; nenhuma dependência foi trocada.
- `scripts/validate-update-release.js`, testes do updater e harness E2E: regressão e validação dos artefatos.
- `DESIGN.md`: registro do comportamento e dos donos da interface de update.

Login, autenticação, Minecraft, modpack, R2 e distribuição Nebula não foram alterados. As pastas auxiliares não precisaram de mudanças. Créditos de Helios permanecem.

## Build e preparação da release

```powershell
npm run test:updater
npm run dist:win -- --publish never
npm run release:validate
```

Nesta máquina, o npm está instalado fora do PATH padrão do terminal de execução:

```powershell
$env:Path = 'C:\Users\joaog\AppData\Local\nvm\v22.20.0;' + $env:Path
npm.cmd run dist:win -- --publish never
npm.cmd run release:validate
```

Arquivos para a futura release `v1.0.4`, com **estes nomes exatos**, sem renomear o EXE depois do build:

```text
dist/latest.yml
dist/ShinobiCraft2.Launcher-setup-1.0.4.exe
dist/ShinobiCraft2.Launcher-setup-1.0.4.exe.blockmap
dist/win-unpacked/resources/app-update.yml
```

O validador confere nomes do manifesto, versão, existência do EXE/blockmap, tamanho, SHA512 e configuração GitHub/cache no pacote. Executado contra a build antiga, rejeitou corretamente a divergência hífen/ponto; executado contra a 1.0.4, passou.

Nenhuma release existente foi sobrescrita. Nenhum push, tag ou publicação foi feito. O workflow atual publica ao receber push com `GH_TOKEN`; por isso o teste não usa push. Os launchers instalados continuam vendo a release pública antiga até a nova release ser publicada pelo usuário.

## Verificação

Os nove testes automatizados cobrem check inicial/periódico único, eventos e listeners sem duplicação, exclusão de downloads concorrentes, erro sem código, preservação de stack, retry, cancelamento por falta de progresso, replay após reload, interface sem aviso quando atualizada, aviso único por versão, navegação, progresso e instalação apenas por clique. Sintaxe passou; lint dos novos módulos, ferramentas, testes e scripts do renderer passou. EJS completo e ambos TOMLs foram validados.

O lint geral registra dois `;` preexistentes na autenticação em `index.js`, confirmados também em HEAD. A auditoria geral de UI registra o scrollbar global preexistente com somente propriedades WebKit. Esses pontos ficaram fora da correção, conforme o pedido de preservar autenticação e UI geral.

`Get-AuthenticodeSignature` do instalador 1.0.4 retorna `NotSigned`. A configuração não contém `publisherName`; a assinatura não é a causa deste bug.

O teste real isolado **1.0.4 → 1.0.5 passou**: baseline instalada por NSIS, descoberta automática, aviso visível com versão, abertura de Updates, um único download completo de 117.299.029 bytes, progresso até 100%, `update-downloaded`, título **Atualização pronta**, botão **Instalar agora**, pedido IPC de instalação, instalação da 1.0.5, abertura do executável instalado e check sem atualização/sem aviso. O pacote instalado também foi inspecionado: `package.json` dentro de `app.asar` confirma 1.0.5.

Evidências: `dist/updater-e2e/2026-10-14T05-03-24-365Z/result.json`, `validation.json`, `events.jsonl`, `http.jsonl` e `test-boundaries.json`. Houve um check da baseline, uma requisição de EXE, nenhuma requisição de blockmap, 28 eventos de progresso e um pedido de instalação. O controller de teste é o mesmo código de produção, com SHA256 `8659ab5cb4ca1fec3915f8a61e9b97be22f7135e72b0126a879477c5b81954ad`.

Limites explícitos: o provider do teste é HTTP `generic` em localhost, definido somente na configuração das duas builds de teste. O bootstrap exclui login/modpack/distribuição e usa o HTML e funções reais do updater. A chamada de produção `quitAndInstall(false,true)` foi recebida e validada; o harness troca apenas o primeiro argumento para `true`, para executar o NSIS sem um assistente interativo. O `--force-run` foi enviado ao NSIS, mas a reabertura não ocorreu dentro do prazo inicial do harness; ele abriu explicitamente o executável instalado para confirmar a versão nova. Uma segunda execução foi observada depois, quando o servidor de teste já estava encerrado; seu erro de conexão não altera a verificação anterior da instalação. A reabertura automática pelo shell normal do Windows ainda precisa de validação interativa.

Isso verifica o download, cache nativo, interface e instalação real. Não equivale a instalar uma release inédita publicada no GitHub. O teste público com a release corrigida continua pendente da publicação autorizada; os launchers de produção não receberão a correção enquanto a 1.0.4 não for publicada.

A matriz visual em Electron 39.2.7 também passou: nove capturas com pintura sincronizada para disponível, progresso, falha/retry, pronto/instalar e sem atualização; navegação com Tab/Enter, foco visível e janela de 420 px sem overflow. Evidências em `dist/updater-visual/2026-10-14T05-16-09-538Z/result.json`, `03-error.png`, `05-ready.png` e `06-ready-narrow-420.png`. Essa fixture usa o DOM, CSS e funções do updater sem modificar a fonte de produção; seus eventos são simulados para observar todos os estados. As capturas imediatas do primeiro E2E podiam mostrar o frame anterior, por isso a avaliação visual usa esta matriz sincronizada e a avaliação funcional do E2E usa seus registros de DOM/eventos.

Após a verificação, o desinstalador da identidade de teste terminou com código 0. A instalação de teste foi removida; builds e evidências permaneceram. O launcher de produção continua instalado na 1.0.2, e seu `installer.exe` no cache conserva o tamanho e a data observados antes dos testes.

Para repetir o teste isolado no Windows:

```powershell
node scripts/updater-e2e.js
```

Esse comando constrói e instala uma aplicação de teste com identidade própria (`ShinobiCraft2 Updater Test`) dentro de `dist/updater-e2e`, nunca publica, e deixa logs/artefatos para inspeção. Não altera a instalação/cache de produção.

Para repetir apenas a matriz visual, com perfil isolado e sem download/instalação:

```powershell
node_modules\electron\dist\electron.exe tests\updater-visual-main.js
```

## Trechos finais relevantes

`index.js` mantém o transporte e delega para uma única operação:

```js
function initAutoUpdater(event, data){
    updaterRenderer = event.sender
    autoUpdater.allowPrerelease = Boolean(data) || semver.prerelease(app.getVersion()) != null
    if(isDev){
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    updaterController.initialize()
    event.sender.send('autoUpdateNotification', 'ready')
    updaterController.replay()
}
// checkForUpdate -> updaterController.check()
// installUpdateNow -> updaterController.install()
```

O controller usado pelo main:

```js
autoUpdater.autoDownload = false
autoUpdater.disableDifferentialDownload = true
autoUpdater.autoInstallOnAppQuit = false
// update-available -> download(info), com uma Promise e um CancellationToken
// download(info) -> autoUpdater.downloadUpdate(downloadToken)
// error/catch -> normalizeUpdaterError(error) -> IPC realerror
// install() requer snapshot.event === 'update-downloaded'
autoUpdater.quitAndInstall(false, true)
```

`uicore.js` trata progresso, conclusão e qualquer erro:

```js
case 'download-progress':
    launcherUpdateState.status = 'downloading'
    launcherUpdateState.progress = info
    break
case 'update-downloaded':
    launcherUpdateState.status = 'downloaded'
    launcherUpdateState.info = info || launcherUpdateState.info
    launcherUpdateState.error = null
    showUpdateUI('downloaded')
    break
case 'realerror':
    loggerAutoUpdater.error('Error during update.', info)
    launcherUpdateState.status = 'error'
    launcherUpdateState.error = info || {message: 'Unknown updater error'}
    launcherUpdateState.progress = null
    showUpdateUI('error')
    break
// Após a transição:
renderSettingsUpdateState()
renderUpdateNotice()
```

`settings.js` reaproveita o botão existente:

```js
case 'downloading': {
    const text = percent == null
        ? Lang.queryJS('settings.updates.downloadingButton')
        : Lang.queryJS('settings.updates.downloadingProgressButton', {percent})
    settingsUpdateButtonStatus(text, true)
    break
}
case 'downloaded':
    settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.installNowButton'), false, installLauncherUpdate)
    break
case 'error':
    settingsUpdateButtonStatus(Lang.queryJS('settings.updates.retryButton'), false, requestLauncherUpdateCheck)
    break
```
