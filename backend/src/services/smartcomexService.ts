const SMARTCOMEX_PROXY_URL = process.env.SMARTCOMEX_PROXY_URL || 'http://localhost:3000/api';
const SMARTCOMEX_API_KEY = process.env.SMARTCOMEX_API_KEY || 'teste-local-123';

export const fetchClientsFromSmartcomex = async () => {
  try {
    const response = await fetch(`${SMARTCOMEX_PROXY_URL}/offices`, {
      method: 'GET',
      headers: {
        'X-API-Key': SMARTCOMEX_API_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`Erro HTTP: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Erro ao buscar clientes no Smartcomex:', error);
    throw new Error('Falha ao conectar com a API do Smartcomex');
  }
};

export const fetchQuotationsFromSmartcomex = async () => {
  try {
    const response = await fetch(`${SMARTCOMEX_PROXY_URL}/quotations`, {
      method: 'GET',
      headers: {
        'X-API-Key': SMARTCOMEX_API_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`Erro HTTP: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Erro ao buscar cotações no Smartcomex:', error);
    throw new Error('Falha ao conectar com a API do Smartcomex');
  }
};
