// A small zod-style schema library. Every LLM response is parsed with one of these
// schemas, and the same schema is turned into JSON Schema for providers that support
// structured output. Kept in-house so the static site has no runtime dependency.

export class SchemaError extends Error {
  constructor(issues) {
    super(issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`).join('; '));
    this.name = 'SchemaError';
    this.issues = issues;
  }
}

const INVALID = Symbol('invalid');

class Schema {
  constructor() {
    this._optional = false;
    this._hasDefault = false;
    this._default = undefined;
    this._desc = undefined;
    this._refinements = [];
  }

  _clone() {
    const c = Object.create(Object.getPrototypeOf(this));
    Object.assign(c, this);
    c._refinements = [...this._refinements];
    return c;
  }

  optional() { const c = this._clone(); c._optional = true; return c; }
  default(v) { const c = this._clone(); c._hasDefault = true; c._default = v; return c; }
  describe(text) { const c = this._clone(); c._desc = text; return c; }
  refine(fn, message) { const c = this._clone(); c._refinements.push({ fn, message }); return c; }

  parse(value) {
    const issues = [];
    const out = this._run(value, [], issues);
    if (issues.length) throw new SchemaError(issues);
    return out;
  }

  safeParse(value) {
    try {
      return { success: true, data: this.parse(value) };
    } catch (e) {
      if (e instanceof SchemaError) return { success: false, error: e };
      throw e;
    }
  }

  _run(value, path, issues) {
    if (value === undefined || value === null) {
      if (this._hasDefault) return JSON.parse(JSON.stringify(this._default));
      if (this._optional) return undefined;
      issues.push({ path, message: 'is required' });
      return undefined;
    }
    const before = issues.length;
    const out = this._check(value, path, issues);
    if (out === INVALID || issues.length > before) return undefined;
    for (const r of this._refinements) {
      if (!r.fn(out)) issues.push({ path, message: r.message });
    }
    return out;
  }

  /** JSON Schema in the subset structured-output APIs accept (no numeric or length constraints). */
  jsonSchema() {
    const js = this._json();
    if (this._desc) js.description = this._desc;
    return js;
  }

  get isOptional() { return this._optional || this._hasDefault; }

  /** @returns {any} */
  _check(v, path, issues) { throw new Error('not implemented'); }

  /** @returns {Record<string, any>} */
  _json() { return {}; }
}

class StringSchema extends Schema {
  constructor() { super(); this._min = null; this._max = null; this._regex = null; this._regexMsg = null; }
  min(n) { const c = this._clone(); c._min = n; return c; }
  max(n) { const c = this._clone(); c._max = n; return c; }
  nonempty() { return this.min(1); }
  regex(re, message) { const c = this._clone(); c._regex = re; c._regexMsg = message; return c; }
  _check(v, path, issues) {
    if (typeof v !== 'string') { issues.push({ path, message: `expected a string, got ${typeof v}` }); return INVALID; }
    if (this._min !== null && v.length < this._min) issues.push({ path, message: `must be at least ${this._min} characters` });
    if (this._max !== null && v.length > this._max) issues.push({ path, message: `must be at most ${this._max} characters (got ${v.length})` });
    if (this._regex && !this._regex.test(v)) issues.push({ path, message: this._regexMsg || `must match ${this._regex}` });
    return v;
  }
  _json() { return { type: 'string' }; }
}

class NumberSchema extends Schema {
  constructor() { super(); this._int = false; this._min = null; this._max = null; }
  int() { const c = this._clone(); c._int = true; return c; }
  min(n) { const c = this._clone(); c._min = n; return c; }
  max(n) { const c = this._clone(); c._max = n; return c; }
  _check(v, path, issues) {
    let n = v;
    if (typeof n === 'string' && n.trim() !== '' && !Number.isNaN(Number(n))) n = Number(n);
    if (typeof n !== 'number' || Number.isNaN(n)) { issues.push({ path, message: `expected a number, got ${typeof v}` }); return INVALID; }
    if (this._int && !Number.isInteger(n)) issues.push({ path, message: 'must be a whole number' });
    if (this._min !== null && n < this._min) issues.push({ path, message: `must be at least ${this._min} (got ${n})` });
    if (this._max !== null && n > this._max) issues.push({ path, message: `must be at most ${this._max} (got ${n})` });
    return n;
  }
  _json() { return { type: this._int ? 'integer' : 'number' }; }
}

class BooleanSchema extends Schema {
  _check(v, path, issues) {
    if (typeof v !== 'boolean') { issues.push({ path, message: `expected true or false, got ${typeof v}` }); return INVALID; }
    return v;
  }
  _json() { return { type: 'boolean' }; }
}

class EnumSchema extends Schema {
  constructor(values) { super(); this.values = values; }
  _check(v, path, issues) {
    if (!this.values.includes(v)) { issues.push({ path, message: `must be one of ${this.values.join(', ')} (got ${JSON.stringify(v)})` }); return INVALID; }
    return v;
  }
  _json() { return { type: 'string', enum: [...this.values] }; }
}

class ArraySchema extends Schema {
  constructor(item) { super(); this.item = item; this._min = null; this._max = null; }
  min(n) { const c = this._clone(); c._min = n; return c; }
  max(n) { const c = this._clone(); c._max = n; return c; }
  _check(v, path, issues) {
    if (!Array.isArray(v)) { issues.push({ path, message: 'expected a list' }); return INVALID; }
    if (this._min !== null && v.length < this._min) issues.push({ path, message: `needs at least ${this._min} item(s)` });
    if (this._max !== null && v.length > this._max) issues.push({ path, message: `allows at most ${this._max} item(s) (got ${v.length})` });
    return v.map((item, i) => this.item._run(item, [...path, i], issues));
  }
  _json() { return { type: 'array', items: this.item.jsonSchema() }; }
}

class ObjectSchema extends Schema {
  constructor(shape) { super(); this.shape = shape; }
  extend(more) { return new ObjectSchema({ ...this.shape, ...more }); }
  _check(v, path, issues) {
    if (typeof v !== 'object' || Array.isArray(v)) { issues.push({ path, message: 'expected an object' }); return INVALID; }
    const out = {};
    for (const [key, schema] of Object.entries(this.shape)) {
      const r = schema._run(v[key], [...path, key], issues);
      if (r !== undefined) out[key] = r;
    }
    return out; // unknown keys are dropped, as zod does by default
  }
  _json() {
    const properties = {};
    const required = [];
    for (const [key, schema] of Object.entries(this.shape)) {
      properties[key] = schema.jsonSchema();
      if (!schema.isOptional) required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }
}

class AnySchema extends Schema {
  _check(v) { return v; }
  _json() { return {}; }
}

export const s = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  int: () => new NumberSchema().int(),
  boolean: () => new BooleanSchema(),
  enum: (values) => new EnumSchema(values),
  array: (item) => new ArraySchema(item),
  object: (shape) => new ObjectSchema(shape),
  any: () => new AnySchema(),
};
