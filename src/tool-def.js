/**
 * Build a `dsh-tools` registry definition without importing `@deepseek-ai/dsh-tools`.
 *
 * Importing the host package at runtime is what made this plugin unsafe to publish:
 * declaring it as a normal dependency made every DSH profile materialise its own
 * physical copy of the core tool runtime, so the host's `TOOL_RUNTIME_SCHEDULER`
 * symbol and the copy's symbol became two different keys on the same registry
 * object, and `dsh-agent-loop` failed with
 * `Cannot read properties of undefined (reading 'prepare')`.
 *
 * `ToolRuntime.register()` accepts a plain registry definition, and everything
 * `defineTool()` adds is (a) compiling the author-facing parameter spec into raw
 * JSON Schema and (b) validating model arguments before the body runs. Both are
 * reproduced here so no host module is needed at runtime. The compiled shape is
 * identical to `defineTool()`'s, verified against the real registry.
 */

/** Raw JSON Schema node types the host tool registry accepts. */
const TYPE_SCHEMA = {
  string: { type: 'string' },
  integer: { type: 'integer' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  null: { type: 'null' },
}

/**
 * Compile the author-facing per-property parameter map into raw JSON Schema.
 * Mirrors `parameterSchemaSpecToJsonSchema()`: an object schema whose `required`
 * array lists the properties declared `required: true`.
 */
export function parametersToJsonSchema(parameters) {
  const properties = {}
  const required = []
  for (const [name, property] of Object.entries(parameters ?? {})) {
    if (!property || typeof property !== 'object') throw new Error(`parameter "${name}" must be an object`)
    // The host schema compiler rejects an explicit `required: false`; a property
    // is required by declaring `required: true` and optional by omitting it.
    if (property.required !== undefined && property.required !== true) {
      throw new Error(`parameter "${name}".required must be true when present`)
    }
    if (property.type !== undefined && !(property.type in TYPE_SCHEMA) && property.type !== 'array') {
      throw new Error(`parameter "${name}" has an unsupported type ${String(property.type)}`)
    }
    const schema = { ...TYPE_SCHEMA[property.type] }
    if (property.type === 'array') {
      if (property.items === undefined) throw new Error(`parameter "${name}" is missing items`)
      schema.type = 'array'
      schema.items = property.items
    }
    for (const keyword of ['enum', 'description', 'default', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern']) {
      if (property[keyword] !== undefined) schema[keyword] = property[keyword]
    }
    properties[name] = schema
    if (property.required === true) required.push(name)
  }
  return { type: 'object', properties, ...required.length > 0 ? { required } : {} }
}

/**
 * Validate model arguments against a compiled JSON Schema subset, returning the
 * violations the way `validateArgs()` does so a bad call stays an ordinary error
 * result instead of aborting the turn.
 */
export function validateArgs(schema, args, path = '') {
  const violations = []
  const at = (segment) => path ? `${path}.${segment}` : segment
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    if (schema.type === 'object') return [{ path, message: 'must be an object' }]
    return violations
  }
  if (schema.type !== 'object') return violations
  for (const key of schema.required ?? []) {
    if (args[key] === undefined) violations.push({ path: at(key), message: 'is required' })
  }
  for (const [key, definition] of Object.entries(schema.properties ?? {})) {
    const value = args[key]
    if (value === undefined) continue
    const expected = definition.type
    if (expected === 'string' && typeof value !== 'string') violations.push({ path: at(key), message: `must be a string` })
    else if (expected === 'integer' && !Number.isInteger(value)) violations.push({ path: at(key), message: 'must be an integer' })
    else if (expected === 'number' && typeof value !== 'number') violations.push({ path: at(key), message: 'must be a number' })
    else if (expected === 'boolean' && typeof value !== 'boolean') violations.push({ path: at(key), message: 'must be a boolean' })
    else if (expected === 'array' && !Array.isArray(value)) violations.push({ path: at(key), message: 'must be an array' })
    if (definition.enum !== undefined && !definition.enum.includes(value)) violations.push({ path: at(key), message: 'must be one of the allowed values' })
  }
  return violations
}

/** Fail the call as an ordinary error result carrying the argument violations. */
export class ToolArgsError extends Error {
  constructor(violations) {
    super(`invalid tool arguments: ${violations.map(item => `${item.path} ${item.message}`).join('; ')}`)
    this.name = 'ToolArgsError'
    this.violations = violations
  }
}

/**
 * Define one tool the registry accepts, compiling and validating parameters the
 * way the host's `defineTool()` does.
 */
export function defineTool({ name, description, parameters, output, execute }) {
  if (typeof name !== 'string' || !name) throw new Error('defineTool(): a tool name is required')
  if (!output || typeof output !== 'object' || typeof output.render !== 'function') {
    throw new Error(`defineTool(${name}): output must declare { schema, render }`)
  }
  const compiled = parametersToJsonSchema(parameters)
  return {
    name,
    description,
    parameters: compiled,
    output,
    async execute(args, exec) {
      const violations = validateArgs(compiled, args)
      if (violations.length > 0) throw new ToolArgsError(violations)
      return execute(args, exec)
    },
  }
}