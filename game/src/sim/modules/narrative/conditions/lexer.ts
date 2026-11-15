/**
 * Lexer of the condition language (design §29.7). Tokens:
 *   numbers      12  0.5            (no leading '.', no exponent)
 *   strings      'thriving'  "x"    (escapes: \\ \' \" \n \t)
 *   identifiers  settlement  hasTrait  _x1   (true, false, null are literals)
 *   operators    && || ! == != < <= > >= + - * / %
 *   punctuation  ( ) , .
 * Positions are 0-based offsets into the source; errors carry them for caret diagnostics.
 */

/** Maximum expression length accepted (content guard). */
export const MAX_EXPRESSION_LENGTH = 2000;

export type TokenKind = 'number' | 'string' | 'ident' | 'op' | 'punct' | 'eof';

export interface Token {
  kind: TokenKind;
  /** Source text for idents/ops/punct; the decoded value for strings; the digits for numbers. */
  value: string;
  /** Parsed value of a number token. */
  num?: number;
  /** Offset of the first character. */
  pos: number;
}

/** A syntax error with the offending offset. */
export class ConditionSyntaxError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
    public readonly source: string,
  ) {
    super(`${message} (at column ${pos + 1})`);
    this.name = 'ConditionSyntaxError';
  }

  /** The source with a caret under the offending column (for tool output). */
  caret(): string {
    return `${this.source}\n${' '.repeat(Math.max(0, this.pos))}^`;
  }
}

const TWO_CHAR_OPS = ['&&', '||', '==', '!=', '<=', '>='];
const ONE_CHAR_OPS = '!<>+-*/%';
const PUNCT = '(),.';

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}

/** Splits an expression into tokens (always ending with an 'eof' token). Throws ConditionSyntaxError. */
export function tokenize(source: string): Token[] {
  if (source.length > MAX_EXPRESSION_LENGTH) throw new ConditionSyntaxError(`expression longer than ${MAX_EXPRESSION_LENGTH} characters`, MAX_EXPRESSION_LENGTH, source);
  const out: Token[] = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i] as string;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    const start = i;
    if (isDigit(c)) {
      while (i < n && isDigit(source[i] as string)) i++;
      if (source[i] === '.' && isDigit(source[i + 1] ?? '')) {
        i++;
        while (i < n && isDigit(source[i] as string)) i++;
      }
      if (i < n && isIdentPart(source[i] as string)) throw new ConditionSyntaxError(`malformed number '${source.slice(start, i + 1)}'`, start, source);
      const text = source.slice(start, i);
      out.push({ kind: 'number', value: text, num: Number(text), pos: start });
      continue;
    }
    if (c === "'" || c === '"') {
      let value = '';
      i++;
      let closed = false;
      while (i < n) {
        const ch = source[i] as string;
        if (ch === c) {
          closed = true;
          i++;
          break;
        }
        if (ch === '\\') {
          const esc = source[i + 1];
          if (esc === undefined) break;
          if (esc === 'n') value += '\n';
          else if (esc === 't') value += '\t';
          else if (esc === '\\' || esc === "'" || esc === '"') value += esc;
          else throw new ConditionSyntaxError(`unknown escape '\\${esc}'`, i, source);
          i += 2;
          continue;
        }
        value += ch;
        i++;
      }
      if (!closed) throw new ConditionSyntaxError('unterminated string', start, source);
      out.push({ kind: 'string', value, pos: start });
      continue;
    }
    if (isIdentStart(c)) {
      while (i < n && isIdentPart(source[i] as string)) i++;
      out.push({ kind: 'ident', value: source.slice(start, i), pos: start });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      out.push({ kind: 'op', value: two, pos: start });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(c)) {
      out.push({ kind: 'op', value: c, pos: start });
      i++;
      continue;
    }
    if (PUNCT.includes(c)) {
      out.push({ kind: 'punct', value: c, pos: start });
      i++;
      continue;
    }
    if (c === '&') throw new ConditionSyntaxError("unexpected '&' (use '&&')", start, source);
    if (c === '|') throw new ConditionSyntaxError("unexpected '|' (use '||')", start, source);
    if (c === '=') throw new ConditionSyntaxError("unexpected '=' (use '==' to compare)", start, source);
    throw new ConditionSyntaxError(`unexpected character '${c}'`, start, source);
  }
  out.push({ kind: 'eof', value: '', pos: n });
  return out;
}
