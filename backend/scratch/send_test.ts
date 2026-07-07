import { sendOutlookEmail } from '../src/services/outlookService';
import { marked } from 'marked';
import { prisma } from '../src/prisma';

marked.setOptions({ breaks: true });

const run = async () => {
  try {
    console.log('Criando cotação fake no banco de dados...');
    
    // Deleta se já existir
    await prisma.quotation.deleteMany({ where: { reference: 'AG-TEST-001' }});
    
    const user = await prisma.user.findFirst();
    
    const quote = await prisma.quotation.create({
      data: {
        reference: 'AG-TEST-001',
        originCountry: 'France',
        destinationCountry: 'Brazil',
        loadType: 'FCL',
        totalGrossWeightKg: 15000,
        status: 'AGUARDANDO_AGENTE',
        agentEmail: 'mkt@audazglobal.com',
        direction: 'IMPORT',
        modal: 'SEA',
        createdBy: { connect: { id: user!.id } }
      }
    });

    console.log('Cotação fake criada com ID:', quote.id);

    const markdownBody = `Prezado(a) Agente,

Por gentileza, solicito sua melhor cotação de frete marítimo para o embarque abaixo.

**Referência Cliente:** AG-TEST-001
**Modal:** Marítimo FCL
**Origem:** Le Havre, France
**Destino:** Santos, Brazil

**Detalhes da Carga:**
* **Equipamento:** 1x 20' HC
* **Peso Bruto Total:** 15.000 kg
* **Carga IMO:** NÃO

Ficamos no aguardo dos seus melhores custos.
Obrigado!`;

    const emailStyle = '<style>body { font-family: "Segoe UI", Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; } ul { margin-top: 5px; margin-bottom: 5px; padding-left: 20px; } strong { font-weight: 600; color: #000; } p { margin: 0 0 10px 0; }</style>';

    const renderedHtml = await marked.parse(markdownBody);
    const finalHtmlEmail = '<html><head>' + emailStyle + '</head><body>' + renderedHtml + '</body></html>';

    console.log('Disparando e-mail...');
    await sendOutlookEmail('mkt@audazglobal.com', 'Solicitação de Cotação de Frete - REF: AG-TEST-001', finalHtmlEmail);
    console.log('SUCESSO! E-mail de teste enviado.');

  } catch (err: any) {
    console.error('Erro:', err.message || err);
  }
};

run();
