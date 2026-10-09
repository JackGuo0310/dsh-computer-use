window.__ModuleLoader__.load({
  id: 'dsh-computer-use-safe-win',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const STATUS = '/api/computer-use-safe-win/status'
    const INSTALL = '/api/computer-use-safe-win/install'
    const LOCALE_NS = 'computerUseSafeWin'
    const TEXT = {
      zh: { nav: '电脑操控', title: 'Cua Driver · 只读', intro: '先安装受管驱动，再测试安装状态。安装不会开启桌面观察；观察功能须另行配置白名单并启用。', test: '测试驱动', install: '安装驱动', confirm: '从 trycua 官方发行版下载并安装固定版本驱动？', busy: '正在安装…', absent: '未安装', ready: '受管驱动已安装（未启动验证）', unsupported: '当前系统不支持', version: '受管版本', expected: '目标版本', error: '请求失败', remote: '仅本机浏览器允许安装；远程连接请在主机本机打开设置页。' },
      en: { nav: 'Computer Use', title: 'Cua Driver · Read-only', intro: 'Install the managed driver and test its status. Installation never enables desktop observation; configure an allowlist and enable observation separately.', test: 'Test driver', install: 'Install driver', confirm: 'Download and install the pinned driver from the official trycua release?', busy: 'Installing…', absent: 'Not installed', ready: 'Managed driver installed (runtime not tested)', unsupported: 'Unsupported system', version: 'Managed version', expected: 'Target version', error: 'Request failed', remote: 'Installation is restricted to the local browser; open settings on the Host.' },
    }
    // The renderer supplies `t` as a translation function for the registered
    // locale namespace, not as a dictionary of translated values.
    function DriverSettings({ t }) {
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      async function request(path, options) {
        const response = await fetch(path, { credentials: 'same-origin', ...options })
        const value = await response.json()
        if (!response.ok) throw new Error(value.error || t('error'))
        return value
      }
      async function test() {
        try { setError(''); setStatus(await request(STATUS)) }
        catch (cause) { setError(String(cause.message || cause)) }
      }
      React.useEffect(() => { void test() }, [])
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
      return h('section', { style: { padding: '16px', border: '1px solid var(--dsw-border-default, #53657b)', borderRadius: '12px', maxWidth: '600px' } },
        h('h4', { style: { margin: '0 0 8px' } }, t('title')),
        h('p', null, t('intro')),
        h('p', { role: 'status', 'aria-live': 'polite' }, status ? status.supported ? status.installed ? `${t('ready')} · ${t('version')}: ${status.installedVersion}` : `${t('absent')} · ${t('expected')}: ${status.version}` : t('unsupported') : '…'),
        h('p', null, t('remote')),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button', { type: 'button', disabled: busy, onClick: () => void test() }, t('test')),
          h('button', { type: 'button', disabled: busy || status?.supported === false || status?.installed === true, onClick: () => void install() }, busy ? t('busy') : t('install'))),
        error ? h('p', { role: 'alert' }, error) : null)
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
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
