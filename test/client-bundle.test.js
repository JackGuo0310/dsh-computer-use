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
  const state = []
  const effects = []
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
  namespace.apply({ slots })
  assert.equal(deferredSlot.has('plugins.bundle.config'), true, 'registration waits for the settings slot')
  for (const register of deferredSlot.values()) register()

  const settle = async () => { for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setImmediate(resolve)) }
  const draw = view => {
    cursor = 0
    effectCursor = 0
    effects.length = 0
    const element = registered[0].Component({ view })
    for (const effect of effects) effect()
    return element
  }
  const render = async view => {
    let element = draw(view)
    for (let frame = 0; frame < 4; frame += 1) {
      const before = textOf(element)
      await settle()
      element = draw(view)
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

test('the shipped client half waits for the settings slot and renders its own driver panel', async () => {
  const page = await evaluate()
  assert.equal([...page.namespace.inject].join(), 'slots')
  assert.equal(page.registered.length, 1)
  assert.equal(page.spec.name, 'plugins.bundle.config')
  // The Plugins page renders this slot with the installed package name as its entry key.
  assert.equal(page.spec.key, 'dsh-computer-use-safe-win')
  const text = textOf(await page.render('page'))
  assert.match(text, /Cua Driver/)
  assert.match(text, /测试驱动/)
  assert.match(text, /安装驱动/)
  assert.match(text, /未安装 · 目标版本: 0\.28\.0/)
  assert.deepEqual(page.seen.map(call => call.path), ['/api/computer-use-safe-win/status'])
})

test('opening the settings page tests status once and reports the pinned target version', async () => {
  const page = await evaluate({ locale: 'en-US' })
  const text = textOf(await page.render('page'))
  assert.match(text, /Test driver/)
  assert.match(text, /Install driver/)
  assert.match(text, /Not installed/)
  assert.match(text, /0\.28\.0/)
  assert.deepEqual(page.seen.map(call => call.path), ['/api/computer-use-safe-win/status'])
})

test('nothing renders or calls the Host outside its own settings page', async () => {
  const page = await evaluate()
  assert.equal(await page.render('row'), null)
  assert.deepEqual(page.seen, [])
})

test('the install button posts an explicit same-origin confirmation and re-tests', async () => {
  let installed = false
  const page = await evaluate({ locale: 'en-US', respond: async path => {
    if (path.endsWith('/install')) { installed = true; return present }
    return installed ? present : absent
  } })
  await page.render('page')
  const element = await page.render('page')
  await page.press(element, 'Install driver')
  const install = page.seen.find(call => call.path.endsWith('/install'))
  assert.equal(install.options.method, 'POST')
  assert.equal(install.options.headers['x-computer-use-confirm'], 'install-pinned-driver')
  assert.match(textOf(await page.render('page')), /Managed driver installed \(runtime not tested\)/)
})

test('a refused installation surfaces the Host error without claiming success', async () => {
  const page = await evaluate({ locale: 'en-US', respond: async path => {
    if (path.endsWith('/install')) return Object.assign(new Error('local browser required'), { ok: false, json: async () => ({ error: 'Driver installation requires the local authenticated browser' }) })
    return absent
  } })
  await page.render('page')
  const element = await page.render('page')
  await page.press(element, 'Install driver')
  assert.match(textOf(await page.render('page')), /local authenticated browser/)
})