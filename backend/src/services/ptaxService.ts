import axios from 'axios';

const PTAX_FALLBACK_RATE = 5.05;
const MAX_LOOKBACK_DAYS = 10;

function formatBcbDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${date.getFullYear()}`;
}

interface PtaxBoletim {
  cotacaoCompra: number;
  cotacaoVenda: number;
  dataHoraCotacao: string;
  tipoBoletim: string;
}

async function fetchBoletinsForDate(date: Date): Promise<PtaxBoletim[]> {
  const dataCotacao = formatBcbDate(date);
  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda='USD',dataCotacao='${dataCotacao}')?$format=json`;
  const response = await axios.get(url, { timeout: 5000 });
  return response.data?.value || [];
}

// mode: 'D1_CLOSE' = fechamento PTAX do último dia útil anterior; 'D0_OPEN' = abertura do dia atual
export async function getPtaxRate(mode: 'D1_CLOSE' | 'D0_OPEN'): Promise<number> {
  const tipoBoletim = mode === 'D0_OPEN' ? 'Abertura' : 'Fechamento PTAX';
  const cursor = new Date();
  if (mode === 'D1_CLOSE') cursor.setDate(cursor.getDate() - 1);

  try {
    for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
      const boletins = await fetchBoletinsForDate(cursor);
      const match = boletins.find(b => b.tipoBoletim === tipoBoletim);
      if (match) {
        return parseFloat(((Number(match.cotacaoCompra) + Number(match.cotacaoVenda)) / 2).toFixed(4));
      }
      cursor.setDate(cursor.getDate() - 1);
    }
    console.error('Erro ao buscar PTAX: nenhum boletim encontrado nos últimos dias, usando fallback');
    return PTAX_FALLBACK_RATE;
  } catch (err: any) {
    console.error('Erro ao buscar PTAX, usando fallback:', err.message);
    return PTAX_FALLBACK_RATE;
  }
}
