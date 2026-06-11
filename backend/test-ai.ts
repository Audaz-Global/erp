import * as fs from 'fs';
import { extractClientData } from './src/services/aiService';

async function test() {
  const text = fs.readFileSync('../ADZ-QIS26050094 _ Shipping Ready Material Scheduling Contract 2912001262 - W08 (20_02) - JOUDER - MARÍTIMO.eml', 'utf-8');
  console.log('Running AI extraction...');
  try {
    const res = await extractClientData(text, 'Você trabalha na Audaz Global...');
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error(err);
  }
}
test();
