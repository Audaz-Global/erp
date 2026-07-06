const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');

async function main() {
  const emlPath = path.join(__dirname, '../../QIS26060117/RES_ 26_23476 SI - RES_ ADZ _ Imp Sea - EXW _ Portugal x SSZ _ CABLAGGI _ COFICAB .eml');
  
  if (!fs.existsSync(emlPath)) {
    console.error(`Arquivo não encontrado em: ${emlPath}`);
    return;
  }
  
  console.log(`Lendo arquivo EML: ${emlPath}`);
  const buffer = fs.readFileSync(emlPath);
  const parsed = await simpleParser(buffer);
  
  let fromText = parsed.from ? (Array.isArray(parsed.from) ? parsed.from.map(f => f.text).join(', ') : parsed.from.text) : '';
  let toText = parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(', ') : parsed.to.text) : '';
  
  let output = `--- EMAIL DE RETORNO DO AGENTE ---
De: ${fromText}
Para: ${toText}
Assunto: ${parsed.subject || ''}
Data: ${parsed.date || ''}

Corpo do Email:
${parsed.text || ''}

--- ANEXOS ---
`;

  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const attachment of parsed.attachments) {
      output += `\nAnexo: ${attachment.filename} (${attachment.contentType})\n`;
      if (attachment.contentType === 'application/pdf') {
        try {
          const pdfData = await pdfParse(attachment.content);
          output += `[Conteúdo do PDF ${attachment.filename}]:\n${pdfData.text}\n`;
        } catch (err) {
          output += `[Erro ao ler PDF ${attachment.filename}]: ${err.message}\n`;
        }
      }
    }
  } else {
    output += 'Nenhum anexo encontrado.';
  }
  
  const outputPath = path.join(__dirname, 'inspect_res_output.txt');
  fs.writeFileSync(outputPath, output, 'utf8');
  console.log(`Log salvo em: ${outputPath}`);
}

main().catch(console.error);
