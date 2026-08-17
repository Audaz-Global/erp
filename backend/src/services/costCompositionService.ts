export type CostCompositionRecord = { costCompositionReviewed?: boolean | null };

/**
 * Depois da revisão final, a composição salva é a fonte única da proposta.
 * Regras automáticas só podem completar cotações que ainda não foram revisadas.
 */
export function shouldHydrateAutomaticCosts(quotation: CostCompositionRecord): boolean {
  return quotation.costCompositionReviewed !== true;
}
