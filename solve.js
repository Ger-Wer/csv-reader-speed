// Fast drop-in for csv-reader 1.0.0 (make.fun).
//
// Written from scratch from the competition's RULES.txt: the same answers
// as csv-reader 1.0.0 on every input, but a single regex scan instead of
// one character at a time. Fields are cut out with String.slice between
// the special characters (comma, quote, CR, LF) that one global regex
// finds; a field that holds no special character inside is a single
// slice, with no concatenation at all.
//
// Semantics (csv-reader 1.0.0):
// - a U+FEFF at the very start is dropped;
// - a record ends at LF or CRLF; a line left with no characters is no record;
// - outside quotes a CR not followed by LF is dropped (stray_cr);
// - a field that opens with a quote runs to the next quote that is not
//   doubled ("" inside is one quote, each CRLF or lone CR inside is read
//   as LF); what follows its closing quote, up to the next comma or line
//   break, is appended as it stands (quote_junk, when the field ends);
//   a quote that never closes is a literal character and the text after
//   it is read again as unquoted (unterminated_quote);
// - a quote inside an unquoted field is a literal character;
// - fields stay strings, never trimmed or converted;
// - columns is the first record when header is true, else null; rows holds
//   the records after it, each padded (short_row, with fields: its count)
//   or cut (long_row, with extra: the cut fields) to the first record's
//   width; each error is {code, line, row}, in the order met, line the
//   1-based line its record starts on, row its index in rows (null for
//   the header).

// One regex finds every character that can change the parse: comma,
// quote, CR, LF. It is module-level so it is compiled once; every scan
// sets lastIndex before it starts.
const SPECIAL = /[",\r\n]/g;

const COMMA = 0;
const BREAK = 1;
const END = 2;

// Reads unquoted characters from `start`, appending them to `initial`,
// up to the next comma or line break. A CR not followed by LF is dropped
// (stray_cr). Results are returned on the function object to avoid
// allocating a result object per field: the hot path calls this for
// almost every field.
function readUnquoted(text, n, errors, recordLine, recordRow, initial, start, line) {
  let value = initial;
  let seg = start;
  let added = 0;
  let pos = start;
  SPECIAL.lastIndex = start;
  let m;
  let ended = END;
  while ((m = SPECIAL.exec(text)) !== null) {
    const i = m.index;
    const c = text.charCodeAt(i);
    if (c === 44) {
      // Comma: the field ends, the record goes on.
      value += text.slice(seg, i);
      added += i - seg;
      pos = i + 1;
      ended = COMMA;
      break;
    }
    if (c === 10) {
      // LF: the field and the record end.
      value += text.slice(seg, i);
      added += i - seg;
      pos = i + 1;
      line += 1;
      ended = BREAK;
      break;
    }
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        // CRLF: the field and the record end.
        value += text.slice(seg, i);
        added += i - seg;
        pos = i + 2;
        line += 1;
        ended = BREAK;
        break;
      }
      // A CR not followed by LF is dropped (stray_cr); the field goes on.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      value += text.slice(seg, i);
      added += i - seg;
      seg = i + 1;
      pos = i + 1;
      SPECIAL.lastIndex = i + 1;
      continue;
    }
    // A quote inside an unquoted field is a literal character: it stays
    // inside the slice, seg untouched.
  }
  if (m === null) {
    value += text.slice(seg, n);
    added += n - seg;
    pos = n;
    ended = END;
  }
  readUnquoted.value = value;
  readUnquoted.ended = ended;
  readUnquoted.added = added;
  readUnquoted.pos = pos;
  readUnquoted.line = line;
}

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  recordLoop: while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;

    fieldLoop: while (true) {
      let value;
      let ended;
      if (text.charCodeAt(pos) === 34) {
        // ---- quoted field ----
        quoted = true;
        const open = pos;
        const openLine = line;
        let seg = pos + 1;
        value = '';
        let closed = false;
        SPECIAL.lastIndex = pos + 1;
        let m;
        while ((m = SPECIAL.exec(text)) !== null) {
          const i = m.index;
          const c = text.charCodeAt(i);
          if (c === 34) {
            if (text.charCodeAt(i + 1) === 34) {
              // Doubled quote: one literal quote, keep scanning.
              value += text.slice(seg, i) + '"';
              seg = i + 2;
              SPECIAL.lastIndex = i + 2;
              continue;
            }
            value += text.slice(seg, i);
            pos = i + 1;
            closed = true;
            break;
          }
          if (c === 13) {
            // CRLF and a lone CR inside quotes are each one LF.
            value += text.slice(seg, i) + '\n';
            line += 1;
            pos = i + 1;
            if (text.charCodeAt(pos) === 10) pos += 1;
            seg = pos;
            SPECIAL.lastIndex = pos;
            continue;
          }
          if (c === 10) {
            line += 1;
            // The LF stays inside the slice: seg is untouched.
            continue;
          }
          // A comma inside quotes is a literal character: seg untouched.
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          readUnquoted(text, n, errors, recordLine, recordRow, '"', open + 1, line);
          value = readUnquoted.value;
          ended = readUnquoted.ended;
          pos = readUnquoted.pos;
          line = readUnquoted.line;
          fields.push(value);
          if (ended === COMMA) continue fieldLoop;
          break fieldLoop;
        }
        if (pos >= n) {
          fields.push(value);
          break fieldLoop;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos += 1;
          fields.push(value);
          continue fieldLoop;
        }
        if (c === 10) {
          pos += 1;
          line += 1;
          fields.push(value);
          break fieldLoop;
        }
        if (c === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fields.push(value);
          break fieldLoop;
        }
        // What follows the closing quote is appended as it stands, up to
        // the next comma or line break.
        readUnquoted(text, n, errors, recordLine, recordRow, value, pos, line);
        if (readUnquoted.added > 0) {
          errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        }
        value = readUnquoted.value;
        ended = readUnquoted.ended;
        pos = readUnquoted.pos;
        line = readUnquoted.line;
        fields.push(value);
        if (ended === COMMA) continue fieldLoop;
        break fieldLoop;
      }

      // ---- unquoted field ----
      quoted = false;
      readUnquoted(text, n, errors, recordLine, recordRow, '', pos, line);
      value = readUnquoted.value;
      ended = readUnquoted.ended;
      pos = readUnquoted.pos;
      line = readUnquoted.line;
      fields.push(value);
      if (ended === COMMA) continue fieldLoop;
      break fieldLoop;
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue recordLoop;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue recordLoop;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
