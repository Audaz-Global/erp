import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const TENANT_ID = process.env.MS_GRAPH_TENANT_ID;
const CLIENT_ID = process.env.MS_GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_GRAPH_CLIENT_SECRET;
const USER_EMAIL = process.env.MS_GRAPH_USER_EMAIL;

const run = async () => {
  console.log('Obtendo token...');
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append('client_id', CLIENT_ID!);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('client_secret', CLIENT_SECRET!);
  params.append('grant_type', 'client_credentials');

  let token = '';
  try {
    const res = await axios.post(url, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    token = res.data.access_token;
    console.log('Token obtido com sucesso!');
  } catch (err: any) {
    console.error('ERRO AO OBTER TOKEN:', err.response?.data || err.message);
    return;
  }

  console.log(`Tentando enviar e-mail em nome de ${USER_EMAIL}...`);
  const mailUrl = `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/sendMail`;
  const mailBody = {
    message: {
      subject: 'Teste de Integração Audaz',
      body: { contentType: 'Text', content: 'Este é um teste de API.' },
      toRecipients: [{ emailAddress: { address: 'mkt@audazglobal.com' } }]
    },
    saveToSentItems: 'true'
  };

  try {
    await axios.post(mailUrl, mailBody, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('SUCESSO! E-mail enviado!');
  } catch (err: any) {
    console.error('ERRO AO ENVIAR E-MAIL (MS GRAPH):');
    console.error(JSON.stringify(err.response?.data, null, 2) || err.message);
  }
};

run();
