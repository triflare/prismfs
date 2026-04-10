export default {
  // NOTE: This rule uses lightweight heuristics to find UI-facing strings
  // (properties named `name` or `text`) inside likely extension/block
  // descriptor objects. These heuristics are intentionally conservative to
  // avoid false positives in unrelated config objects.
  //
  // Limitations: this approach can produce false negatives for unconventional
  // patterns such as dynamically-constructed descriptors, uncommon variable
  // names, wrappers, or other non-standard shapes. Maintainters should
  // manually verify unusual descriptor code and extend the parent checks
  // below if necessary.
  meta: {
    type: 'problem',
    docs: {
      description: 'Require Scratch.translate for UI-facing strings (name and text properties)',
      recommended: false,
    },
    fixable: 'code',
    messages: {
      useTranslate: 'UI-facing string should use Scratch.translate(...)',
    },
  },
  create(context) {
    /**
     * Determines whether an AST node represents a plain string literal.
     * @param {object} node - The AST node to inspect.
     * @returns {boolean} `true` if the node is a string `Literal` or a `TemplateLiteral` with no expressions, `false` otherwise.
     */
    function isPlainStringNode(node) {
      return (
        node &&
        ((node.type === 'Literal' && typeof node.value === 'string') ||
          (node.type === 'TemplateLiteral' && node.expressions.length === 0))
      );
    }

    function isScratchTranslateCall(node) {
      if (!node || node.type !== 'CallExpression') return false;
      const callee = node.callee;
      return (
        callee &&
        callee.type === 'MemberExpression' &&
        callee.object &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'Scratch' &&
        ((callee.property.type === 'Identifier' && callee.property.name === 'translate') ||
          (callee.property.type === 'Literal' && callee.property.value === 'translate'))
      );
    }

    return {
      Property(node) {
        const keyNode = node.key;
        const keyName =
          keyNode &&
          (keyNode.type === 'Identifier'
            ? keyNode.name
            : keyNode.type === 'Literal'
              ? keyNode.value
              : null);
        if (!keyName) return;
        if (keyName !== 'name' && keyName !== 'text') return;

        // Narrow scope: only check properties that are part of ObjectExpressions
        // which are likely to be extension/block descriptors. This avoids flagging
        // unrelated config objects.
        //
        // NOTE: This is a heuristic and may miss unconventional descriptor shapes
        // (e.g. dynamically-built descriptors, non-standard variable names,
        // wrappers). Such cases can produce false negatives — maintainers should
        // manually verify unusual patterns and update these checks if needed.
        const parentObj = node.parent;
        if (!parentObj || parentObj.type !== 'ObjectExpression') return;
        const grand = parentObj.parent;
        let allowed = false;

        // Common shapes where UI strings appear:
        // - ObjectExpression inside an ArrayExpression (e.g., blocks: [ { ... } ])
        // - Returned Object (ReturnStatement)
        // - Property whose key indicates descriptor (blocks, manifest, info, extension, descriptor)
        // - VariableDeclarator with known identifier (blocks, descriptor, manifest)
        // - AssignmentExpression (module.exports = { ... })
        if (grand) {
          if (grand.type === 'ArrayExpression' || grand.type === 'ReturnStatement') {
            allowed = true;
          } else if (grand.type === 'Property') {
            const gk = grand.key;
            const gkName =
              gk && (gk.type === 'Identifier' ? gk.name : gk.type === 'Literal' ? gk.value : null);
            if (
              ['blocks', 'extensions', 'extension', 'manifest', 'info', 'descriptor'].includes(
                gkName
              )
            )
              allowed = true;
          } else if (grand.type === 'VariableDeclarator') {
            const id = grand.id;
            if (
              id &&
              id.type === 'Identifier' &&
              ['blocks', 'descriptor', 'info', 'extension', 'manifest'].includes(id.name)
            )
              allowed = true;
          } else if (grand.type === 'AssignmentExpression') {
            allowed = true;
          }
        }
        if (!allowed) return;

        const value = node.value;
        // Accept calls to Scratch.translate(...) and template/call variants
        if (isScratchTranslateCall(value)) return;

        if (!isPlainStringNode(value)) return;

        context.report({
          node: value,
          messageId: 'useTranslate',
          fix(fixer) {
            let text;
            if (value.type === 'Literal') {
              text = JSON.stringify(value.value);
            } else {
              // TemplateLiteral with no expressions (ensured earlier)
              text = JSON.stringify(value.quasis.map(q => q.value.cooked).join(''));
            }
            return fixer.replaceText(value, `Scratch.translate(${text})`);
          },
        });
      },
    };
  },
};
