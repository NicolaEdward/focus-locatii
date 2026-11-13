const crypto = require('node:crypto');
const stable = (value) => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => crypto.createHash('sha256').update(stable(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const charType = type => /^(?:var)?char\(\d+\)$/i.test(type);

/** Resolve only new FK character-column collations. Historical metadata is input,
 * never a mutation target. Conflicting parents, charset/type changes fail closed. */
function resolvePortablePlan({ manifest, parsed, parentShapes, databaseFingerprint }) {
  const tables = clone(manifest.tables);
  const nodes = new Map(), links = new Map();
  function node(table, column) {
    const key = `${table}.${column}`;
    if (nodes.has(key)) return key;
    const spec = tables[table] || parentShapes[table];
    const definition = spec?.columns.find(item => item.name === column);
    if (!definition || spec.storage?.engine !== 'InnoDB') throw new Error('FOREIGN_KEY_PARENT_INCOMPATIBLE');
    nodes.set(key, { table, column, definition, historical: !tables[table] }); links.set(key, key);
    return key;
  }
  function root(key) { const parent = links.get(key); if (parent !== key) links.set(key, root(parent)); return links.get(key); }
  for (const [table, spec] of Object.entries(tables)) for (const fk of spec.foreignKeys) {
    const fromKey = node(table, fk.columnName), toKey = node(fk.targetTable, fk.targetColumn);
    const from = nodes.get(fromKey).definition, to = nodes.get(toKey).definition;
    if (from.type !== to.type || from.charsetName !== to.charsetName) throw new Error('FOREIGN_KEY_TYPE_OR_CHARSET_CHANGE_REJECTED');
    if (from.collationName !== to.collationName && (!charType(from.type) || !from.charsetName || !from.collationName || !to.collationName)) throw new Error('FOREIGN_KEY_NON_CHARACTER_ADAPTATION_REJECTED');
    links.set(root(fromKey), root(toKey));
  }
  const components = new Map();
  for (const [key, value] of nodes) { const component = root(key); components.set(component, [...(components.get(component) || []), value]); }
  const adaptations = [];
  for (const values of components.values()) {
    const constraints = values.filter(value => value.historical);
    const collations = new Set(constraints.map(value => value.definition.collationName));
    if (collations.size > 1) throw new Error('CONFLICTING_HISTORICAL_PARENT_COLLATIONS');
    const desired = constraints[0]?.definition.collationName ?? values[0].definition.collationName;
    for (const value of values.filter(value => !value.historical)) {
      const column = value.definition;
      if (column.collationName === desired) continue;
      if (!charType(column.type) || !/^[A-Za-z0-9_]+$/.test(column.charsetName || '') || !/^[A-Za-z0-9_]+$/.test(desired || '')) throw new Error('FOREIGN_KEY_COLLATION_ADAPTATION_REJECTED');
      adaptations.push({ table: value.table, column: value.column, type: column.type, charset: column.charsetName, fromCollation: column.collationName, toCollation: desired });
      column.collationName = desired;
    }
  }
  adaptations.sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
  const resolved = parsed.map(statement => {
    if (statement.kind !== 'create') return { ...statement };
    let sql = statement.sql;
    for (const change of adaptations.filter(value => value.table === statement.table)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(change.column)) throw new Error('SCHEMA_COLUMN_IDENTIFIER_REJECTED');
      const pattern = new RegExp('^([ \\t]*`' + change.column + '`[ \\t]+(?:VAR)?CHAR\\(\\d+\\))(?:[ \\t]+CHARACTER[ \\t]+SET[ \\t]+[a-z0-9_]+)?(?:[ \\t]+COLLATE[ \\t]+[a-z0-9_]+)?([ \\t].*)$', 'gim');
      let matched = 0;
      sql = sql.replace(pattern, (_all, head, tail) => { matched++; return `${head} CHARACTER SET ${change.charset} COLLATE ${change.toCollation}${tail}`; });
      if (matched !== 1) throw new Error('CREATE_COLUMN_REWRITE_NOT_EXACT');
    }
    return { ...statement, sql };
  });
  const parentMetadataSha256 = hash(parentShapes);
  const resolvedPlanSha256 = hash({ version: 1, databaseFingerprint, migrations: manifest.migrations, parentMetadataSha256, tables, adaptations, statements: resolved.map(value => ({ file: value.file, sql: value.sql })) });
  return { tables, parsed: resolved, adaptations, parentMetadataSha256, resolvedPlanSha256 };
}
module.exports = { resolvePortablePlan };
