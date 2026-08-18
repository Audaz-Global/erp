import { prisma } from '../prisma';
import type { OutlookAttachment } from './outlookService';

function escapeHtml(value: unknown) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char] || char));
}

export async function loadProfessionalSignature(professionalId: unknown) {
  const id = String(professionalId || '').trim();
  if (!id) throw new Error('Selecione o profissional responsável pelo envio.');
  const professional = await prisma.professionalProfile.findUnique({ where: { id } });
  if (!professional || !professional.active) throw new Error('O profissional selecionado não está ativo.');
  if (!professional.signatureImage || professional.signatureMimeType !== 'image/jpeg') {
    throw new Error(`Cadastre a assinatura JPEG de ${professional.name} antes de enviar.`);
  }
  const contentId = `audaz-signature-${professional.id}-${professional.signatureVersion}`;
  const attachment: OutlookAttachment = {
    name: professional.signatureFileName || `assinatura-${professional.initials.toLowerCase()}.jpg`,
    contentType: 'image/jpeg', content: Buffer.from(professional.signatureImage), isInline: true, contentId
  };
  return {
    professional: {
      id: professional.id, name: professional.name, initials: professional.initials, email: professional.email,
      jobTitle: professional.jobTitle, phone: professional.phone, signatureVersion: professional.signatureVersion
    },
    attachment,
    html: `<div data-audaz-professional-signature="${escapeHtml(professional.id)}" style="margin-top:18px"><img src="cid:${contentId}" alt="Assinatura de ${escapeHtml(professional.name)}" style="display:block;max-width:620px;width:auto;height:auto;border:0"></div>`
  };
}

export function appendProfessionalSignature(htmlDocument: string, signatureHtml: string) {
  const html = String(htmlDocument || '');
  if (html.includes('data-audaz-professional-signature=')) return html;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${signatureHtml}</body>`) : `${html}${signatureHtml}`;
}
