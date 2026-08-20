import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

// Conexão somente leitura com o ERP Atlantis (MySQL externo). Nunca escrevemos
// nesta base — é só fonte de consulta para sugerir dados já cadastrados lá.
function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.ATLANTIS_DB_HOST,
      port: Number(process.env.ATLANTIS_DB_PORT) || 3306,
      user: process.env.ATLANTIS_DB_USER,
      password: process.env.ATLANTIS_DB_PASSWORD,
      database: process.env.ATLANTIS_DB_NAME,
      connectionLimit: 5,
      connectTimeout: 8000,
      charset: 'utf8mb4'
    });
  }
  return pool;
}

export function isAtlantisConfigured(): boolean {
  return Boolean(process.env.ATLANTIS_DB_HOST && process.env.ATLANTIS_DB_USER && process.env.ATLANTIS_DB_NAME);
}

export type AtlantisRole = 'CUSTOMER' | 'AGENT';

export interface AtlantisCandidate {
  atlantisId: string;
  name: string;
  commercialName: string;
  cnpj: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  matchedBy: 'CNPJ' | 'NAME';
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

const ROLE_COLUMN: Record<AtlantisRole, string> = {
  CUSTOMER: 'IS_CUSTOMER',
  AGENT: 'IS_AGENT'
};

// Mantém dígitos e letras (tax IDs estrangeiros usam letras), remove pontuação de formatação.
function normalizeTaxId(value: string): string {
  return String(value || '').replace(/[.\-/\s]/g, '').toUpperCase();
}

async function fetchContactPersons(conn: mysql.PoolConnection, contactGeneralIds: string[]) {
  if (!contactGeneralIds.length) return new Map<string, { name: string; email: string; phone: string }>();
  const placeholders = contactGeneralIds.map(() => '?').join(',');
  const [rows] = await conn.query(
    `SELECT CONTACT_GENERAL_FK, NAME_CP, EMAIL, DIRECT_PHONE, MOBILE_PHONE
     FROM M0130_CONTACT_PERSON
     WHERE CONTACT_GENERAL_FK IN (${placeholders}) AND (IS_ACTIVE IS NULL OR IS_ACTIVE = 1)`,
    contactGeneralIds
  );
  const byContactGeneral = new Map<string, { name: string; email: string; phone: string }>();
  for (const row of rows as any[]) {
    const key = String(row.CONTACT_GENERAL_FK);
    if (byContactGeneral.has(key)) continue; // primeiro contato ativo encontrado por empresa
    byContactGeneral.set(key, {
      name: row.NAME_CP || '',
      email: row.EMAIL || '',
      phone: row.DIRECT_PHONE || row.MOBILE_PHONE || ''
    });
  }
  return byContactGeneral;
}

function mapCandidate(row: any, matchedBy: 'CNPJ' | 'NAME', contacts: Map<string, { name: string; email: string; phone: string }>): AtlantisCandidate {
  const id = String(row.ID);
  const contact = contacts.get(id);
  return {
    atlantisId: id,
    name: row.NAME_CG || '',
    commercialName: row.COMMERCIAL_NAME || row.NAME_CG || '',
    cnpj: row.FEDERAL_REGISTRATION || null,
    phone: row.PHONE || null,
    website: row.WEBSITE || null,
    address: [row.STREET_NAME, row.NUMBER_ADDRESS, row.NEIGHBORHOOD, row.CITY_NAME, row.STATE_NAME].filter(Boolean).join(', ') || null,
    matchedBy,
    contactName: contact?.name || null,
    contactEmail: contact?.email || null,
    contactPhone: contact?.phone || null
  };
}

// Busca por nome (parcial) e, quando um CNPJ/tax ID é informado, tenta primeiro
// o match exato por documento — muito mais confiável que nome e evita a maior
// parte das ambiguidades.
export async function searchAtlantisParty(role: AtlantisRole, query: string, taxId?: string): Promise<AtlantisCandidate[]> {
  if (!isAtlantisConfigured()) throw new Error('Integração com o Atlantis não está configurada.');
  const roleColumn = ROLE_COLUMN[role];
  const conn = await getPool().getConnection();
  try {
    let rows: any[] = [];
    let matchedBy: 'CNPJ' | 'NAME' = 'NAME';

    if (taxId && normalizeTaxId(taxId)) {
      const normalized = normalizeTaxId(taxId);
      const [cnpjRows] = await conn.query(
        `SELECT cg.ID, cg.NAME_CG, cg.COMMERCIAL_NAME, cg.FEDERAL_REGISTRATION, cg.PHONE, cg.WEBSITE, cg.ADDRESS_FK,
                a.STREET_NAME, a.NUMBER_ADDRESS, a.NEIGHBORHOOD, a.CITY_NAME, a.STATE_NAME
         FROM M0130_CONTACT_GENERAL cg
         LEFT JOIN M0001_ADDRESS a ON a.ID = cg.ADDRESS_FK
         WHERE cg.${roleColumn} = 1 AND cg.DATE_DELETED IS NULL
           AND REPLACE(REPLACE(REPLACE(REPLACE(UPPER(cg.FEDERAL_REGISTRATION), '.', ''), '/', ''), '-', ''), ' ', '') = ?
         LIMIT 5`,
        [normalized]
      );
      rows = cnpjRows as any[];
      matchedBy = 'CNPJ';
    }

    if (!rows.length) {
      const term = String(query || '').trim();
      if (term.length < 3) return [];
      const [nameRows] = await conn.query(
        `SELECT cg.ID, cg.NAME_CG, cg.COMMERCIAL_NAME, cg.FEDERAL_REGISTRATION, cg.PHONE, cg.WEBSITE, cg.ADDRESS_FK,
                a.STREET_NAME, a.NUMBER_ADDRESS, a.NEIGHBORHOOD, a.CITY_NAME, a.STATE_NAME
         FROM M0130_CONTACT_GENERAL cg
         LEFT JOIN M0001_ADDRESS a ON a.ID = cg.ADDRESS_FK
         WHERE cg.${roleColumn} = 1 AND cg.DATE_DELETED IS NULL
           AND (cg.NAME_CG LIKE ? OR cg.COMMERCIAL_NAME LIKE ?)
         ORDER BY cg.NAME_CG ASC
         LIMIT 8`,
        [`%${term}%`, `%${term}%`]
      );
      rows = nameRows as any[];
      matchedBy = 'NAME';
    }

    const contacts = await fetchContactPersons(conn, rows.map(row => String(row.ID)));
    return rows.map(row => mapCandidate(row, matchedBy, contacts));
  } finally {
    conn.release();
  }
}

export async function closeAtlantisPool() {
  if (pool) { await pool.end(); pool = null; }
}
