// Saudações genéricas que a IA usa quando o rascunho foi gerado para mais de
// um destinatário ao mesmo tempo (aiService.ts: generateAgentDraft/
// generateTruckerDraft/generateDtaDraft) — quando o operador tinha escolhido
// só 1 contato no momento da geração, a IA já personaliza direto e nenhuma
// dessas frases aparece, então a troca abaixo não tem efeito nesse caso.
// "Prezado(a) {Nome do Contato}," é o mesmo caso, mas para quando o rascunho
// foi gerado com destinatários de mais de uma empresa na fila (o wizard usa
// esse token visível em vez de repetir um nome que só valeria para uma delas).
const GENERIC_GREETINGS = ['Prezado(a) Agente,', 'Prezada Transportadora,', 'Prezado(a),', 'Prezado(a) {Nome do Contato},'];

// Nomes de contato que são só rótulos internos, não o nome de uma pessoa —
// nunca usar como saudação.
const PLACEHOLDER_CONTACT_NAMES = new Set(['Contato', 'Principal', 'E-mail adicional']);

// Troca a saudação genérica pela do destinatário principal do e-mail (quem
// ficou como "Para" — quem está em "Cc" não recebe saudação própria), sem
// precisar chamar a IA de novo por destinatário.
export function personalizeGreeting(markdown: string, contactName?: string | null): string {
  const name = String(contactName || '').trim();
  if (!name || PLACEHOLDER_CONTACT_NAMES.has(name)) return markdown;

  const lines = markdown.split('\n');
  const firstLineIdx = lines.findIndex(line => line.trim().length > 0);
  if (firstLineIdx === -1) return markdown;

  const firstLine = lines[firstLineIdx]!.trim();
  if (!GENERIC_GREETINGS.includes(firstLine)) return markdown;

  lines[firstLineIdx] = `Prezado(a) ${name},`;
  return lines.join('\n');
}
