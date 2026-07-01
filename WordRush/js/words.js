export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        value += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

export async function loadWords(level) {
  const response = await fetch(level.file, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`CSV load failed: ${level.file}`);
  }

  const rows = parseCsv(await response.text());
  const body = rows.slice(1);
  const seen = new Set();
  const words = [];

  for (const row of body) {
    const english = String(row[0] || "").trim();
    const japanese = String(row[1] || "").trim();
    const key = english.toLowerCase();
    if (!english || !japanese || seen.has(key)) {
      continue;
    }
    seen.add(key);
    words.push({ english, japanese });
  }

  if (words.length < 3) {
    throw new Error(`Not enough words: ${level.file}`);
  }

  return words;
}
