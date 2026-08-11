export function renderDraftSubject(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match: string, key: string) => (key in tokens ? tokens[key] ?? match : match));
}

export const renderDraftBody = renderDraftSubject;
