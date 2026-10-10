window.__ModuleLoader__.load({
  id: 'dsh-computer-use-safe-win',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const STATUS = '/api/computer-use-safe-win/status'
    const INSTALL = '/api/computer-use-safe-win/install'
    const REGISTRY_SETUP = '/api/computer-use-safe-win/registry-setup'
    const CANDIDATES = '/api/computer-use-safe-win/running-apps'
    const REQUIREMENTS = '/api/computer-use-safe-win/requirements'
    /** The package providing the exclusive computer-use provider registry. */
    const REQUIRED_PACKAGE = '@deepseek-ai/dsh-computer-use'
    const VALIDATE = '/api/computer-use-safe-win/validate-config'
    const LOCALE_NS = 'computerUseSafeWin'
    const CONFIG_ID = 'computer-use-safe-win'
    const PACKAGE_NAME = 'dsh-computer-use-safe-win'
    // Kept in lockstep with package.json by `test/client-bundle.test.js`: the
    // section has no build step that could inject the manifest's version.
    const PLUGIN_VERSION = '0.1.15'
    const EXECUTABLE_NAME = /^[\w.-]{1,128}\.exe$/i
    const EXECUTABLE_PATH = /^[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n]+[\\/])*[^\\/:*?"<>|\r\n]+\.exe$/i
    const TEXT = {
      zh: { nav: '电脑操控', title: 'Cua Driver', registryTitle: '未挂载独占注册表（可选）', registryBody: '本插件可独立运行。若在 profile 里挂载 @deepseek-ai/dsh-computer-use，本插件会自动取得独占槽位，避免与其它 computer-use 提供者同时控制桌面；该包没有 bundle patch，DSH 插件管理器无法安装，只能在 profile 的 cordis.patch.yml 里手动挂载。', statusUnknown: '驱动状态未知（Host 半未激活）', hostInactive: 'Host 半未激活或路由不可用', driverStatus: '受管驱动状态', driverNote: '安装与来源', registryInexact: '未发布与当前 DSH 完全同版本的构建，这里取同版本线最新；它可能要求不同的 dsh-brand。', registryUnverified: '（未查询到 npm 版本列表，直接采用当前 DSH 版本；若该构建未发布，安装会明确报错。）', registryResolved: '版本解析', registrySetupFailed: '无法读取挂载步骤', registryFallback: 'dsh plugin --profile <你的 profile 名> add @deepseek-ai/dsh-computer-use', registryStep1: '① 安装该包（版本按当前 DSH 解析，未写死）', registryStep2: '② 在 profile 的 cordis.patch.yml 中加入这一条（也可用右上角「打开配置文件」）', copy: '复制', copied: '已复制', intro: '先安装受管驱动并确认状态。安装不会开启桌面观察；保存配置也不会绕过平台、驱动或白名单检查。', test: '刷新驱动状态', refresh: '正在检查…', checked: '状态已刷新', install: '安装驱动', confirm: '从 trycua 官方发行版下载并安装固定版本驱动？', busy: '正在安装…', absent: '未安装', ready: '受管驱动已安装（未启动验证）', unsupported: '当前系统不支持', version: '受管版本', expected: '目标版本', error: '请求失败', remote: '仅本机浏览器允许安装；远程连接请在主机本机打开设置页。', configTitle: '观察配置', configIntro: '只有白名单里的应用才能被列举和观察。每一项可以是可执行文件名（如 notepad.exe，更宽松）或绝对路径（如 C:\\Program Files\\App\\app.exe，更精确）。保存后立即对后续调用生效，无需重启。请只添加可信应用。', enabled: '启用窗口观察', allowlist: '允许的应用白名单', addApp: '添加应用', removeApp: '删除', appPlaceholder: 'notepad.exe 或 C:\\Program Files\\App\\app.exe', emptyList: '白名单为空；启用观察前至少添加一个应用。', pickApp: '从运行中的应用选择', picking: '正在读取…', candidatesTitle: '正在运行的应用', candidatesEmpty: '没有可添加的应用。', candidatesNote: '有路径时默认添加绝对路径，更精确；没有路径的应用只能按文件名添加。', add: '添加', save: '保存配置', saving: '正在保存…', loading: '正在读取 Host 配置…', unavailable: 'Host 配置不可用；请在本机设置页重试。', readonly: '当前连接不可写。请使用 DSH 主机本机浏览器修改持久配置。', saved: 'Host 已接受配置并完成持久化；对后续调用立即生效。', invalid: '请检查配置', disabled: '观察功能已关闭。', enabledStatus: '观察功能已启用；运行时及驱动仍需单独验证。', configError: '配置保存失败或发生版本冲突；请刷新页面后重试。' },
      en: { nav: 'Computer Use', title: 'Cua Driver', registryTitle: 'Exclusive registry not mounted (optional)', registryBody: 'This plugin runs standalone. Mount @deepseek-ai/dsh-computer-use in the profile and this plugin takes the exclusive computer-use slot, so a second provider can never share the desktop. That package ships no bundle patch, so the DSH plugin manager cannot install it; mount it in the profile cordis.patch.yml.', statusUnknown: 'Driver status unknown (Host half inactive)', hostInactive: 'The Host half is not active or its routes are unavailable', driverStatus: 'Managed driver status', driverNote: 'Installation and origin', registryInexact: 'No build matches this exact DSH version, so the newest sibling of the same release line is offered; it may require a different dsh-brand.', registryUnverified: '(the published version list could not be read, so the running DSH version is used as-is; installation fails loudly if that build was never published.)', registryResolved: 'Version resolution', registrySetupFailed: 'Could not read the mounting steps', registryFallback: 'dsh plugin --profile <your profile> add @deepseek-ai/dsh-computer-use', registryStep1: '1. Install the package (the version is resolved from the running DSH, never pinned here)', registryStep2: '2. Add this row to the profile cordis.patch.yml (the header button "Open config file" works too)', copy: 'Copy', copied: 'Copied', intro: 'Install and verify the managed driver status. Installation never enables observation; saving configuration does not bypass platform, driver, or allowlist checks.', test: 'Refresh driver status', refresh: 'Checking…', checked: 'Status refreshed', install: 'Install driver', confirm: 'Download and install the pinned driver from the official trycua release?', busy: 'Installing…', absent: 'Not installed', ready: 'Managed driver installed (runtime not tested)', unsupported: 'Unsupported system', version: 'Managed version', expected: 'Target version', error: 'Request failed', remote: 'Installation is restricted to the local browser; open settings on the Host.', configTitle: 'Observation settings', configIntro: 'Only allowlisted applications can be listed or observed. Each entry is either an executable filename (notepad.exe, broader) or an absolute path (C:\\Program Files\\App\\app.exe, stricter). A save applies to later calls without a restart. Add only trusted applications.', enabled: 'Enable window observation', allowlist: 'Allowed applications', addApp: 'Add application', removeApp: 'Remove', appPlaceholder: 'notepad.exe or C:\\Program Files\\App\\app.exe', emptyList: 'The allowlist is empty; add at least one application before enabling observation.', pickApp: 'Choose a running application', picking: 'Reading…', candidatesTitle: 'Running applications', candidatesEmpty: 'No application is available to add.', candidatesNote: 'Applications that report a path are added by absolute path, which is stricter. The rest can only be added by filename.', add: 'Add', save: 'Save settings', saving: 'Saving…', loading: 'Loading Host settings…', unavailable: 'Host settings are unavailable; retry from the local settings page.', readonly: 'This connection cannot write persistent settings. Use the Host’s local browser.', saved: 'Host accepted and persisted the settings; they apply to later calls at once.', invalid: 'Check the settings', disabled: 'Observation is disabled.', enabledStatus: 'Observation is enabled; runtime and driver behavior still require separate verification.', configError: 'Settings save failed or conflicted; reload the page and retry.' },
    }

    /**
     * The allowlist entry one row becomes, checked here so an obvious typo is
     * reported before the round-trip. The Host re-checks the same forms and owns
     * the decision; this only saves the user a failed save.
     */
    function entryFor(value) {
      const trimmed = value.trim().replace(/\//g, '\\')
      if (!trimmed) return undefined
      if (EXECUTABLE_PATH.test(trimmed)) {
        if (trimmed.split(/[\\/]/).some(segment => segment === '..')) throw new Error(`path must not contain ..: ${trimmed}`)
        return trimmed.toLowerCase()
      }
      if (!EXECUTABLE_NAME.test(trimmed)) throw new Error(`not an executable filename or absolute path: ${trimmed}`)
      return trimmed.toLowerCase()
    }

    /**
     * The section's own stylesheet.
     *
     * The shell owns the page chrome, so this only paints the recipes the panel
     * shares with the other settings sections: a content column of group cards
     * (l2 hairline, 16px radius, layer-3 fill), title/description rows with
     * hairline separators, a 36x20 switch, and quiet buttons. Every paint comes
     * from a `--dsw-alias-*` token, with a literal fallback so the panel still
     * reads on a shell that predates a token. Class names are prefixed `cu-` so
     * they cannot collide with the shell or another plugin.
     */
    const STYLES = `
.cu-section { display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 760px; box-sizing: border-box; }
.cu-intro { margin: 0; padding: 0 2px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary, #8b98a9); }
.cu-versionBadge { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; padding: 4px 10px; border: 1px solid var(--dsw-alias-border-l2, #2c3442); border-radius: 999px; background: var(--dsw-alias-bg-layer-2, #161b22); font-size: 12px; line-height: 18px; }
.cu-versionName { color: var(--dsw-alias-label-secondary, #b6c2d1); }
.cu-versionTag { padding: 1px 8px; border-radius: 999px; background: var(--dsw-alias-accent-soft, var(--dsw-alias-bg-layer-3, #1c222b)); color: var(--dsw-alias-label-tertiary, #8b98a9); font-variant-numeric: tabular-nums; }
.cu-group { display: flex; flex-direction: column; gap: 8px; padding: 20px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2, #2c3442); border-radius: 16px; background: var(--dsw-alias-bg-layer-3, #1c222b); }
.cu-groupHeading { padding: 0 2px 6px; font-size: 13px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary, #e6edf3); }
.cu-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 2px; border-bottom: 1px solid var(--dsw-alias-border-l2, #2c3442); }
.cu-row:last-child { border-bottom: none; }
.cu-rowEnd { justify-content: flex-end; }
.cu-rowStack { flex-direction: column; align-items: stretch; gap: 8px; }
.cu-rowText { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cu-title { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary, #e6edf3); }
.cu-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, #8b98a9); }
.cu-paragraph { margin: 0; }
.cu-control { flex: none; display: flex; align-items: center; gap: 8px; }
.cu-form { display: flex; flex-direction: column; }
.cu-switch { position: relative; display: inline-flex; flex: none; cursor: pointer; }
.cu-switchInput { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; }
.cu-switchTrack { display: inline-flex; align-items: center; width: 36px; height: 20px; padding: 2px; box-sizing: border-box; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2, #2c3442); background: var(--dsw-alias-bg-layer-2, #161b22); transition: background 0.15s ease, border-color 0.15s ease; }
.cu-switchThumb { display: block; width: 14px; height: 14px; border-radius: 50%; background: var(--dsw-alias-label-tertiary, #8b98a9); transition: transform 0.15s ease, background 0.15s ease; }
.cu-switch:hover .cu-switchTrack { border-color: var(--dsw-alias-label-dimmed, #6b7683); }
.cu-switchInput:checked + .cu-switchTrack { border-color: var(--dsw-alias-button-primary-fill, #3b82f6); background: var(--dsw-alias-button-primary-fill, #3b82f6); }
.cu-switchInput:checked + .cu-switchTrack .cu-switchThumb { transform: translateX(16px); background: var(--dsw-alias-bg-layer-3, #1c222b); }
.cu-switchInput:focus-visible + .cu-switchTrack { outline: 2px solid var(--dsw-alias-state-business-primary, #3b82f6); outline-offset: 2px; }
.cu-button { padding: 5px 12px; border: 1px solid var(--dsw-alias-border-l2, #2c3442); border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #161b22); color: var(--dsw-alias-label-primary, #e6edf3); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; transition: background 0.12s ease, border-color 0.12s ease; }
.cu-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.06)); border-color: var(--dsw-alias-label-dimmed, #6b7683); }
.cu-button:disabled { opacity: 0.5; cursor: default; }
.cu-buttonPrimary { border-color: var(--dsw-alias-button-primary-fill, #3b82f6); background: var(--dsw-alias-button-primary-fill, #3b82f6); color: var(--dsw-alias-button-primary-label, #ffffff); }
.cu-buttonPrimary:hover:not(:disabled) { border-color: var(--dsw-alias-button-primary-fill, #3b82f6); background: var(--dsw-alias-button-primary-fill, #3b82f6); filter: brightness(1.08); }
.cu-input { flex: 1 1 auto; min-width: 0; box-sizing: border-box; padding: 5px 10px; border: 1px solid var(--dsw-alias-border-l2, #2c3442); border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #161b22); color: var(--dsw-alias-label-primary, #e6edf3); font: inherit; font-size: 13px; line-height: 20px; }
.cu-input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #3b82f6); outline-offset: 1px; }
.cu-input:disabled { opacity: 0.55; }
.cu-appList { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.cu-appRow { display: flex; align-items: center; gap: 8px; }
.cu-candidateList { max-height: 240px; overflow-y: auto; }
.cu-candidateName { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, #b6c2d1); }
.cu-candidates { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2, #2c3442); border-radius: 12px; }
.cu-candidates p { margin: 0; }
.cu-setup { gap: 10px; padding-top: 4px; }
.cu-code { margin: 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2, #2c3442); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.18)); color: var(--dsw-alias-label-secondary, #b6c2d1); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 18px; white-space: pre-wrap; word-break: break-all; }
.cu-notice { margin: 0; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2, #2c3442); border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #161b22); color: var(--dsw-alias-label-secondary, #b6c2d1); font-size: 12px; line-height: 18px; }
`
    const STYLE_ID = 'dsh-computer-use-safe-win: section styles'

    /**
     * Add the section stylesheet to the document once.
     *
     * A client half has no stylesheet of its own in this plugin, and the panel
     * renders inside a shell the plugin does not own, so the rules travel with
     * the module and are installed on first apply.
     */
    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLES
      document.head.appendChild(style)
    }

    /**
     * Convert the edited rows into the allowlist the Host will validate.
     *
     * @param {string[]} rows - Current editor rows, one entry each.
     * @returns {string[]} Normalized, deduplicated entries in editor order.
     */
    function normalizeRows(rows) {
      const entries = []
      for (const row of rows) {
        const entry = entryFor(row)
        if (entry !== undefined && !entries.includes(entry)) entries.push(entry)
      }
      return entries
    }

    // The renderer supplies `t` as a translation function for the registered
    // locale namespace, not as a dictionary of translated values.
    //
    // `configForms` and `pluginManager` are handed in by the apply closure rather
    // than read from `ctx` here: a slot child receives neither the registering
    // plugin's Cordis injection context nor its services.
    function DriverSettings({ t, configForms, pluginManager }) {
      const [status, setStatus] = React.useState(null)
      const [statusKnown, setStatusKnown] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [checking, setChecking] = React.useState(false)
      const [configBusy, setConfigBusy] = React.useState(false)
      const [candidates, setCandidates] = React.useState(null)
      const [candidatesBusy, setCandidatesBusy] = React.useState(false)
      const [registry, setRegistry] = React.useState(null)
      const [setup, setSetup] = React.useState(null)
      const [setupError, setSetupError] = React.useState('')
      const [copied, setCopied] = React.useState('')
      const [draftRows, setDraftRows] = React.useState(null)
      const [draftEnabled, setDraftEnabled] = React.useState(null)
      const formRef = React.useRef(null)
      formRef.current ??= configForms?.get(CONFIG_ID)
      const form = formRef.current
      const config = React.useSyncExternalStore(
        listener => form?.subscribe(listener) ?? (() => {}),
        () => form?.getSnapshot() ?? { status: 'unavailable', value: undefined, writable: false, mode: 'host' },
        () => form?.getSnapshot() ?? { status: 'unavailable', value: undefined, writable: false, mode: 'host' },
      )
      // `remote.pluginManager` is a Remote namespace: the client mounts it as its
      // own Cordis plugin after the connection is up, so the apply closure cannot
      // capture it and the panel subscribes to the adopted value instead.
      const manager = React.useSyncExternalStore(pluginManager.subscribe, pluginManager.get, pluginManager.get)
      async function request(path, options) {
        const response = await fetch(path, { credentials: 'same-origin', ...options })
        const body = await response.text()
        let value
        try { value = JSON.parse(body) } catch { value = undefined }
        if (!response.ok) throw new Error(value?.error || (response.status === 404 ? t('hostInactive') : `${t('error')} (HTTP ${response.status})`))
        if (value === undefined) throw new Error(`${t('error')} (HTTP ${response.status})`)
        return value
      }
      async function test() {
        setChecking(true)
        setError('')
        setNotice('')
        try { setStatus(await request(STATUS)); setNotice(t('checked')) }
        catch (cause) { setStatus(null); setError(String(cause.message || cause)) }
        finally { setStatusKnown(true); setChecking(false) }
      }
      React.useEffect(() => { void test() }, [])
      /**
       * Ask the Host's plugin manager whether the exclusive provider registry is
       * installed.
       *
       * This deliberately does not go through a Host route: the registry is an
       * optional add-on, and the plugin manager is a separate Host service that
       * answers exactly this question.
       */
      React.useEffect(() => {
        if (manager === undefined) { setRegistry(null); return }
        let live = true
        void (async () => {
          const result = await manager.listBundles()
          if (live) setRegistry({ installed: result.ok && result.value.some(bundle => bundle.name === REQUIRED_PACKAGE) })
        })().catch(() => { if (live) setRegistry({ installed: false }) })
        return () => { live = false }
      }, [manager])
      React.useEffect(() => {
        setDraftRows(null)
        setDraftEnabled(null)
      }, [config.revision])
      /**
       * Read the two mounting steps once the plugin manager confirms the registry
       * is missing. The Host resolves the version from the running DSH, so the
       * panel never shows a pin that goes stale.
       */
      React.useEffect(() => {
        if (registry?.installed !== false) { setSetup(null); setSetupError(''); return }
        let live = true
        void (async () => {
          // A failure here is reported, never swallowed: an unanswered route is
          // exactly what a stale Host half looks like from the panel.
          try {
            const value = await request(REGISTRY_SETUP)
            if (live) { setSetup(value); setSetupError('') }
          } catch (cause) {
            if (live) { setSetup(null); setSetupError(String(cause.message || cause)) }
          }
        })()
        return () => { live = false }
      }, [registry])
      /**
       * Copy one mounting step to the clipboard. The panel offers the command
       * rather than running it: the Host plugin manager rolls a bundle-less
       * install back, and a plugin must not write the profile's patch layer.
       */
      async function copy(label, value) {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(label)
        } catch (cause) { setError(String(cause.message || cause)) }
      }

      /**
       * Download and install the pinned Cua Driver into the managed directory.
       * The Host refuses this unless the request comes from the local browser.
       */
      async function install() {
        if (!window.confirm(t('confirm'))) return
        setBusy(true)
        setError('')
        try {
          await request(INSTALL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-computer-use-confirm': 'install-pinned-driver' }, body: '{}' })
          await test()
        } catch (cause) { setError(String(cause.message || cause)) }
        finally { setBusy(false) }
      }
      /**
       * Read the running applications the Host can see, so entries can be picked
       * instead of typed. Read-only: it lists processes and adds nothing.
       */
      async function pickRunning() {
        setCandidatesBusy(true)
        setError('')
        try { setCandidates((await request(CANDIDATES)).applications ?? []) }
        catch (cause) { setError(String(cause.message || cause)); setCandidates([]) }
        finally { setCandidatesBusy(false) }
      }
      /**
       * Append one picked application, by absolute path when the Host reported
       * one, otherwise by its executable filename.
       *
       * @param {{ name: string, path?: string }} app - Picked running application.
       */
      function addCandidate(app) {
        const entry = app.path ?? app.name
        setDraftRows([...rows, entry])
      }
      async function saveConfig(event) {
        event.preventDefault()
        // The disabled button does not cover a second Enter-key submit.
        if (configBusy) return
        setConfigBusy(true)
        setError('')
        setNotice('')
        try {
          const allowedApps = normalizeRows(rows)
          const enabled = draftEnabled ?? Boolean(event.currentTarget.elements.enabled.checked)
          if (enabled && allowedApps.length === 0) throw new Error('enabled observation requires a nonempty allowlist')
          const validation = await request(VALIDATE, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled, allowedApps }),
          })
          if (validation.valid !== true) throw new Error(validation.error || t('invalid'))
          const accepted = await formRef.current.mutate([
            { op: 'set', path: ['allowedApps'], value: allowedApps },
            { op: 'set', path: ['enabled'], value: enabled },
          ], config.revision)
          if (!accepted) throw new Error(t('configError'))
          setDraftRows(null)
          setDraftEnabled(null)
          setNotice(t('saved'))
        } catch (cause) { setError(`${t('invalid')}: ${String(cause.message || cause)}`) }
        finally { setConfigBusy(false) }
      }
      const configReady = config.status === 'ready' && config.value
      const canWrite = configReady && config.writable && config.mode === 'host' && config.revision !== undefined
      const rows = draftRows ?? (config.value?.allowedApps ?? [])
      const group = (heading, ...children) => h('div', { className: 'cu-group' },
        h('div', { className: 'cu-groupHeading' }, heading), children)
      const text = (title, description) => h('span', { className: 'cu-rowText' },
        h('span', { className: 'cu-title' }, title),
        description ? h('span', { className: 'cu-desc' }, description) : null)
      const button = (label, onClick, { type = 'button', disabled = false, primary = false, ...rest } = {}) => h('button', {
        type,
        disabled,
        onClick,
        className: primary ? 'cu-button cu-buttonPrimary' : 'cu-button',
        ...rest,
      }, label)
      // A real checkbox (native semantics, keyboard focus) driving the styled
      // track/thumb, which is the switch recipe the DSH settings rows use.
      const toggle = (label, checked, onChange, disabled) => h('label', { className: 'cu-switch' },
        h('input', {
          className: 'cu-switchInput', type: 'checkbox', name: 'enabled',
          checked, onChange, disabled, 'aria-label': label,
        }),
        h('span', { className: 'cu-switchTrack' }, h('span', { className: 'cu-switchThumb' })))
      const allowlistRow = (value, index) => h('li', { key: index, className: 'cu-appRow' },
        h('input', {
          className: 'cu-input',
          name: `allowedApp-${index}`,
          value,
          placeholder: t('appPlaceholder'),
          disabled: !canWrite || configBusy,
          onChange: event => setDraftRows(rows.map((entry, at) => at === index ? event.target.value : entry)),
        }),
        button(t('removeApp'), () => setDraftRows(rows.filter((_, at) => at !== index)), {
          disabled: !canWrite || configBusy,
          'aria-label': `${t('removeApp')} ${value || index + 1}`,
        }))
      // The driver line: an unknown status is not a missing driver, and an
      // unreadable Host half says so instead of reporting a parse failure.
      const driverStatus = status === null
        ? (statusKnown ? t('statusUnknown') : '…')
        : status.supported !== true
          ? t('unsupported')
          : status.installed === true
            ? `${t('ready')} · ${t('version')}: ${status.installedVersion}`
            : `${t('absent')} · ${t('expected')}: ${status.version}`
      return h('section', { className: 'cu-section' },
        h('p', { className: 'cu-intro' }, t('intro')),
        h('div', { className: 'cu-versionBadge' },
          h('span', { className: 'cu-versionName' }, PACKAGE_NAME),
          h('span', { className: 'cu-versionTag' }, `v${PLUGIN_VERSION}`)),
        registry?.installed === false
          ? group(t('registryTitle'),
            h('p', { className: 'cu-desc cu-paragraph' }, t('registryBody')),
            setup === null
              ? (setupError === ''
                ? null
                : h('div', { className: 'cu-rowStack cu-setup' },
                  h('p', { className: 'cu-desc cu-paragraph', role: 'alert' }, `${t('registrySetupFailed')}: ${setupError}`),
                  h('pre', { className: 'cu-code' }, t('registryFallback')),
                  h('div', { className: 'cu-control' },
                    button(copied === 'fallback' ? t('copied') : t('copy'), () => void copy('fallback', t('registryFallback'))))))
              : h('div', { className: 'cu-rowStack cu-setup' },
                h('p', { className: 'cu-desc cu-paragraph' }, `${t('registryResolved')}: DSH ${setup.dshVersion ?? '?'} → ${setup.spec}`),
                setup.exact === false ? h('p', { className: 'cu-desc cu-paragraph' }, t('registryInexact')) : null,
                setup.verified === false ? h('p', { className: 'cu-desc cu-paragraph' }, t('registryUnverified')) : null,
                h('p', { className: 'cu-title' }, t('registryStep1')),
                h('pre', { className: 'cu-code' }, setup.command),
                h('div', { className: 'cu-control' },
                  button(copied === 'command' ? t('copied') : t('copy'), () => void copy('command', setup.command))),
                h('p', { className: 'cu-title' }, t('registryStep2')),
                h('pre', { className: 'cu-code' }, setup.patch),
                h('div', { className: 'cu-control' },
                  button(copied === 'patch' ? t('copied') : t('copy'), () => void copy('patch', setup.patch)))))
          : null,
        group(t('title'),
          h('div', { className: 'cu-row' },
            text(t('driverStatus'), h('span', { role: 'status', 'aria-live': 'polite' }, driverStatus)),
            h('span', { className: 'cu-control' },
              button(checking ? t('refresh') : t('test'), () => void test(), { disabled: busy || checking }),
              // The driver routes live in the Host half, so the button only
              // offers an installation once a status answer proves the driver is
              // absent; an unknown status must not look like a missing driver.
              button(busy ? t('busy') : t('install'), () => void install(), {
                disabled: busy || status?.supported === false || status?.installed !== false,
                primary: true,
              }))),
          h('div', { className: 'cu-row' },
            text(t('driverNote'), checking ? t('refresh') : notice || t('remote')))),
        group(t('configTitle'),
          h('div', { className: 'cu-row cu-rowStack' },
            h('p', { className: 'cu-desc cu-paragraph' }, t('configIntro'))),
          !configReady
            ? h('div', { className: 'cu-row' },
              h('span', { className: 'cu-desc', role: 'status' }, config.status === 'loading' ? t('loading') : t('unavailable')))
            : h('form', { className: 'cu-form', onSubmit: saveConfig },
              h('div', { className: 'cu-row' },
                text(t('enabled'), (draftEnabled ?? config.value.enabled) ? t('enabledStatus') : t('disabled')),
                toggle(t('enabled'), draftEnabled ?? config.value.enabled,
                  event => setDraftEnabled(event.target.checked), !canWrite || configBusy)),
              !canWrite
                ? h('div', { className: 'cu-row' }, h('span', { className: 'cu-desc', role: 'status' }, t('readonly')))
                : null,
              h('div', { className: 'cu-row cu-rowStack' },
                text(t('allowlist'), rows.length === 0 ? t('emptyList') : null),
                h('ul', { className: 'cu-appList' }, rows.map(allowlistRow)),
                h('div', { className: 'cu-control' },
                  button(t('addApp'), () => setDraftRows([...rows, '']), { disabled: !canWrite || configBusy }),
                  button(t('pickApp'), () => void pickRunning(), { disabled: !canWrite || configBusy || candidatesBusy })),
                candidates === null ? null : h('div', { className: 'cu-candidates' },
                  h('p', { className: 'cu-title' }, t('candidatesTitle')),
                  h('p', { className: 'cu-desc' }, t('candidatesNote')),
                  candidates.length === 0
                    ? h('p', { className: 'cu-desc', role: 'status' }, t('candidatesEmpty'))
                    : h('ul', { className: 'cu-appList cu-candidateList' },
                      candidates.map((app, index) => h('li', { key: `${app.pid}-${index}`, className: 'cu-appRow' },
                        h('span', { className: 'cu-candidateName', title: app.path ?? app.name }, app.path ?? app.name),
                        button(t('add'), () => addCandidate(app), { disabled: configBusy })))))),
              h('div', { className: 'cu-row cu-rowEnd' },
                button(configBusy ? t('saving') : t('save'), undefined, { type: 'submit', disabled: !canWrite || configBusy, primary: true })))),
        error ? h('p', { className: 'cu-notice', role: 'alert' }, error) : null)
    }
    return {
      inject: ['slots', 'locale', 'configForms', 'remote'],
      apply(ctx) {
        installStyles()
        // Settings sections are rendered by the shell as slot children and do not
        // receive the parent plugin's Cordis injection context. Capture the form
        // controller in the closure while this module has its declared service.
        const configForms = ctx.configForms
        // `remote.pluginManager` is a Remote namespace, not a plain service: the
        // api gateway mounts it as its own Cordis plugin once the client has
        // connected, so reading it here during apply would capture `undefined`
        // forever. Adopt it when it appears and publish that to the panel.
        let manager
        const managerListeners = new Set()
        const pluginManager = {
          get() { return manager },
          subscribe(listener) { managerListeners.add(listener); return () => managerListeners.delete(listener) },
        }
        const publishManager = () => { for (const listener of [...managerListeners]) listener() }
        ctx.inject(['remote.pluginManager'], inner => {
          manager = inner.get('remote.pluginManager')
          publishManager()
          return () => { manager = undefined; publishManager() }
        })
        // A Settings nav entry, like every other settings feature: the driver
        // panel is a page of its own rather than a block inside the Plugins page.
        ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh: TEXT.zh, en: TEXT.en }), 'dsh-computer-use-safe-win: locale')
        // The plugin manager is closed over instead of injected: it is optional
        // (absent on a Host without that client half) and a plain closure keeps
        // the component's props to what the slot contract always provides.
        const Section = props => h(DriverSettings, { ...props, configForms, pluginManager })
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'computer-use-safe-win',
          order: 30,
          label: () => ctx.locale.bind(LOCALE_NS)('nav'),
          locale: LOCALE_NS,
        }, Section))
      },
    }
  },
})