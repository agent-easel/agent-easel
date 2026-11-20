const testModules = new Set([
  "node:test",
  "vite-plus/test",
  "@effect/vitest",
  "@e2e-dev/web",
  "e2e",
]);
const testMethods = new Set([
  "concurrent",
  "each",
  "effect",
  "fails",
  "for",
  "live",
  "only",
  "runIf",
  "sequential",
  "setup",
  "skip",
  "skipIf",
  "todo",
]);

function testIdentifier(callee) {
  switch (callee.type) {
    case "Identifier":
      return callee;
    case "MemberExpression": {
      const method = callee.computed ? callee.property.value : callee.property.name;
      return testMethods.has(method) ? testIdentifier(callee.object) : undefined;
    }
    case "CallExpression":
      return testIdentifier(callee.callee);
    case "TaggedTemplateExpression":
      return testIdentifier(callee.tag);
  }
}

function isTestImport(identifier, sourceCode) {
  for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const binding = scope.set.get(identifier.name);
    if (!binding) continue;

    const definition = binding.defs[0];
    if (definition?.type !== "ImportBinding") return false;

    const source = definition.parent.source.value;
    if (!testModules.has(source) && source !== "./support/test.ts") return false;

    const specifier = definition.node;
    return (
      (specifier.type === "ImportDefaultSpecifier" && source === "node:test") ||
      (specifier.type === "ImportSpecifier" &&
        ["it", "test"].includes(specifier.imported.name ?? specifier.imported.value))
    );
  }
  return false;
}

const straightLine = {
  create(context) {
    const bodies = new WeakSet();

    function registerBody(node) {
      const call = node.parent;
      if (call.type !== "CallExpression" || !call.arguments.includes(node)) return;
      const identifier = testIdentifier(call.callee);
      if (identifier && isTestImport(identifier, context.sourceCode)) bodies.add(node);
    }

    function reportControlFlow(node) {
      if (context.sourceCode.getAncestors(node).some((ancestor) => bodies.has(ancestor))) {
        context.report({
          node,
          message:
            "Keep the test body straight-line. Use assertions, separate cases, or shared setup and cleanup.",
        });
      }
    }

    return {
      ArrowFunctionExpression: registerBody,
      FunctionExpression: registerBody,
      ForStatement: reportControlFlow,
      ForInStatement: reportControlFlow,
      ForOfStatement: reportControlFlow,
      WhileStatement: reportControlFlow,
      DoWhileStatement: reportControlFlow,
      IfStatement: reportControlFlow,
      SwitchStatement: reportControlFlow,
      ConditionalExpression: reportControlFlow,
      TryStatement: reportControlFlow,
    };
  },
};

export default { rules: { "straight-line": straightLine } };
