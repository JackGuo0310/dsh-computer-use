window.__ModuleLoader__.load({
  id: 'dsh-computer-use-safe-win',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const STATUS = '/api/computer-use-safe-win/status'
    const INSTALL = '/api/computer-use-safe-win/install'
    const LOCALE_NS = 'computerUseSafeWin'
    const CONFIG_ID = 'computer-use-safe-win'
    const TEXT = {
      zh: { nav: '电脑操控', title: 'Cua Driver', intro: '先安装受管驱动并确认状态。安装不会开启桌面观察；保存配置也不会绕过平台、驱动或白名单检查。', test: '刷新驱动状态', refresh: '正在检查…', checked: '状态已刷新', install: '安装驱动', confirm: '从 trycua 官方发行版下载并安装固定版本驱动？', busy: '正在安装…', absent: '未安装', ready: '受管驱动已安装（未启动验证）', unsupported: '当前系统不支持', version: '受管版本', expected: '目标版本', error: '请求失败', remote: '仅本机浏览器允许安装；远程连接请在主机本机打开设置页。', configTitle: '观察配置', configIntro: '白名单按可执行文件名匹配；启用会启动观察运行时，但当前仍没有输入动作。请只添加可信应用。', enabled: '启用窗口观察', allowlist: '允许的应用（每行一个 .exe）', save: '保存配置', saving: '正在保存…', loading: '正在读取 Host 配置…', unavailable: 'Host 配置不可用；请在本机设置页重试。', readonly: '当前连接不可写。请使用 DSH 主机本机浏览器修改持久配置。', saved: 'Host 已接受配置并完成持久化。', invalid: '请检查配置', disabled: '观察功能已关闭。', enabledStatus: '观察功能已启用；运行时及驱动仍需单独验证。', configError: '配置保存失败或发生版本冲突；请刷新页面后重试。' },
      en: { nav: 'Computer Use', title: 'Cua Driver', intro: 'Install and verify the managed driver status. Installation never enables observation; saving configuration does not bypass platform, driver, or allowlist checks.', test: 'Refresh driver status', refresh: 'Checking…', checked: 'Status refreshed', install: 'Install driver', confirm: 'Download and install the pinned driver from the official trycua release?', busy: 'Installing…', absent: 'Not installed', ready: 'Managed driver installed (runtime not tested)', unsupported: 'Unsupported system', version: 'Managed version', expected: 'Target version', error: 'Request failed', remote: 'Installation is restricted to the local browser; open settings on the Host.', configTitle: 'Observation settings', configIntro: 'The allowlist matches executable filenames. Enabling starts the observation runtime, but input actions remain unavailable. Add only trusted applications.', enabled: 'Enable window observation', allowlist: 'Allowed applications (one .exe per line)', save: 'Save settings', saving: 'Saving…', loading: 'Loading Host settings…', unavailable: 'Host settings are unavailable; retry from the local settings page.', readonly: 'This connection cannot write persistent settings. Use the Host’s local browser.', saved: 'Host accepted and persisted the settings.', disabled: 'Observation is disabled.', enabledStatus: 'Observation is enabled; runtime and driver behavior still require separate verification.', invalid: 'Check the settings', configError: 'Settings save failed or conflicted; reload the page and retry.' },
    }
    // The renderer supplies `t` as a translation function for the registered
    // locale namespace, not as a dictionary of translated values.
    function DriverSettings({ t, configForms }) {
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [checking, setChecking] = React.useState(false)
      const [configBusy, setConfigBusy] = React.useState(false)
      const [draftApps, setDraftApps] = React.useState(null)
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
      React.useEffect(() => {
        setDraftApps(null)
        setDraftEnabled(null)
      }, [config.revision])
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
      async function saveConfig(event) {
        event.preventDefault()
        setConfigBusy(true)
        setError('')
        setNotice('')
        try {
          const allowedApps = globalThis.__normalizeAllowedApps(draftApps ?? (config.value?.allowedApps ?? []).join('\\n'))
          const enabled = draftEnabled ?? Boolean(event.currentTarget.elements.enabled.checked)
          if (enabled && allowedApps.length === 0) throw new Error('enabled observation requires a nonempty allowlist')
          const validation = await request('/api/computer-use-safe-win/validate-config', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled, allowedApps }),
          })
          if (validation.valid !== true) throw new Error(validation.error || t('invalid'))
          const accepted = await formRef.current.mutate([
            { op: 'set', path: ['allowedApps'], value: allowedApps },
            { op: 'set', path: ['enabled'], value: enabled },
          ], config.revision)
          if (!accepted) throw new Error(t('configError'))
          setDraftApps(null)
          setDraftEnabled(null)
          setNotice(t('saved'))
        } catch (cause) { setError(`${t('invalid')}: ${String(cause.message || cause)}`) }
        finally { setConfigBusy(false) }
      }
      const configReady = config.status === 'ready' && config.value
      const canWrite = configReady && config.writable && config.mode === 'host' && config.revision !== undefined
      const currentApps = draftApps ?? (config.value?.allowedApps ?? []).join('\\n')
      return h('section', { style: { padding: '16px', border: '1px solid var(--dsw-border-default, #53657b)', borderRadius: '12px', maxWidth: '600px' } },
        h('h4', { style: { margin: '0 0 8px' } }, t('title')),
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
          h('label', { style: { display: 'block' } }, t('allowlist'),
            h('textarea', { name: 'allowedApps', rows: 6, value: currentApps, disabled: !canWrite || configBusy, onChange: event => setDraftApps(event.target.value), style: { display: 'block', width: '100%', marginTop: '6px' } })),
          h('button', { type: 'submit', disabled: !canWrite || configBusy, style: { marginTop: '12px' } }, configBusy ? t('saving') : t('save'))) : null,
        error ? h('p', { role: 'alert' }, error) : null)
    }
    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
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
        }, DriverSettings))
      },
    }
  },
})
