window.__ModuleLoader__.load({
  id: 'dsh-computer-use-safe-win',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const STATUS = '/api/computer-use-safe-win/status'
    const INSTALL = '/api/computer-use-safe-win/install'
    const CANDIDATES = '/api/computer-use-safe-win/running-apps'
    const REQUIREMENTS = '/api/computer-use-safe-win/requirements'
    /** The package providing the exclusive computer-use provider registry. */
    const REQUIRED_PACKAGE = '@deepseek-ai/dsh-computer-use'
    const VALIDATE = '/api/computer-use-safe-win/validate-config'
    const LOCALE_NS = 'computerUseSafeWin'
    const CONFIG_ID = 'computer-use-safe-win'
    const EXECUTABLE_NAME = /^[\w.-]{1,128}\.exe$/i
    const EXECUTABLE_PATH = /^[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n]+[\\/])*[^\\/:*?"<>|\r\n]+\.exe$/i
    const TEXT = {
      zh: { nav: '电脑操控', title: 'Cua Driver', needTitle: '缺少前置组件', needBody: '本插件需要 @deepseek-ai/dsh-computer-use 提供「同一时刻只允许一个电脑操控提供者」的独占注册，否则插件无法启动。', needInstall: '安装前置组件', needInstalling: '正在安装…', needConfirm: '安装 DSH 官方插件 @deepseek-ai/dsh-computer-use？安装后需要重启 DSH。', needInstalled: '前置组件已安装；请重启 DSH 使本插件生效。', intro: '先安装受管驱动并确认状态。安装不会开启桌面观察；保存配置也不会绕过平台、驱动或白名单检查。', test: '刷新驱动状态', refresh: '正在检查…', checked: '状态已刷新', install: '安装驱动', confirm: '从 trycua 官方发行版下载并安装固定版本驱动？', busy: '正在安装…', absent: '未安装', ready: '受管驱动已安装（未启动验证）', unsupported: '当前系统不支持', version: '受管版本', expected: '目标版本', error: '请求失败', remote: '仅本机浏览器允许安装；远程连接请在主机本机打开设置页。', configTitle: '观察配置', configIntro: '只有白名单里的应用才能被列举和观察。每一项可以是可执行文件名（如 notepad.exe，更宽松）或绝对路径（如 C:\\Program Files\\App\\app.exe，更精确）。保存后立即对后续调用生效，无需重启。请只添加可信应用。', enabled: '启用窗口观察', allowlist: '允许的应用白名单', addApp: '添加应用', removeApp: '删除', appPlaceholder: 'notepad.exe 或 C:\\Program Files\\App\\app.exe', emptyList: '白名单为空；启用观察前至少添加一个应用。', pickApp: '从运行中的应用选择', picking: '正在读取…', candidatesTitle: '正在运行的应用', candidatesEmpty: '没有可添加的应用。', candidatesNote: '有路径时默认添加绝对路径，更精确；没有路径的应用只能按文件名添加。', add: '添加', save: '保存配置', saving: '正在保存…', loading: '正在读取 Host 配置…', unavailable: 'Host 配置不可用；请在本机设置页重试。', readonly: '当前连接不可写。请使用 DSH 主机本机浏览器修改持久配置。', saved: 'Host 已接受配置并完成持久化；对后续调用立即生效。', invalid: '请检查配置', disabled: '观察功能已关闭。', enabledStatus: '观察功能已启用；运行时及驱动仍需单独验证。', configError: '配置保存失败或发生版本冲突；请刷新页面后重试。' },
      en: { nav: 'Computer Use', title: 'Cua Driver', needTitle: 'Missing prerequisite', needBody: 'This plugin needs @deepseek-ai/dsh-computer-use for the exclusive registry that keeps a single computer-use provider on the desktop. Without it the plugin cannot start.', needInstall: 'Install prerequisite', needInstalling: 'Installing…', needConfirm: 'Install the official DSH plugin @deepseek-ai/dsh-computer-use? DSH must be restarted afterwards.', needInstalled: 'The prerequisite is installed; restart DSH to activate this plugin.', intro: 'Install and verify the managed driver status. Installation never enables observation; saving configuration does not bypass platform, driver, or allowlist checks.', test: 'Refresh driver status', refresh: 'Checking…', checked: 'Status refreshed', install: 'Install driver', confirm: 'Download and install the pinned driver from the official trycua release?', busy: 'Installing…', absent: 'Not installed', ready: 'Managed driver installed (runtime not tested)', unsupported: 'Unsupported system', version: 'Managed version', expected: 'Target version', error: 'Request failed', remote: 'Installation is restricted to the local browser; open settings on the Host.', configTitle: 'Observation settings', configIntro: 'Only allowlisted applications can be listed or observed. Each entry is either an executable filename (notepad.exe, broader) or an absolute path (C:\\Program Files\\App\\app.exe, stricter). A save applies to later calls without a restart. Add only trusted applications.', enabled: 'Enable window observation', allowlist: 'Allowed applications', addApp: 'Add application', removeApp: 'Remove', appPlaceholder: 'notepad.exe or C:\\Program Files\\App\\app.exe', emptyList: 'The allowlist is empty; add at least one application before enabling observation.', pickApp: 'Choose a running application', picking: 'Reading…', candidatesTitle: 'Running applications', candidatesEmpty: 'No application is available to add.', candidatesNote: 'Applications that report a path are added by absolute path, which is stricter. The rest can only be added by filename.', add: 'Add', save: 'Save settings', saving: 'Saving…', loading: 'Loading Host settings…', unavailable: 'Host settings are unavailable; retry from the local settings page.', readonly: 'This connection cannot write persistent settings. Use the Host’s local browser.', saved: 'Host accepted and persisted the settings; they apply to later calls at once.', invalid: 'Check the settings', disabled: 'Observation is disabled.', enabledStatus: 'Observation is enabled; runtime and driver behavior still require separate verification.', configError: 'Settings save failed or conflicted; reload the page and retry.' },
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
    // `installPrerequisite` is supplied by the apply closure rather than read from
    // `ctx` here: the Host may not mount the plugin-manager client half, and a
    // component must not reach for a service the panel declares no inject for.
    function DriverSettings({ t, configForms, prerequisites }) {
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [checking, setChecking] = React.useState(false)
      const [configBusy, setConfigBusy] = React.useState(false)
      const [candidates, setCandidates] = React.useState(null)
      const [candidatesBusy, setCandidatesBusy] = React.useState(false)
      const [registry, setRegistry] = React.useState(null)
      const [registryBusy, setRegistryBusy] = React.useState(false)
      const [draftRows, setDraftRows] = React.useState(null)
      const [draftEnabled, setDraftEnabled] = React.useState(null)
      const formRef = React.useRef(null)
      formRef.current ??= configForms.get(CONFIG_ID)
      const form = formRef.current
      const config = React.useSyncExternalStore(
        listener => form.subscribe(listener),
        () => form.getSnapshot(),
        () => form.getSnapshot(),
      )
      async function request(path, options) {
        const response = await fetch(path, { credentials: 'same-origin', ...options })
        const value = await response.json()
        if (!response.ok) throw new Error(value.error || t('error'))
        return value
      }
      async function test() {
        setChecking(true)
        setError('')
        setNotice('')
        try { setStatus(await request(STATUS)); setNotice(t('checked')) }
        catch (cause) { setError(String(cause.message || cause)) }
        finally { setChecking(false) }
      }
      React.useEffect(() => { void test() }, [])
      /**
       * Ask the Host's plugin manager whether the exclusive provider registry is
       * installed.
       *
       * This deliberately does not go through a Host route: until the registry
       * exists the Host half of this plugin cannot activate, so a route on this
       * plugin could not answer. The plugin manager is a separate Host service and
       * answers exactly this question.
       */
      React.useEffect(() => {
        const manager = prerequisites?.installed
        if (manager === undefined) { setRegistry({ installed: false }); return }
        let live = true
        void (async () => {
          const result = await manager()
          if (live) setRegistry({ installed: result.ok && result.value.some(bundle => bundle.name === REQUIRED_PACKAGE) })
        })().catch(() => { if (live) setRegistry({ installed: false }) })
        return () => { live = false }
      }, [])
      React.useEffect(() => {
        setDraftRows(null)
        setDraftEnabled(null)
      }, [config.revision])
      /**
     * Install the prerequisite through the Host's own plugin manager.
     *
     * The profile is composed from `package.json` and is written by that manager,
     * so this never edits the profile directly: it asks for the same install a
     * person would start from the Plugins page, which is the only path that keeps
     * `dependencies` and `bundles` consistent.
     */
      async function runInstallPrerequisite() {
        const manager = prerequisites?.install
        if (manager === undefined) return
        if (!window.confirm(t('needConfirm'))) return
        setRegistryBusy(true)
        setError('')
        setNotice('')
        try {
          const result = await manager()
          if (!result.ok) throw new Error(result.error?.message ?? t('error'))
          setNotice(t('needInstalled'))
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setRegistryBusy(false)
        }
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
      const row = (value, index) => h('li', { key: index, style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        h('input', {
          name: `allowedApp-${index}`,
          value,
          placeholder: t('appPlaceholder'),
          disabled: !canWrite || configBusy,
          onChange: event => setDraftRows(rows.map((entry, at) => at === index ? event.target.value : entry)),
          style: { flex: '1 1 auto', minWidth: '0' },
        }),
        h('button', {
          type: 'button',
          disabled: !canWrite || configBusy,
          'aria-label': `${t('removeApp')} ${value || index + 1}`,
          onClick: () => setDraftRows(rows.filter((_, at) => at !== index)),
        }, t('removeApp')))
      return h('section', { style: { padding: '16px', border: '1px solid var(--dsw-border-default, #53657b)', borderRadius: '12px', maxWidth: '600px' } },
        h('h4', { style: { margin: '0 0 8px' } }, t('title')),
        registry?.installed === false
          ? h('div', { style: { padding: '8px', marginBottom: '12px', border: '1px solid var(--dsw-border-default, #53657b)', borderRadius: '8px' } },
            h('p', { style: { margin: '0 0 4px', fontWeight: 600 } }, t('needTitle')),
            h('p', { style: { margin: '0 0 8px' } }, t('needBody')),
            prerequisites?.install === undefined
              ? null
              : h('button', { type: 'button', disabled: registryBusy, onClick: () => void runInstallPrerequisite() }, registryBusy ? t('needInstalling') : t('needInstall')))
          : null,
        h('p', null, t('intro')),
        h('p', { role: 'status', 'aria-live': 'polite' }, status ? status.supported ? status.installed ? `${t('ready')} · ${t('version')}: ${status.installedVersion}` : `${t('absent')} · ${t('expected')}: ${status.version}` : t('unsupported') : '…'),
        h('p', null, checking ? t('refresh') : notice || t('remote')),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button', { type: 'button', disabled: busy || checking, onClick: () => void test() }, checking ? t('refresh') : t('test')),
          h('button', { type: 'button', disabled: busy || status?.supported === false || status?.installed === true, onClick: () => void install() }, busy ? t('busy') : t('install'))),
        h('hr'),
        h('h4', { style: { margin: '0 0 8px' } }, t('configTitle')),
        h('p', null, t('configIntro')),
        !configReady ? h('p', { role: 'status' }, config.status === 'loading' ? t('loading') : t('unavailable')) : !canWrite ? h('p', { role: 'status' }, t('readonly')) : null,
        configReady ? h('form', { onSubmit: saveConfig },
          h('label', { style: { display: 'block', marginBottom: '12px' } },
            h('input', { type: 'checkbox', name: 'enabled', checked: draftEnabled ?? config.value.enabled, onChange: event => setDraftEnabled(event.target.checked), disabled: !canWrite || configBusy }), ' ', t('enabled')),
          h('p', { role: 'status' }, (draftEnabled ?? config.value.enabled) ? t('enabledStatus') : t('disabled')),
          h('label', { style: { display: 'block', marginBottom: '6px' } }, t('allowlist')),
          rows.length === 0 ? h('p', { role: 'status' }, t('emptyList')) : null,
          h('ul', { style: { listStyle: 'none', margin: '0 0 8px', padding: '0', display: 'flex', flexDirection: 'column', gap: '6px' } }, rows.map(row)),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            h('button', { type: 'button', disabled: !canWrite || configBusy, onClick: () => setDraftRows([...rows, '']) }, t('addApp')),
            h('button', { type: 'button', disabled: !canWrite || configBusy || candidatesBusy, onClick: () => void pickRunning() }, candidatesBusy ? t('picking') : t('pickApp'))),
          candidates === null ? null : h('div', { style: { marginTop: '8px', padding: '8px', border: '1px solid var(--dsw-border-default, #53657b)', borderRadius: '8px' } },
            h('p', { style: { margin: '0 0 4px' } }, t('candidatesTitle')),
            h('p', { style: { margin: '0 0 8px', fontSize: '0.9em', opacity: '0.8' } }, t('candidatesNote')),
            candidates.length === 0 ? h('p', { role: 'status' }, t('candidatesEmpty')) : h('ul', { style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '240px', overflowY: 'auto' } },
              candidates.map((app, index) => h('li', { key: `${app.pid}-${index}`, style: { display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'space-between' } },
                h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: app.path ?? app.name }, app.path ?? app.name),
                h('button', { type: 'button', disabled: configBusy, onClick: () => addCandidate(app) }, t('add')))))),
          h('button', { type: 'submit', disabled: !canWrite || configBusy, style: { marginTop: '12px' } }, configBusy ? t('saving') : t('save'))) : null,
        error ? h('p', { role: 'alert' }, error) : null)
    }
    return {
      inject: ['slots', 'locale', 'configForms', 'remote'],
      apply(ctx) {
        // The Host plugin manager is a separate service from this plugin, so it can
        // answer "is the prerequisite installed?" and install it even while this
        // plugin's Host half is still waiting for the prerequisite to appear.
        // Nothing here edits the profile: the plugin manager owns those files.
        const manager = ctx.remote?.pluginManager
        const prerequisites = manager === undefined ? undefined : {
          installed: () => manager.listBundles(),
          install: () => manager.installBundle(REQUIRED_PACKAGE, {
            enabled: false,
            requestId: crypto.randomUUID(),
            registry: undefined,
          }),
        }
        // DSH Settings forms are keyed by the Host profile entry id; this section
        // is that one registered entry's own configuration surface.
        ctx.configForms.get(CONFIG_ID)
        // A Settings nav entry, like every other settings feature: the driver
        // panel is a page of its own rather than a block inside the Plugins page.
        ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh: TEXT.zh, en: TEXT.en }), 'dsh-computer-use-safe-win: locale')
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'computer-use-safe-win',
          order: 30,
          label: () => ctx.locale.bind(LOCALE_NS)('nav'),
          locale: LOCALE_NS,
        }, DriverSettings, { prerequisites }))
      },
    }
  },
})