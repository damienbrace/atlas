// Turns a plain-English question into the words worth searching for:
// "What did the supplier quote for face bricks last year?" → supplier, quote, face, brick

const STOP = new Set(
  (
    "a about after again all also am an and any are as at be been before being but by can could did do does doing " +
    "down during each few for from had has have having he her here hers him his how i if in into is it its just " +
    "last me more most my no nor not now of off on once only or other our out over own same she should so some " +
    "such than that the their them then there these they this those through to too under until up very was we " +
    "were what when where which while who whom why will with would you your year years month week day today " +
    "yesterday tell show find get got say said ask asked know thing things anything something much many please"
  ).split(" "),
);

function stem(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function searchWords(question: string, max = 8) {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$#.\s-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map(stem);
  return [...new Set(words)].slice(0, max);
}
