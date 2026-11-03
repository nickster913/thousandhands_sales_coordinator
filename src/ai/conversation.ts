export type ChatTurn = { role: "user" | "assistant"; content: string };

export type StoredLine = {
  fromMe: boolean;
  type: string;
  text: string | null;
};

function describe(row: StoredLine): string {
  const cap = row.text?.trim() ?? "";
  if (row.type === "text" || row.type === "unknown") return cap;
  const kind = `[${row.type.replace(/_/g, " ")}]`;
  return cap ? `${kind} ${cap}` : kind;
}

/** Maps stored WhatsApp rows to Anthropic chat turns. Consecutive same-role lines are merged. */
export function messagesToTurns(rows: StoredLine[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const row of rows) {
    const content = describe(row);
    if (!content) continue;
    const role: ChatTurn["role"] = row.fromMe ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n${content}`;
    else turns.push({ role, content });
  }
  while (turns[0]?.role === "assistant") turns.shift();
  return turns;
}
