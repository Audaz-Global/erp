export interface PackageDimension {
  length: number; // em cm
  width: number;  // em cm
  height: number; // em cm
  qty: number;
}

/**
 * Realiza o parsing de dimensões de carga convertendo tudo para centímetros e extraindo as quantidades
 */
export function parsePackages(packagesStr: string, defaultPackagesCount: number = 1): PackageDimension[] {
  if (!packagesStr) return [];

  let items: string[] = [];
  try {
    const parsed = JSON.parse(packagesStr);
    if (Array.isArray(parsed)) {
      items = parsed.map(String);
    } else {
      items = [String(parsed)];
    }
  } catch (e) {
    items = packagesStr.split(/[,;\n]/);
  }

  const result: PackageDimension[] = [];

  for (let item of items) {
    item = item.trim();
    if (!item) continue;

    const cleaned = item.toLowerCase().replace(/\s+/g, '');
    
    // Descobrir a quantidade de volumes antes de processar as dimensões
    const qtyMatch = cleaned.match(/^(\d+)[x*-]/);
    let qty = 1;
    let dimensionsPart = cleaned;
    
    if (qtyMatch) {
      const separatorsCount = (cleaned.match(/[x*-]/g) || []).length;
      if (separatorsCount >= 3) {
        qty = parseInt(qtyMatch[1] || '1', 10);
        // Remove o prefixo de quantidade (ex: "1x", "2-", "3*") para não interferir nas dimensões
        dimensionsPart = cleaned.slice(qtyMatch[0].length);
      } else if (items.length === 1 && defaultPackagesCount > 0) {
        qty = defaultPackagesCount;
      }
    } else if (items.length === 1 && defaultPackagesCount > 0) {
      qty = defaultPackagesCount;
    }

    // Identifica unidade antes de limpá-la do texto
    let toCmFactor = 1;
    if (dimensionsPart.includes('mm')) {
      toCmFactor = 0.1;
    } else if (dimensionsPart.includes('cm')) {
      toCmFactor = 1;
    } else if (dimensionsPart.includes('m') && !dimensionsPart.includes('cm') && !dimensionsPart.includes('mm')) {
      toCmFactor = 100;
    }

    // Remove as siglas de unidade ("mm", "cm", "m") para evitar que fiquem coladas nos números e quebrem o regex
    const cleanDimensions = dimensionsPart.replace(/mm|cm|m/g, '');

    // Procura por 3 números decimais separados por x ou * ou -
    const match = cleanDimensions.match(/(\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)/);
    if (match) {
      let l = parseFloat(match[1] || '0');
      let w = parseFloat(match[2] || '0');
      let h = parseFloat(match[3] || '0');

      l = l * toCmFactor;
      w = w * toCmFactor;
      h = h * toCmFactor;

      result.push({ length: l, width: w, height: h, qty });
    }
  }

  return result;
}

/**
 * Calcula o peso cubado aéreo a partir de dimensões em cm usando o divisor 6000
 */
export function calculateAirCubado(packagesStr: string, defaultPackagesCount: number = 1): number {
  const packages = parsePackages(packagesStr, defaultPackagesCount);
  if (packages.length === 0) return 0;
  
  let totalWeight = 0;
  for (const pkg of packages) {
    const itemWeight = (pkg.length * pkg.width * pkg.height * pkg.qty) / 6000;
    totalWeight += itemWeight;
  }
  return parseFloat(totalWeight.toFixed(2));
}

/**
 * Valida se qualquer caixa na carga ultrapassa os limites padrão de aviação:
 * Comprimento > 300 cm, Largura > 200 cm, Altura > 160 cm
 */
export function hasOversizedCargo(packagesStr: string): boolean {
  const packages = parsePackages(packagesStr);
  for (const pkg of packages) {
    if (pkg.length > 300 || pkg.width > 200 || pkg.height > 160) {
      return true;
    }
  }
  return false;
}
