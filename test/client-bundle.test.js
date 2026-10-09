import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const bundle = await readFile(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')

const absent = { installed: false, supported: true, version: '0.28.0', installedVersion: null }
const present = { installed: true, supported: true, version: '0.28.0', installedVersion: '0.28.0' }

/** Evaluate the shipped browser artifact against stub Cordis, React, and fetch seams. */
async function evaluate({ locale = 'zh-CN', respond = async () => absent } = {}) {
  const registered = []
  const deferredSlot = new Map()
  const effects = []
  const dictionaries = new Map()
  const state = []
  const dependencyHistory = []
  let cursor = 0
  let effectCursor = 0
  const seen = []
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children }, children } },
    useState(initial) {
      const index = cursor
      cursor += 1
      if (state.length <= index) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], value => { state[index] = value }]
    },
    useEffect(run, deps) {
      // Effects are identified by hook order, so dependency history is positional.
      const index = effectCursor
      effectCursor += 1
      const previous = dependencyHistory[index]
      const changed = previous === undefined || deps === undefined || deps.length !== previous.length
        || deps.some((dep, position) => !Object.is(dep, previous[position]))
      dependencyHistory[index] = deps
      if (changed) effects.push(run)
    },
  }
  const slots = {
    inject(name, register) { deferredSlot.set(name, register) },
    register(spec, Component) { registered.push({ spec, Component }); return () => { registered.length -= 1 } },
  }
  const active = locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const localeService = {
    register(namespace, dictionary) { dictionaries.set(namespace, dictionary); return () => dictionaries.delete(namespace) },
    bind(namespace) { return key => dictionaries.get(namespace)?.[active]?.[key] ?? key },
  }
  let registration
  const sandbox = {
    navigator: { language: locale },
    confirm: () => true,
    setTimeout,
    fetch: async (path, options) => {
      seen.push({ path, options })
      const value = await respond(path, options)
      return value instanceof Error ? value : { ok: true, json: async () => value }
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
  const scope = { slots, locale: localeService, effect: run => { run(); return () => {} } }
  namespace.apply(scope)
  assert.equal(deferredSlot.has('settings.section'), true, 'registration waits for the Settings section slot')
  for (const register of deferredSlot.values()) register()

  const settle = async () => { for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setImmediate(resolve)) }
  const draw = () => {
    cursor = 0
    effectCursor = 0
    effects.length = 0
    // The DSH renderer passes a translation function for options.locale.
    const t = key => dictionaries.get('computerUseSafeWin')?.[active]?.[key] ?? key
    const element = registered[0].Component({ close() {}, t })
    for (const effect of effects) effect()
    return element
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
    const button = element.children.find(child => child.type === 'div').children
      .find(child => JSON.stringify(child.props).includes(label))
    assert.ok(button, `no ${label} button`)
    await button.props.onClick()
    await new Promise(resolve => setImmediate(resolve))
  }
  return { namespace, registered, render, press, seen, spec: registered[0].spec }
}

const textOf = element => JSON.stringify(element)

test('the shipped client half registers a Settings section and renders its driver panel', async () => {
  const page = await evaluate()
  assert.deepEqual([...page.namespace.inject].sort(), ['locale', 'slots'])
  assert.equal(page.registered.length, 1)
  // A first-class Settings nav entry, not a block inside the Plugins page.
  assert.equal(page.spec.name, 'settings.section')
  assert.equal(page.spec.id, 'computer-use-safe-win')
  assert.equal(typeof page.spec.order, 'number')
  assert.equal(typeof page.spec.label, 'function', 'the nav label must be localized')
  assert.equal(page.spec.label(), '电脑操控')
  const text = textOf(await page.render())
  assert.match(text, /Cua Driver/)
  assert.match(text, /先安装受管驱动/)
  assert.doesNotMatch(text, /undefined/)
  assert.match(text, /测试驱动/)
  assert.match(text, /安装驱动/)
  assert.match(text, /未安装 · 目标版本: 0\.28\.0/)
  assert.deepEqual(page.seen.map(call => call.path), ['/api/computer-use-safe-win/status'])
})

test('the Settings nav label follows the active locale', async () => {
  assert.equal((await evaluate({ locale: 'en-US' })).spec.label(), 'Computer Use')
})

test('opening the settings page tests status once and reports the pinned target version', async () => {
  const page = await evaluate({ locale: 'en-US' })
  const text = textOf(await page.render())
  assert.match(text, /Test driver/)
  assert.match(text, /Install driver/)
  assert.match(text, /Not installed/)
  assert.match(text, /0\.28\.0/)
  assert.deepEqual(page.seen.map(call => call.path), ['/api/computer-use-safe-win/status'])
})

test('the panel is not registered as a Plugins page block any more', async () => {
  const page = await evaluate()
  assert.notEqual(page.spec.name, 'plugins.bundle.config')
  assert.equal(page.spec.key, undefined, 'a Settings section is keyed by id, not by bundle package name')
})

test('the install button posts an explicit same-origin confirmation and re-tests', async () => {
  let installed = false
  const page = await evaluate({ locale: 'en-US', respond: async path => {
    if (path.endsWith('/install')) { installed = true; return present }
    return installed ? present : absent
  } })
  await page.render()
  const element = await page.render()
  await page.press(element, 'Install driver')
  const install = page.seen.find(call => call.path.endsWith('/install'))
  assert.equal(install.options.method, 'POST')
  assert.equal(install.options.headers['x-computer-use-confirm'], 'install-pinned-driver')
  assert.match(textOf(await page.render()), /Managed driver installed \(runtime not tested\)/)
})

test('a refused installation surfaces the Host error without claiming success', async () => {
  const page = await evaluate({ locale: 'en-US', respond: async path => {
    if (path.endsWith('/install')) return Object.assign(new Error('local browser required'), { ok: false, json: async () => ({ error: 'Driver installation requires the local authenticated browser' }) })
    return absent
  } })
  await page.render()
  const element = await page.render()
  await page.press(element, 'Install driver')
  assert.match(textOf(await page.render()), /local authenticated browser/)
})