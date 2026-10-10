import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const bundle = await readFile(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')
const absent = { installed: false, supported: true, version: '0.28.0', installedVersion: null }
const present = { installed: true, supported: true, version: '0.28.0', installedVersion: '0.28.0' }
const validConfig = { valid: true, value: { enabled: true, allowedApps: ['notepad.exe'] } }
/** The prerequisite package, and what the plugin manager reports as installed. */
const REQUIRED_PACKAGE = '@deepseek-ai/dsh-computer-use'
const registryReady = ['@deepseek-ai/dsh-base', REQUIRED_PACKAGE]
const registryMissing = ['@deepseek-ai/dsh-base']
/** Shape the Host plugin manager returns from `listBundles()`. */
function bundleList(names) {
  return { ok: true, value: names.map(name => ({ name })) }
}

function configForm({ status = 'ready', enabled = false, allowedApps = [], writable = true, mode = 'host', revision = 1, accept = true } = {}) {
  let current = { status, value: status === 'ready' ? { enabled, allowedApps } : undefined, base: {}, user: {}, revision, writable, mode }
  const listeners = new Set()
  const writes = []
  const form = {
    writes,
    subscribe(listener) { assert.equal(this, form); listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot() { assert.equal(this, form); return current },
    async mutate(ops, expectedRevision) {
      writes.push({ ops, expectedRevision })
      if (!accept) return false
      const value = { ...(current.value ?? {}) }
      for (const op of ops) value[op.path[0]] = op.value
      current = { ...current, value, revision: (current.revision ?? 0) + 1 }
      for (const listener of listeners) listener()
      return true
    },
  }
  return form
}

/** Evaluate the genuine browser artifact with DSH-like Cordis, React, slot, and fetch seams. */
async function evaluate({ locale = 'zh-CN', respond = async () => absent, form = configForm(), withManager = true, registry = registryReady, withConfigForms = true } = {}) {
  const registered = []
  const deferredSlot = new Map()
  const effects = []
  const dictionaries = new Map()
  const state = []
  const dependencyHistory = []
  let renderCurrentTarget
  let cursor = 0
  let effectCursor = 0
  const seen = []
  const react = {
    createElement(type, props, ...children) {
      if (props == null) props = {}
      if (type === 'form' && props.onSubmit) {
        const onSubmit = props.onSubmit
        props = { ...props, onSubmit: event => onSubmit({ ...event, currentTarget: event.currentTarget ?? renderCurrentTarget }) }
      }
      // Real React flattens nested arrays and drops null/undefined children;
      // the harness must too or a mapped list would hide behind one array node.
      const flat = []
      const push = child => {
        if (child === null || child === undefined || child === false) return
        if (Array.isArray(child)) child.forEach(push)
        else flat.push(child)
      }
      children.forEach(push)
      return { type, props: { ...props, children: flat }, children: flat }
    },
    useState(initial) {
      const index = cursor++
      if (state.length <= index) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], value => { state[index] = value }]
    },
    useRef(initial) {
      const index = cursor++
      if (state.length <= index) state[index] = { current: initial }
      return state[index]
    },
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) { subscribe(() => {}); return getSnapshot() ?? getServerSnapshot() },
    useEffect(run, deps) {
      const index = effectCursor++
      const previous = dependencyHistory[index]
      const changed = previous === undefined || deps === undefined || deps.length !== previous.length || deps.some((dep, position) => !Object.is(dep, previous[position]))
      dependencyHistory[index] = deps
      if (changed) effects.push(run)
    },
  }
  const slots = {
    inject(name, register) { deferredSlot.set(name, register) },
    // Accept the real public overloads, although this plugin uses only the
    // two-argument `(options, component)` form. The slot harness does not emulate
    // the DSH Renderer or React reconciliation.
    register(spec, Component, extra) {
      if (extra !== undefined && (typeof extra !== 'object' || extra === null || (extra.inject !== undefined && typeof extra.inject !== 'function'))) {
        throw new Error(`slot "${spec?.id}" was registered with an invalid third argument`)
      }
      registered.push({ spec, Component, extra })
      return () => { registered.length -= 1 }
    },
  }
  const active = locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const localeService = {
    register(namespace, dictionary) { dictionaries.set(namespace, dictionary); return () => dictionaries.delete(namespace) },
    bind(namespace) { return key => dictionaries.get(namespace)?.[active]?.[key] ?? key },
  }
  let registration
  const configForms = { get(id) { assert.equal(id, 'computer-use-safe-win'); return form } }
  const sandbox = {
    navigator: { language: locale },
    __configForms: configForms,
    setTimeout,
    crypto: { randomUUID: () => 'request-1' },
    fetch: async (path, options) => {
      seen.push({ path, options })
      const value = await respond(path, options)
      return value instanceof Error ? value : { ok: value?.ok !== false, json: async () => value }
    },
    window: { confirm: () => true, __ModuleLoader__: { load(value) { registration = value } } },
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(bundle, sandbox)
  assert.ok(registration, 'the artifact must register a browser module')
  const namespace = registration.factory(specifier => {
    assert.equal(specifier, 'react', 'the artifact may request only the seeded React module')
    return react
  })
  const installs = []
  const pluginManagerStub = {
    listBundles: async () => bundleList(registry),
    installBundle: async spec => { installs.push(spec); return { ok: true, value: { installed: spec } } },
  }
  namespace.apply({
    slots, locale: localeService, configForms: withConfigForms ? configForms : undefined,
    // `withManager: false` reproduces a Host that does not mount the
    // plugin-manager client half, so the panel must only explain.
    remote: withManager ? { pluginManager: pluginManagerStub } : undefined,
    effect: run => { run(); return () => {} },
  })
  assert.equal(deferredSlot.has('settings.section'), true)
  for (const register of deferredSlot.values()) register()

  const settle = async () => { for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setImmediate(resolve)) }
  const draw = () => {
    cursor = 0
    effectCursor = 0
    effects.length = 0
    const t = key => dictionaries.get('computerUseSafeWin')?.[active]?.[key] ?? key
    const element = renderNode(registered[0].Component({ close() {}, t }, registered[0].extra?.inject?.() ?? {}))
    renderCurrentTarget = { elements: { enabled: { checked: Boolean(findElement(element, node => node.type === 'input' && node.props.type === 'checkbox')?.props.checked) } } }
    for (const effect of effects) effect()
    return element
  }
  /** Resolve an element whose type is a component, as React would. */
  function renderNode(node) {
    return node && typeof node.type === 'function' ? renderNode(node.type(node.props)) : node
  }
  const render = async () => {
    let element = draw()
    for (let frame = 0; frame < 4; frame += 1) {
      const before = textOf(element)
      await settle()
      element = draw()
      if (textOf(element) === before) return element
    }
    return element
  }
  const press = async (element, label) => {
    const button = findElement(element, node => node.type === 'button' && JSON.stringify(node.children).includes(label))
    assert.ok(button, `no ${label} button`)
    await button.props.onClick()
    await settle()
  }
  return { namespace, registered, render, press, seen, installs, spec: registered[0].spec, form, entry: () => registered[0] }
}

const textOf = element => JSON.stringify(element)
function findElement(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = findElement(child, predicate)
    if (found) return found
  }
  return undefined
}
function findElements(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found
  if (predicate(node)) found.push(node)
  for (const child of node.children ?? []) findElements(child, predicate, found)
  return found
}
/** The editable allowlist row inputs, identified by their per-row input names. */
const rowsOf = element => findElements(element, node => node.type === 'input' && /^allowedApp-\d+$/.test(node.props.name))
/** The remove button of the allowlist row holding this exact entry. */
const removeOf = (element, value) => {
  const button = findElement(element, node => node.type === 'button' && node.props['aria-label'] === `删除 ${value}`)
  assert.ok(button, `no remove button for ${value}`)
  return button
}
/** Find a button by its rendered label. */
function buttonWith(element, label) {
  const button = findElement(element, node => node.type === 'button' && JSON.stringify(node.children).includes(label))
  assert.ok(button, `no ${label} button`)
  return button
}

test('the shipped client half registers a Settings section and renders driver and config controls', async () => {
  const page = await evaluate()
  assert.deepEqual([...page.namespace.inject].sort(), ['configForms', 'locale', 'remote', 'slots'])
  assert.equal(page.spec.name, 'settings.section')
  assert.equal(page.spec.id, 'computer-use-safe-win')
  assert.equal(page.spec.label(), '电脑操控')
  const text = textOf(await page.render())
  assert.match(text, /观察配置/)
  assert.match(text, /观察功能已关闭/)
  assert.match(text, /允许的应用/)
  assert.match(text, /Cua Driver/)
  assert.match(text, /未安装 · 目标版本: 0\.28\.0/)
  assert.deepEqual(page.seen.map(call => call.path), ['/api/computer-use-safe-win/status'])
})

test('the section remains renderable when configForms is unavailable', async () => {
  const page = await evaluate({ withConfigForms: false })
  const text = textOf(await page.render())
  assert.equal(page.spec.id, 'computer-use-safe-win')
  assert.match(text, /Cua Driver/)
  assert.match(text, /Host 配置不可用/)
  assert.deepEqual(page.seen.map(call => call.path), ['/api/computer-use-safe-win/status'])
})

test('the Settings nav label follows the active locale and English UI is complete', async () => {
  const page = await evaluate({ locale: 'en-US' })
  assert.equal(page.spec.label(), 'Computer Use')
  const text = textOf(await page.render())
  assert.match(text, /Observation settings/)
  assert.match(text, /Allowed applications/)
})

test('persistent GUI settings submit an atomic revision-fenced Host mutation', async () => {
  const form = configForm({ revision: 7, enabled: false, allowedApps: ['notepad.exe', 'calc.exe'] })
  const page = await evaluate({ form, respond: async path => path.endsWith('/validate-config') ? validConfig : absent })
  let element = await page.render()
  let submit = findElement(element, node => node.type === 'form')
  assert.ok(submit)
  const checkbox = findElement(element, node => node.type === 'input' && node.props.type === 'checkbox')
  const rows = rowsOf(element)
  assert.equal(checkbox.props.checked, false)
  assert.deepEqual(rows.map(row => row.props.value), ['notepad.exe', 'calc.exe'], 'each allowlist entry is its own editable row')
  // Removing the second entry, then saving, is the delete half of the editor.
  removeOf(element, 'calc.exe').props.onClick()
  element = await page.render()
  assert.deepEqual(rowsOf(element).map(row => row.props.value), ['notepad.exe'])
  const add = buttonWith(element, '添加应用')
  add.props.onClick()
  element = await page.render()
  assert.equal(rowsOf(element).length, 2, 'adding appends an empty row')
  rowsOf(element)[1].props.onChange({ target: { value: 'C:\\Program Files\\App\\app.exe' } })
  checkbox.props.onChange({ target: { checked: true } })
  element = await page.render()
  submit = findElement(element, node => node.type === 'form')
  assert.equal(findElement(element, node => node.type === 'input' && node.props.type === 'checkbox').props.checked, true)
  await submit.props.onSubmit({ preventDefault() {} })
  assert.equal(form.writes.length, 1)
  assert.equal(form.writes[0].expectedRevision, 7)
  assert.deepEqual(page.seen.map(call => call.path), ['/api/computer-use-safe-win/status', '/api/computer-use-safe-win/validate-config'])
  assert.equal(JSON.parse(page.seen.find(call => call.path.endsWith('validate-config')).options.body).enabled, true)
  assert.deepEqual(JSON.parse(page.seen.find(call => call.path.endsWith('validate-config')).options.body).allowedApps, ['notepad.exe', 'c:\\program files\\app\\app.exe'])
  assert.equal(form.writes[0].ops.length, 2)
  assert.equal(form.writes[0].ops[0].path[0], 'allowedApps')
  assert.deepEqual(JSON.parse(JSON.stringify(form.writes[0].ops[0].value)), ['notepad.exe', 'c:\\program files\\app\\app.exe'])
  assert.equal(form.writes[0].ops[1].path[0], 'enabled')
  assert.equal(form.writes[0].ops[1].value, true)
  assert.equal(findElement(await page.render(), node => node.type === 'input' && node.props.type === 'checkbox').props.checked, true)
  assert.match(textOf(await page.render()), /Host 已接受配置并完成持久化/sg)
})

test('GUI settings remain disabled for memory-mode and unavailable forms', async () => {
  for (const form of [configForm({ mode: 'memory', writable: false }), configForm({ status: 'unavailable', writable: false })]) {
    const page = await evaluate({ form })
    const text = textOf(await page.render())
    assert.match(text, /当前连接不可写|Host 配置不可用|This connection cannot write/)
    const submit = findElement(await page.render(), node => node.type === 'form')
    if (form.getSnapshot().status !== 'ready') assert.equal(submit, undefined)
    else assert.equal(findElement(submit, node => node.type === 'button')?.props.disabled, true)
  }
})

test('GUI settings surface Host refusal without claiming success', async () => {
  const form = configForm({ accept: false })
  const page = await evaluate({ locale: 'en-US', form, respond: async path => path.endsWith('/validate-config') ? validConfig : absent })
  const submit = findElement(await page.render(), node => node.type === 'form')
  await submit.props.onSubmit({ preventDefault() {}, currentTarget: { elements: { enabled: { checked: false } } } })
  assert.match(textOf(await page.render()), /Settings save failed or conflicted/)
})

test('opening settings checks driver status and refresh gives visible feedback', async () => {
  const page = await evaluate({ locale: 'en-US' })
  const text = textOf(await page.render())
  assert.match(text, /Refresh driver status/)
  assert.match(text, /Not installed/)
  assert.match(text, /0\.28\.0/)
  assert.deepEqual(page.seen.map(call => call.path), ['/api/computer-use-safe-win/status'])
})

test('the panel is not registered as a Plugins page block any more', async () => {
  const page = await evaluate()
  assert.notEqual(page.spec.name, 'plugins.bundle.config')
  assert.equal(page.spec.key, undefined)
})

test('the install button posts explicit same-origin confirmation and re-tests', async () => {
  let installed = false
  const page = await evaluate({ locale: 'en-US', respond: async path => {
    if (path.endsWith('/install')) { installed = true; return present }
    return installed ? present : absent
  } })
  await page.render()
  await page.press(await page.render(), 'Install driver')
  const install = page.seen.find(call => call.path.endsWith('/install'))
  assert.equal(install.options.method, 'POST')
  assert.equal(install.options.headers['x-computer-use-confirm'], 'install-pinned-driver')
  assert.match(textOf(await page.render()), /Managed driver installed \(runtime not tested\)/)
})

test('a refused installation surfaces the Host error without claiming success', async () => {
  const page = await evaluate({ locale: 'en-US', respond: async path => path.endsWith('/install')
    ? Object.assign(new Error('local browser required'), { ok: false, json: async () => ({ error: 'Driver installation requires the local authenticated browser' }) })
    : absent })
  await page.render()
  await page.press(await page.render(), 'Install driver')
  assert.match(textOf(await page.render()), /local authenticated browser/)
})

test('a missing prerequisite is explained and installable through the Host plugin manager', async () => {
  const page = await evaluate({ registry: registryMissing, withManager: true, respond: async () => absent })
  await page.render()
  const text = textOf(await page.render())
  assert.match(text, /缺少前置组件/)
  assert.match(text, /@deepseek-ai\/dsh-computer-use/)
  await page.press(await page.render(), '安装前置组件')
  assert.deepEqual(page.installs, [REQUIRED_PACKAGE])
  assert.match(textOf(await page.render()), /请重启 DSH/)
})

test('the panel still explains a missing prerequisite while the Host config form is loading', async () => {
  // The Host half cannot answer anything until the prerequisite is installed,
  // so the form stays in `loading` and the panel must still be actionable.
  const form = configForm({ status: 'loading' })
  const page = await evaluate({ form, registry: registryMissing, withManager: true, respond: async () => absent })
  const text = textOf(await page.render())
  assert.match(text, /缺少前置组件/)
  assert.match(text, /安装前置组件/)
  assert.doesNotMatch(text, /启用窗口观察/, 'the settings form must not offer writes while loading')
})

test('an installed prerequisite shows no install prompt, and one without the manager only explains', async () => {
  const ready = await evaluate({ registry: registryReady, respond: async () => absent })
  await ready.render()
  assert.doesNotMatch(textOf(await ready.render()), /安装前置组件/)

  const noManager = await evaluate({ registry: registryMissing, withManager: false, respond: async () => absent })
  await noManager.render()
  assert.match(textOf(await noManager.render()), /@deepseek-ai\/dsh-computer-use/)
  assert.doesNotMatch(textOf(await noManager.render()), /安装前置组件/)
  assert.equal(noManager.installs.length, 0)
})
