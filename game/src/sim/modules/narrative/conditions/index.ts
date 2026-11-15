/**
 * The condition language (design §29.7): lexer → Pratt parser → AST → closures, plus the static checker.
 * Owned by the narrative module; other modules contribute functions through `SimModule.conditionFns`.
 */
export { checkExpression, reservedFunctionNames, suggest, type CheckOptions, type CheckResult, type StaticType } from './checker';
export { compileExpression, compileSource, evaluate, type Evaluator } from './compile';
export { argShape, COUNT_COLLECTIONS, COUNT_TALLIES, INTRINSICS, isIntrinsic, narrativeConditionFns, tallyKey, zodLeafKind } from './functions';
export { ConditionSyntaxError, MAX_EXPRESSION_LENGTH, tokenize, type Token } from './lexer';
export { MAX_ARGS, MAX_NESTING, parseExpression, printExpression, type BinaryOp, type Expr, type UnaryOp } from './parser';
export { checkPath, compilePath, ENTITY_ROOTS, ENTITY_TYPES, fieldsOf, GLOBAL_ROOTS, ROOTS, type PathType } from './paths';
export { ConditionRuntimeError, toValue, truthy, type EvalScope, type Value } from './scope';
