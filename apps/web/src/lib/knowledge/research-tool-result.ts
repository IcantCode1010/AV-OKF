/** Commit tool evidence only after the complete response fits the remaining budget. */
export function acceptResearchToolResult<T>(value: T, remainingCharacters: number, commit?: (value: T) => void): number {
  const characters = JSON.stringify(value).length;
  if (characters > remainingCharacters) throw Error("research_budget_exhausted");
  commit?.(value);
  return characters;
}
