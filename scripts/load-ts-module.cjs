const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const moduleCache = new Map();

function loadTsModule(filePath, stubs = {}) {
  const resolvedPath = resolveFile(filePath);
  if (moduleCache.has(resolvedPath)) return moduleCache.get(resolvedPath).exports;

  const source = fs.readFileSync(resolvedPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;

  const module = { exports: {} };
  moduleCache.set(resolvedPath, module);

  function localRequire(request) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request.startsWith("@/")) {
      return loadTsModule(path.join(process.cwd(), "src", request.slice(2)), stubs);
    }
    if (request.startsWith(".")) {
      return loadTsModule(path.resolve(path.dirname(resolvedPath), request), stubs);
    }
    return require(request);
  }

  const sandbox = {
    exports: module.exports,
    module,
    require: localRequire,
    console,
    Intl,
    Date,
    Number,
    String,
    Boolean,
    Array,
    JSON,
    RegExp,
    Math,
    Buffer,
    URL,
    process
  };

  vm.runInNewContext(transpiled, sandbox, { filename: resolvedPath });
  return module.exports;
}

function resolveFile(filePath) {
  const candidates = [
    filePath,
    `${filePath}.ts`,
    `${filePath}.tsx`,
    `${filePath}.js`,
    `${filePath}.cjs`,
    path.join(filePath, "index.ts"),
    path.join(filePath, "index.tsx")
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Cannot resolve TypeScript module: ${filePath}`);
  return found;
}

module.exports = { loadTsModule };
