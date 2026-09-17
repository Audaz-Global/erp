export const AIRLINE_IATA_MAP: Record<string, string> = {
  '5Y': 'Atlas Air',
  'AA': 'American Airlines Cargo',
  'DL': 'Delta Air Lines Cargo',
  'UA': 'United Cargo',
  'LA': 'LATAM Cargo',
  'LH': 'Lufthansa Cargo',
  'AF': 'Air France Cargo',
  'KL': 'KLM Cargo',
  'BA': 'British Airways World Cargo',
  'TP': 'TAP Air Portugal',
  'EK': 'Emirates SkyCargo',
  'QR': 'Qatar Airways Cargo',
  'ET': 'Ethiopian Airlines Cargo',
  'AM': 'Aeromexico Cargo',
  'CM': 'Copa Airlines Cargo',
  'AZ': 'ITA Airways Cargo',
  'AV': 'Avianca Cargo',
  'UC': 'LATAM Cargo Chile',
  'QT': 'Avianca Cargo',
  'CV': 'Cargolux',
  'TK': 'Turkish Cargo',
  'AC': 'Air Canada Cargo',
  'NH': 'ANA Cargo',
  'JL': 'Japan Airlines Cargo',
  'CX': 'Cathay Cargo',
  'SQ': 'Singapore Airlines Cargo',
  'OZ': 'Asiana Cargo',
  'CI': 'China Airlines Cargo',
  'CZ': 'China Southern Cargo',
  'CA': 'Air China Cargo',
  'MU': 'China Eastern Cargo',
  'EY': 'Etihad Cargo',
  'LX': 'Swiss WorldCargo',
  'OS': 'Austrian Airlines Cargo',
  'IB': 'Iberia Cargo',
  'UX': 'Air Europa Cargo',
  'AR': 'Aerolineas Argentinas Cargo',
  'G3': 'GOL Cargo',
  'AD': 'Azul Cargo Express',
  'H6': 'Sky Lease Cargo',
  'K4': 'Kalitta Air',
  'M6': 'Amerijet International',
  'PO': 'Polar Air Cargo',
  'FX': 'FedEx Express',
  '5X': 'UPS Airlines'
};

/**
 * Retorna o nome por extenso da companhia aérea com base no código IATA de 2 dígitos.
 * Se o código não estiver mapeado ou já for um nome extenso, retorna o valor formatado ou fallback.
 */
export function getAirlineFullName(code: string | null | undefined): string {
  if (!code) return 'Cia Aérea Não Especificada';
  const cleanCode = String(code).trim().toUpperCase();
  if (AIRLINE_IATA_MAP[cleanCode]) {
    return AIRLINE_IATA_MAP[cleanCode];
  }
  // Se tiver mais de 2 letras e não for código curto, assume que já é o nome
  if (cleanCode.length > 3) {
    return code.trim();
  }
  return `${cleanCode} Cargo`;
}
