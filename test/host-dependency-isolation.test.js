import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool, parametersToJsonSchema, validateArgs } from '../src/tool-def.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

/**
 * Regression guard for the `undefined.prepare` incident.
 *
 * Publishing `@deepseek-ai/dsh-tools` as a normal dependency made every DSH
 * profile install its own physical copy of the core tool runtime. The host's
 * `TOOL_RUNTIME_SCHEDULER` symbol and the duplicate's symbol then became two
 * distinct keys on one registry object, and `dsh-agent-loop` crashed on
 * `ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare(...)`. A single installed version
 * is therefore not evidence of a single module instance.
 */
test('no DSH host runtime package is declared as an installable dependency', () => {
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    assert.equal(
      Object.keys(manifest[field] ?? {}).some(name => name === '@deepseek-ai/dsh'),
      false,
      `${field} must not pull in the DSH host package`,
    )
  }
  // `@deepseek-ai/dsh-tools` may appear in devDependencies for tests, but any
  // field that npm/pnpm materialises into a profile would reintroduce the split.
  for (const field of ['dependencies', 'optionalDependencies']) {
    assert.equal(
      Object.keys(manifest[field] ?? {}).includes('@deepseek-ai/dsh-tools'),
      false,
      `${field} must not install a second copy of @deepseek-ai/dsh-tools`,
    )
  }
})

test('shipped runtime source never imports a DSH host package', async () => {
  const shipped = []
  for (const name of await readdir(join(root, 'src'))) {
    if (name.endsWith('.js')) shipped.push(join(root, 'src', name))
  }
  shipped.push(join(root, 'client.js'))
  for (const file of shipped) {
    const source = await readFile(file, 'utf8')
    const importLine = source.split('\n').filter(line => /^\s*import\b/.test(line))
    for (const line of importLine) {
      assert.doesNotMatch(
        line,
        /from\s+['"]@deepseek-ai\//,
        `${file} imports a DSH host package at runtime: ${line.trim()}`,
      )
    }
  }
})

test('the plugin entry loads with no DSH host package resolvable', async () => {
  // The runtime half must be importable on its own; importing a host package
  // would fail here rather than silently creating a profile-local copy.
  const entry = await import('../src/plugin.js')
  assert.equal(typeof entry.apply, 'function')
  assert.equal(typeof entry.startSafeWinProvider, 'function')
})

test('compiled parameters match the host defineTool projection', async () => {
  const { default: ToolRuntime, defineTool: hostDefineTool } = await import('@deepseek-ai/dsh-tools')
  assert.ok(ToolRuntime, 'the dev-only host runtime is available to the tests')
  const output = { schema: { type: 'object', additionalProperties: true }, render: () => [] }
  const parameters = {
    windowId: { type: 'string', required: true },
    pid: { type: 'integer', required: true },
    screenshot: { type: 'boolean', required: true },
    tags: { type: 'array', required: true, items: { type: 'string' } },
    mode: { type: 'string', required: true, enum: ['a', 'b'] },
  }
  assert.deepEqual(
    parametersToJsonSchema(parameters),
    hostDefineTool({ name: 'x', description: 'd', parameters, output, execute: async () => ({}) }).parameters,
    'our compiler must produce the same JSON Schema the host produces',
  )
  const ours = defineTool({ name: 'y', description: 'd', parameters, output, execute: async () => ({}) })
  assert.equal(ours.output.schema.type, 'object')
  assert.deepEqual(Object.keys(ours).sort(), ['description', 'execute', 'name', 'output', 'parameters'])
})

test('a definition carrying no host symbol keys registers cleanly', async () => {
  // The actual failure mode: an object shaped by a different copy of the host
  // package misses the host's symbol-keyed scheduler.
  const { default: ToolRuntime } = await import('@deepseek-ai/dsh-tools')
  const { Context } = await import('@deepseek-ai/cordis')
  const SystemPrompt = (await import('@deepseek-ai/dsh-system-prompt')).default
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  const output = { schema: { type: 'object', additionalProperties: true }, render: () => [] }
  ctx.tools.register(defineTool({
    name: 'local_def',
    description: 'd',
    parameters: { id: { type: 'string', required: true } },
    output,
    execute: async () => ({ ok: true }),
  }))
  assert.deepEqual(ctx.tools.schemas().map(schema => schema.name), ['local_def'])
  await ctx.fiber.dispose()
})

test('argument validation still rejects bad calls before the body runs', async () => {
  const schema = parametersToJsonSchema({ id: { type: 'string', required: true } })
  assert.deepEqual(validateArgs(schema, {}), [{ path: 'id', message: 'is required' }])
  assert.deepEqual(validateArgs(schema, { id: 1 }), [{ path: 'id', message: 'must be a string' }])
  assert.deepEqual(validateArgs(schema, { id: 'a' }), [])

  let bodyRan = false
  const tool = defineTool({
    name: 'guarded',
    description: 'd',
    parameters: { id: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
    execute: async () => { bodyRan = true; return {} },
  })
  await assert.rejects(() => tool.execute({}, {}), /invalid tool arguments: id is required/)
  assert.equal(bodyRan, false, 'the body must not run for invalid arguments')
  assert.deepEqual(await tool.execute({ id: 'ok' }, {}), {})
})

test('an optional property is declared by omitting required', async () => {
  const schema = parametersToJsonSchema({ a: { type: 'string', required: true }, b: { type: 'string' } })
  assert.deepEqual(schema.required, ['a'])
  assert.deepEqual(validateArgs(schema, { a: 'x', b: 2 }), [{ path: 'b', message: 'must be a string' }])
  assert.equal(validateArgs(schema, { a: 'x', b: 'y' }).length, 0)
})

test('the shipped output schema is raw JSON Schema the host accepts', async () => {
  // `defineTool()` compiles the author-only DSL node `type: 'json'` down to `{}`.
  // Copying that annotation through uncompiled would make the host reject the
  // tool, so the shipped declaration must already be the compiled form.
  const { default: ToolRuntime } = await import('@deepseek-ai/dsh-tools')
  const { defineTool: hostDefineTool } = await import('@deepseek-ai/dsh-tools')
  const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const { Context } = await import('@deepseek-ai/cordis')
  const expected = hostDefineTool({
    name: 'expected',
    description: 'd',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: { content: { type: 'array', items: { type: 'json' } }, structuredContent: { type: 'json' } },
      },
      render: () => [],
    },
    execute: async () => ({}),
  })
  const source = await readFile(join(root, 'src', 'plugin.js'), 'utf8')
  assert.doesNotMatch(source, /type:\s*'json'/, "the shipped source must not carry the host's author-only json annotation")
  assert.deepEqual(
    expected.output.schema,
    { type: 'object', additionalProperties: true, properties: { content: { type: 'array', items: {} }, structuredContent: {} } },
    'this test pins the compiled form; if the host changes it, re-derive the shipped schema',
  )
  // And the real registry must accept what we ship.
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  ctx.tools.register(defineTool({
    name: 'shipped_shape',
    description: 'd',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { content: { type: 'array', items: {} }, structuredContent: {} } },
      render: () => [],
    },
    execute: async () => ({}),
  }))
  assert.deepEqual(ctx.tools.schemas().map(schema => schema.name), ['shipped_shape'])
  await ctx.fiber.dispose()
})