const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');

async function main() {
  // 1. Inspecionar o PDF standalone (ACO032 - MCASSAB - MAGDA.pdf)
  const pdfPath = path.join(__dirname, '../ACO/ACO032 - MCASSAB - MAGDA.pdf');
  if (fs.existsSync(pdfPath)) {
    console.log('=== PDF STANDALONE: ACO032 - MCASSAB - MAGDA.pdf ===');
    const pdfBuf = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(pdfBuf);
    console.log(pdfData.text);
    console.log('\n');
  }

  // 2. Inspecionar PDF dentro do e-mail como anexo
  const emlPath = path.join(__dirname, '../ACO/ACO032 - MCASSAB - MAGDA.eml');
  if (fs.existsSync(emlPath)) {
    const emlBuf = fs.readFileSync(emlPath);
    const parsed = await simpleParser(emlBuf);

    const pdfAtts = (parsed.attachments || []).filter(a =>
      a.contentType === 'application/pdf' ||
      (a.filename && a.filename.toLowerCase().endsWith('.pdf'))
    );

    if (pdfAtts.length > 0) {
      for (const att of pdfAtts) {
        console.log(`=== ANEXO PDF NO EMAIL: ${att.filename} ===`);
        const pdfData = await pdfParse(att.content);
        console.log(pdfData.text);
        console.log('\n');
      }
    } else {
      console.log('Nenhum PDF como anexo no e-mail.');
    }

    // Mostrar o texto completo que chega à IA (como o parserService monta)
    let fullText = `\n--- EMAIL ---\nAssunto: ${parsed.subject || ''}\n\nCorpo: ${parsed.text || ''}\n`;
    if (parsed.attachments && parsed.attachments.length > 0) {
      fullText += '\n--- ANEXOS ---\n';
      for (const att of parsed.attachments) {
        if (att.contentType === 'application/pdf') {
          const pdfData = await pdfParse(att.content);
          fullText += `\n[Anexo PDF: ${att.filename}]\n${pdfData.text}\n`;
        }
      }
    }
    
    console.log('=== TEXTO COMPLETO QUE A IA RECEBE ===');
    console.log(fullText);
  }
}

main().catch(console.error);
