import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const TENANT_ID = process.env.MS_GRAPH_TENANT_ID;
const CLIENT_ID = process.env.MS_GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_GRAPH_CLIENT_SECRET;
const USER_EMAIL = process.env.MS_GRAPH_USER_EMAIL;

let accessToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Obtém ou renova o Token de Acesso usando Client Credentials
 */
export const getAccessToken = async (): Promise<string> => {
  if (accessToken && Date.now() < tokenExpiresAt) {
    return accessToken;
  }

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Credenciais do MS Graph não configuradas no .env');
  }

  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append('client_id', CLIENT_ID);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('client_secret', CLIENT_SECRET);
  params.append('grant_type', 'client_credentials');

  try {
    const res = await axios.post(url, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    accessToken = res.data.access_token;
    // expires_in é em segundos. Subtrair 5 min por segurança
    tokenExpiresAt = Date.now() + (res.data.expires_in - 300) * 1000;
    
    return accessToken as string;
  } catch (err: any) {
    console.error('Erro ao obter token do MS Graph:', err.response?.data || err.message);
    throw new Error('Falha na autenticação com a Microsoft. Verifique se o Client Secret é o "Valor" e não o "ID".');
  }
};

/**
 * Envia um e-mail em nome do usuário configurado.
 * Usa fluxo draft+send para capturar o conversationId do MS Graph.
 * Retorna { conversationId } para tracking de thread.
 */
export type OutlookAttachment = { name: string; contentType: string; content: Buffer; isInline?: boolean; contentId?: string };

async function addAttachmentToDraft(token: string, messageId: string, attachment: OutlookAttachment) {
  const baseUrl = `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/messages/${messageId}/attachments`;
  if (attachment.content.length < 2.8 * 1024 * 1024) {
    await axios.post(baseUrl, {
      '@odata.type': '#microsoft.graph.fileAttachment', name: attachment.name,
      contentType: attachment.contentType, contentBytes: attachment.content.toString('base64'),
      ...(attachment.isInline ? { isInline:true, contentId:attachment.contentId } : {})
    }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, maxBodyLength: Infinity });
    return;
  }

  const session = await axios.post(`${baseUrl}/createUploadSession`, {
    AttachmentItem: { attachmentType: 'file', name: attachment.name, size: attachment.content.length, contentType: attachment.contentType }
  }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const uploadUrl = session.data.uploadUrl;
  const chunkSize = 10 * 320 * 1024;
  for (let start = 0; start < attachment.content.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, attachment.content.length);
    await axios.put(uploadUrl, attachment.content.subarray(start, end), {
      headers: { 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${attachment.content.length}` },
      maxBodyLength: Infinity, maxContentLength: Infinity
    });
  }
}

export const sendOutlookEmail = async (toEmail: string, subject: string, htmlContent: string, ccEmail?: string, attachments: OutlookAttachment[] = []): Promise<{ conversationId: string | null }> => {
  if (!USER_EMAIL) throw new Error('E-mail do remetente (MS_GRAPH_USER_EMAIL) não configurado.');
  
  const token = await getAccessToken();
  
  const messagePayload: any = {
    subject: subject,
    body: {
      contentType: 'HTML',
      content: htmlContent
    },
    toRecipients: [
      {
        emailAddress: { address: toEmail }
      }
    ]
  };

  if (ccEmail) {
    messagePayload.ccRecipients = [
      {
        emailAddress: { address: ccEmail }
      }
    ];
  }

  try {
    // Passo 1: Criar como rascunho para obter conversationId
    const draftRes = await axios.post(
      `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/messages`,
      messagePayload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const messageId = draftRes.data.id;
    const conversationId = draftRes.data.conversationId || null;

    for (const attachment of attachments) await addAttachmentToDraft(token, messageId, attachment);

    // Passo 2: Enviar o rascunho
    await axios.post(
      `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/messages/${messageId}/send`,
      null,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    return { conversationId };
  } catch (err: any) {
    console.error('Erro ao enviar e-mail via MS Graph:', err.response?.data || err.message);
    throw new Error('Falha ao enviar e-mail. Verifique permissões Mail.Send e Mail.ReadWrite no Azure.');
  }
};

export const replyOutlookEmail = async (messageId: string, htmlContent: string, attachments: OutlookAttachment[] = []): Promise<{ conversationId: string | null }> => {
  if (!USER_EMAIL) throw new Error('E-mail do remetente (MS_GRAPH_USER_EMAIL) não configurado.');
  const token = await getAccessToken();
  const replyDraft = await axios.post(
    `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/messages/${encodeURIComponent(messageId)}/createReply`, {},
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  const replyId = replyDraft.data.id;
  await axios.patch(
    `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/messages/${replyId}`,
    { body: { contentType: 'HTML', content: htmlContent } },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  for (const attachment of attachments) await addAttachmentToDraft(token, replyId, attachment);
  await axios.post(
    `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/messages/${replyId}/send`, null,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return { conversationId: replyDraft.data.conversationId || null };
};

/**
 * Busca mensagens não lidas na Caixa de Entrada.
 * Inclui conversationId e from para matching inteligente.
 */
export const fetchUnreadEmails = async () => {
  if (!USER_EMAIL) throw new Error('E-mail do remetente não configurado.');
  
  const token = await getAccessToken();
  // Inclui conversationId e from no $select para matching multi-estratégia
  const url = `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/mailFolders/inbox/messages?$filter=isRead eq false&$top=20&$select=id,subject,bodyPreview,body,from,receivedDateTime,conversationId,hasAttachments`;

  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data.value; // Array de mensagens
  } catch (err: any) {
    console.error('Erro ao buscar e-mails não lidos:', err.response?.data || err.message);
    return [];
  }
};

/**
 * Busca e-mails por conversationId (mesma thread de conversa).
 */
export const fetchEmailsByConversationId = async (conversationId: string) => {
  if (!USER_EMAIL) throw new Error('E-mail do remetente não configurado.');

  const token = await getAccessToken();
  const safeConversationId = conversationId.replace(/'/g, "''");
  const url = `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/messages?$filter=conversationId eq '${safeConversationId}'&$select=id,subject,bodyPreview,body,from,receivedDateTime,conversationId,hasAttachments&$orderby=receivedDateTime desc&$top=10`;

  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data.value || [];
  } catch (err: any) {
    console.error('Erro ao buscar por conversationId:', err.response?.data || err.message);
    return [];
  }
};

/** Busca anexos binários da mensagem atual. */
export const fetchEmailAttachments = async (messageId: string) => {
  if (!USER_EMAIL) throw new Error('E-mail do remetente não configurado.');
  const token = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/messages/${encodeURIComponent(messageId)}/attachments?$top=25`;
  try {
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    return (res.data.value || []).filter((item: any) => item['@odata.type'] === '#microsoft.graph.fileAttachment' && item.contentBytes);
  } catch (err: any) {
    console.error(`Erro ao buscar anexos do e-mail ${messageId}:`, err.response?.data || err.message);
    throw new Error('Falha ao buscar anexos do retorno no Outlook.');
  }
};

/**
 * Busca e-mails usando a Search API do MS Graph.
 * Permite busca por assunto, remetente, corpo do e-mail, etc.
 * @param query - Termo de busca (suporta KQL: from:, subject:, body:)
 */
export const searchEmails = async (query: string) => {
  if (!USER_EMAIL) throw new Error('E-mail do remetente não configurado.');

  const token = await getAccessToken();
  // Usa $search com KQL (Keyword Query Language)
  const encodedQuery = encodeURIComponent(query);
  const url = `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/messages?$search="${encodedQuery}"&$select=id,subject,bodyPreview,body,from,receivedDateTime,conversationId&$top=20`;

  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data.value || [];
  } catch (err: any) {
    console.error('Erro ao buscar e-mails:', err.response?.data || err.message);
    return [];
  }
};

/**
 * Marca um e-mail como lido
 */
export const markEmailAsRead = async (messageId: string) => {
  if (!USER_EMAIL) return;
  const token = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/users/${USER_EMAIL}/messages/${messageId}`;

  try {
    await axios.patch(url, { isRead: true }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (err: any) {
    console.error(`Erro ao marcar e-mail ${messageId} como lido:`, err.response?.data || err.message);
  }
};
