const fs = require('fs');
const path = require('path');

const emlPath = path.join(__dirname, '../../ADZ-QIA26060010/RE_ ADZ _ Imp Air x EXW _ Korea x GRU _ IACIT _ PO 024158 - RFHIC.eml');
const content = fs.readFileSync(emlPath, 'utf8');

console.log('--- Buscando cids no EML bruto ---');
const cidMatches = content.match(/cid:[^"'>\s]+/g);
console.log('CIDs encontrados:', cidMatches);

console.log('\n--- Buscando image001 no EML bruto ---');
const image001Matches = content.match(/image001/gi);
console.log('Ocorrências de image001:', image001Matches ? image001Matches.length : 0);

console.log('\n--- Buscando "12.09" no EML bruto ---');
const rateMatches = content.match(/12\.09/g);
console.log('Ocorrências de 12.09:', rateMatches ? rateMatches.length : 0);

console.log('\n--- Buscando "12,09" no EML bruto ---');
const rateMatches2 = content.match(/12,09/g);
console.log('Ocorrências de 12,09:', rateMatches2 ? rateMatches2.length : 0);
