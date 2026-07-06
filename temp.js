
const API = window.location.origin + '/api';
let isOnlyEditMode = false;

// Funções utilitárias locais de cubagem
function parsePackagesLocal(packagesStr, defaultPackagesCount = 1) {
  if (!packagesStr) return [];
  let items = [];
  try {
    const parsed = JSON.parse(packagesStr);
    if (Array.isArray(parsed)) items = parsed.map(String);
    else items = [String(parsed)];
  } catch (e) {
    items = packagesStr.split(/[,;\n]/);
  }
  const result = [];
  for (let item of items) {
    item = item.trim();
    if (!item) continue;
    
    // Remove espaços e parênteses para simplificar o parsing de formatos como 3x(120x80x60)
    const cleaned = item.toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '');
    
    // 1. Tenta identificar o padrão de 4 números (ex: 3x120x80x60)
    const match4 = cleaned.match(/^(\d+)[x*](\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)/);
    if (match4) {
      const qty = parseInt(match4[1] || '1', 10);
      let l = parseFloat(match4[2] || '0');
      let w = parseFloat(match4[3] || '0');
      let h = parseFloat(match4[4] || '0');
      
      let toCmFactor = 1;
      if (cleaned.includes('mm')) toCmFactor = 0.1;
      else if (cleaned.includes('cm')) toCmFactor = 1;
      else if (cleaned.includes('m') && !cleaned.includes('cm') && !cleaned.includes('mm')) toCmFactor = 100;
      
      l = l * toCmFactor;
      w = w * toCmFactor;
      h = h * toCmFactor;
      
      result.push({ length: l, width: w, height: h, qty });
      continue;
    }
    
    // 2. Se não for 4 números, segue o fluxo normal de 3 números
    const cleanDimensions = cleaned.replace(/mm|cm|m/g, '');
    const match = cleanDimensions.match(/(\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)/);
    let qty = 1;
    let dimensionsPart = cleaned;
    
    if (match) {
      const matchInOriginal = cleaned.match(/(\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)/);
      if (matchInOriginal) {
        const dimIndex = cleaned.indexOf(matchInOriginal[0]);
        const beforeDim = cleaned.substring(0, dimIndex);
        const qtyMatch = beforeDim.match(/^(\d+)/);
        if (qtyMatch) {
          qty = parseInt(qtyMatch[1], 10);
        } else if (items.length === 1 && defaultPackagesCount > 0) {
          qty = defaultPackagesCount;
        }
        dimensionsPart = matchInOriginal[0] + cleaned.substring(dimIndex + matchInOriginal[0].length);
      }
    } else if (items.length === 1 && defaultPackagesCount > 0) {
      qty = defaultPackagesCount;
    }
    
    let toCmFactor = 1;
    if (dimensionsPart.includes('mm')) toCmFactor = 0.1;
    else if (dimensionsPart.includes('cm')) toCmFactor = 1;
    else if (dimensionsPart.includes('m') && !dimensionsPart.includes('cm') && !dimensionsPart.includes('mm')) toCmFactor = 100;
    const cleanDimensions2 = dimensionsPart.replace(/mm|cm|m/g, '');
    const dimMatch = cleanDimensions2.match(/(\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)/);
    if (dimMatch) {
      let l = parseFloat(dimMatch[1] || '0') * toCmFactor;
      let w = parseFloat(dimMatch[2] || '0') * toCmFactor;
      let h = parseFloat(dimMatch[3] || '0') * toCmFactor;
      result.push({ length: l, width: w, height: h, qty });
    }
  }
  return result;
}

function calculateAirCubadoLocal(packagesStr, defaultPackagesCount = 1) {
  const packages = parsePackagesLocal(packagesStr, defaultPackagesCount);
  if (packages.length === 0) return 0;
  let totalWeight = 0;
  for (const pkg of packages) {
    totalWeight += (pkg.length * pkg.width * pkg.height * pkg.qty) / 6000;
  }
  return parseFloat(totalWeight.toFixed(2));
}

function getLocalTaxavel(packagesStr, totalPackages, totalGrossWeight, loadType, totalCbm = 0, weightBreak = 'normal') {
  const isAir = String(loadType || '').toUpperCase().includes('AIR');
  const isLcl = String(loadType || '').toUpperCase().includes('LCL');
  const bruto = parseFloat(totalGrossWeight) || 0;
  let taxavel = bruto;
  if (isAir) {
    const cubado = calculateAirCubadoLocal(packagesStr || '', totalPackages || 1);
    taxavel = Math.max(bruto, cubado);
    if (weightBreak && weightBreak !== 'normal') {
      const minWeight = parseFloat(weightBreak.replace(/[^0-9]/g, ''));
      if (!isNaN(minWeight) && taxavel < minWeight) {
        taxavel = minWeight;
      }
    }
  } else if (isLcl) {
    taxavel = parseFloat(totalCbm) || 0;
    if (taxavel <= 0) {
      const pkgs = parsePackagesLocal(packagesStr || '', totalPackages || 1);
      let sumVol = 0;
      for (const p of pkgs) {
        sumVol += (p.length / 100) * (p.width / 100) * (p.height / 100) * p.qty;
      }
      taxavel = sumVol;
    }
  } else {
    taxavel = 1;
  }
  return taxavel <= 0 ? 1 : taxavel;
}

function calculateCbmLocal(dimensionsStr, packagesCount = 1) {
  if (!dimensionsStr) return 0;
  const cleanNumber = String(dimensionsStr).trim().replace(',', '.');
  const numericOnly = parseFloat(cleanNumber);
  if (!isNaN(numericOnly) && !cleanNumber.includes('x') && !cleanNumber.includes('*')) {
    return numericOnly;
  }
  const parsedPkgs = parsePackagesLocal(dimensionsStr, packagesCount);
  let totalCbm = 0;
  for (const pkg of parsedPkgs) {
    const vol = (pkg.length / 100) * (pkg.width / 100) * (pkg.height / 100) * pkg.qty;
    totalCbm += vol;
  }
  return parseFloat(totalCbm.toFixed(3));
}

function updateModalCalculatedWeights() {
  const loadType = document.getElementById('rev-load-type').value;
  const isAir = String(loadType || '').toUpperCase().includes('AIR');
  const isLcl = String(loadType || '').toUpperCase().includes('LCL');
  const bruto = parseFloat(document.getElementById('rev-weight').value) || 0;
  const totalPackages = parseInt(document.getElementById('rev-packages').value) || 1;
  const packagesStr = document.getElementById('rev-dimensions').value || '';
  const wBreakModal = document.getElementById('rev-weight-break').value;

  // 1. Calcular CBM
  const cbm = calculateCbmLocal(packagesStr, totalPackages);
  // 2. Calcular Peso Cubado Aéreo
  const airCubado = calculateAirCubadoLocal(packagesStr, totalPackages);
  // 3. Obter Peso Taxável
  const taxavel = getLocalTaxavel(packagesStr, totalPackages, bruto, loadType, cbm, wBreakModal);

  // Formatar
  const cbmFormatted = cbm.toFixed(3).replace('.', ',');
  const airCubadoFormatted = airCubado.toFixed(2).replace('.', ',');
  
  let taxableFormatted = '';
  let taxableUnit = 'kg';
  if (isAir) {
    taxableFormatted = taxavel.toFixed(2).replace('.', ',');
    taxableUnit = 'kg';
  } else if (isLcl) {
    taxableFormatted = taxavel.toFixed(3).replace('.', ',');
    taxableUnit = 'M³';
  } else {
    taxableFormatted = '1,00';
    taxableUnit = 'FCL';
  }

  // Atualizar elementos na tela
  const cbmEl = document.getElementById('rev-calc-cbm');
  const cubedEl = document.getElementById('rev-calc-cubed-weight');
  const taxEl = document.getElementById('rev-calc-taxable-weight');
  const taxUnitEl = document.getElementById('rev-calc-taxable-unit');

  if (cbmEl) cbmEl.textContent = cbmFormatted;
  if (cubedEl) cubedEl.textContent = airCubadoFormatted;
  if (taxEl) taxEl.textContent = taxableFormatted;
  if (taxUnitEl) taxUnitEl.textContent = taxableUnit;

  // Destaques baseados no modal
  const cbmContainer = document.getElementById('rev-calc-cbm-container');
  const cubedContainer = document.getElementById('rev-calc-cubed-container');
  
  if (isAir) {
    if (cbmContainer) cbmContainer.style.opacity = '0.4';
    if (cubedContainer) cubedContainer.style.opacity = '1';
  } else if (isLcl) {
    if (cbmContainer) cbmContainer.style.opacity = '1';
    if (cubedContainer) cubedContainer.style.opacity = '0.4';
  } else {
    if (cbmContainer) cbmContainer.style.opacity = '0.4';
    if (cubedContainer) cubedContainer.style.opacity = '0.4';
  }
}

window.onerror = function(msg, url, lineNo, columnNo, error) {
  fetch(API + '/log-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, line: lineNo, col: columnNo, stack: error ? error.stack : '' })
  }).catch(() => {});
  return false;
};

let selectedFiles = [];
let currentQuotationId = null;

// TABS
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
  
  checkValidation();
  
  // Auto-atualizar cotações ao entrar nas abas que precisam delas
  if(name === 'quotation' || name === 'return') {
    loadQuotations();
  }
}

// FILE UPLOAD LOGIC
const fileDrop = document.getElementById('fileDrop');
const fileInput = document.getElementById('fileInput');
fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.classList.add('dragover'); });
fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragover'));
fileDrop.addEventListener('drop', e => { e.preventDefault(); fileDrop.classList.remove('dragover'); addFiles(e.dataTransfer.files, false); });
fileInput.addEventListener('change', () => addFiles(fileInput.files, false));

const fileDropAgent = document.getElementById('fileDropAgent');
const fileInputAgent = document.getElementById('fileInputAgent');
if(fileDropAgent) {
  fileDropAgent.addEventListener('dragover', e => { e.preventDefault(); fileDropAgent.classList.add('dragover'); });
  fileDropAgent.addEventListener('dragleave', () => fileDropAgent.classList.remove('dragover'));
  fileDropAgent.addEventListener('drop', e => { e.preventDefault(); fileDropAgent.classList.remove('dragover'); addFiles(e.dataTransfer.files, true); });
  fileInputAgent.addEventListener('change', () => addFiles(fileInputAgent.files, true));
}

let agentFiles = [];
function addFiles(files, isAgent) { 
  for(const f of files) {
    if(isAgent) agentFiles.push(f);
    else selectedFiles.push(f);
  }
  renderFileList(isAgent); 
}
function removeFile(idx, isAgent) { 
  if(isAgent) agentFiles.splice(idx, 1);
  else selectedFiles.splice(idx, 1);
  renderFileList(isAgent); 
}
function renderFileList(isAgent) {
  const container = isAgent ? document.getElementById('fileListAgent') : document.getElementById('fileList');
  const arr = isAgent ? agentFiles : selectedFiles;
  container.innerHTML = arr.map((f, i) =>
    `<div class="file-tag">📎 ${f.name} <span class="remove" onclick="removeFile(${i}, ${isAgent})">✕</span></div>`
  ).join('');
}

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
}

// 1. & 3. EXTRAÇÃO IA (CLIENT / AGENT)
async function runExtract(mode = 'CLIENT') {
  const btnId = mode === 'CLIENT' ? 'btnExtract' : 'btnExtractAgent';
  const btn = document.getElementById(btnId);
  const originalHtml = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processando...';

  try {
    const form = new FormData();
    form.append('mode', mode);
    
    if (mode === 'CLIENT') {
      selectedFiles.forEach(f => form.append('files', f));
      const text = document.getElementById('emailText').value;
      if (text.trim()) form.append('text', text);
    } else {
      agentFiles.forEach(f => form.append('files', f));
      const text = document.getElementById('emailTextAgent').value;
      if (text.trim()) form.append('text', text);
      const qId = document.getElementById('pending-quotations').value;
      if (!qId) throw new Error('Selecione uma cotação primeiro.');
      form.append('quotationId', qId);
    }

    const res = await fetch(API + '/extract', { method: 'POST', body: form });
    const json = await res.json();

    if (res.ok && json.data) {
      if (mode === 'CLIENT') {
        window.lastExtractedRawText = json.rawText; // Armazena o texto original da extração
        toast('🎉 Dados do cliente extraídos! Complete e gere o rascunho.');
        fillReviewForm(json.data, 'CLIENT');
        switchTab('draft');
      } else {
        toast('🎉 Custos extraídos! Valide os valores antes de gerar o PDF.');
        document.getElementById('costs-review-grid').style.display = 'block';
        fillReviewForm(json.data, 'AGENT');
      }
    } else {
      alert('Erro na extração: ' + (json.error || 'Desconhecido'));
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
  btn.disabled = false; btn.innerHTML = originalHtml;
}

function clearExtract() { 
  selectedFiles=[]; agentFiles=[]; 
  renderFileList(false); renderFileList(true);
  document.getElementById('emailText').value=''; 
  document.getElementById('emailTextAgent').value=''; 
  currentQuotationId = null;
}

// 2. REVISÃO DA COTAÇÃO
function renderConf(val, confStr) {
  if(!val) return `<span class="badge-pending">⚠️ Vazio</span>`;
  const conf = parseFloat(confStr);
  if(isNaN(conf)) return '';
  let color = conf >= 0.8 ? 'high' : conf >= 0.5 ? 'medium' : 'low';
  let pct = Math.round(conf * 100);
  return `<div class="conf-wrapper"><div class="conf-dot ${color}"></div> ${pct}%</div>`;
}

function fillReviewForm(d, mode) {
  if (mode === 'CLIENT') {
    document.getElementById('r-reference').value = d.reference || '';
    if(d.client) {
      document.getElementById('r-client-name').value = d.client.name || '';
      document.getElementById('conf-client-name').innerHTML = renderConf(d.client.name, d.client.confidence);
      document.getElementById('r-client-cnpj').value = d.client.cnpj || '';
      document.getElementById('conf-client-cnpj').innerHTML = renderConf(d.client.cnpj, d.client.confidence);
      
      document.getElementById('r-client-contact').value = d.client.contact_name || d.client.contactName || '';
      document.getElementById('conf-client-contact').innerHTML = renderConf(d.client.contact_name || d.client.contactName, d.client.confidence);
      document.getElementById('r-client-phone').value = d.client.contact_phone || d.client.contactPhone || '';
      document.getElementById('conf-client-phone').innerHTML = renderConf(d.client.contact_phone || d.client.contactPhone, d.client.confidence);
    }
    if(d.route) {
      document.getElementById('r-incoterm').value = d.route.incoterm || '';
      document.getElementById('conf-incoterm').innerHTML = renderConf(d.route.incoterm, d.route.confidence);
      
      document.getElementById('r-origin').value = d.route.origin_city || d.route.origin || '';
      document.getElementById('conf-origin').innerHTML = renderConf(d.route.origin_city || d.route.origin, d.route.confidence);
      document.getElementById('r-origin-country').value = d.route.origin_country || '';
      document.getElementById('r-origin-port').value = d.route.origin_airport || '';
      
      document.getElementById('r-destination').value = d.route.destination_city || d.route.destination || '';
      document.getElementById('conf-destination').innerHTML = renderConf(d.route.destination_city || d.route.destination, d.route.confidence);
      document.getElementById('r-destination-country').value = d.route.destination_country || '';
      document.getElementById('r-destination-port').value = d.route.destination_airport || '';
      document.getElementById('r-connections').value = d.route.connections || '';
    }
    if(d.cargo) {
      const typeMap = {"LCL":"LCL", "FCL_20":"FCL_20", "FCL_40":"FCL_40", "AIR_GENERAL":"AIR_GENERAL"};
      const typeVal = (d.cargo.type || '').toUpperCase();
      if (typeVal.includes('AIR') || typeVal.includes('AER') || typeVal.includes('AÉR')) {
        document.getElementById('r-type').value = 'AIR_GENERAL';
      } else if (d.cargo.type && typeMap[d.cargo.type]) {
        document.getElementById('r-type').value = typeMap[d.cargo.type];
      } else if (typeVal.includes('LCL')) {
        document.getElementById('r-type').value = 'LCL';
      } else if (typeVal.includes('20')) {
        document.getElementById('r-type').value = 'FCL_20';
      } else if (typeVal.includes('40')) {
        document.getElementById('r-type').value = 'FCL_40';
      }
      document.getElementById('conf-type').innerHTML = renderConf(d.cargo.type, d.cargo.confidence);
      
      document.getElementById('r-weight').value = d.cargo.gross_weight_kg || '';
      document.getElementById('conf-weight').innerHTML = renderConf(d.cargo.gross_weight_kg, d.cargo.confidence);
      
      document.getElementById('r-packages').value = d.cargo.packages_count || '';
      document.getElementById('conf-packages').innerHTML = renderConf(d.cargo.packages_count, d.cargo.confidence);
      
      document.getElementById('r-imo').value = d.cargo.is_imo ? "true" : "false";
      document.getElementById('conf-imo').innerHTML = renderConf(d.cargo.is_imo, d.cargo.confidence);

      document.getElementById('r-insurance').value = d.cargo.requires_insurance ? "true" : "false";
      document.getElementById('conf-insurance').innerHTML = renderConf(d.cargo.requires_insurance, d.cargo.confidence);

      document.getElementById('r-commercial-value').value = d.cargo.commercial_value_usd || '';
      document.getElementById('conf-commercial-value').innerHTML = renderConf(d.cargo.commercial_value_usd, d.cargo.confidence);

      let dims = '';
      if(d.cargo.dimensions && Array.isArray(d.cargo.dimensions)) {
        dims = d.cargo.dimensions.join(', ');
      } else if (d.cargo.dimensions) {
        dims = String(d.cargo.dimensions);
      }
      document.getElementById('r-dimensions').value = dims;
      document.getElementById('conf-dimensions').innerHTML = renderConf(dims, d.cargo.confidence);
    }
  } else if (mode === 'AGENT') {
    if(d.costs) {
      const freightInput = document.getElementById('r-freight');
      const origValue = d.costs.freight_value !== undefined ? d.costs.freight_value : d.costs.freight_usd;
      const origCurrency = d.costs.freight_currency || 'USD';
      
      freightInput.value = origValue || '';
      if (document.getElementById('r-freight-currency')) {
        document.getElementById('r-freight-currency').value = origCurrency;
      }
      document.getElementById('conf-freight').innerHTML = renderConf(origValue, d.costs.confidence);
      
      freightInput.dispatchEvent(new Event('input'));
      
      if (d.costs.iof_usd && parseFloat(d.costs.iof_usd) > 0) {
        document.getElementById('r-iof').value = d.costs.iof_usd;
      }
      document.getElementById('conf-iof').innerHTML = renderConf(d.costs.iof_usd, d.costs.confidence);

      document.getElementById('r-storage').value = d.costs.storage_brl || '';
      document.getElementById('conf-storage').innerHTML = renderConf(d.costs.storage_brl, d.costs.confidence);

      document.getElementById('r-services').value = d.costs.services_brl || '';
      document.getElementById('conf-services').innerHTML = renderConf(d.costs.services_brl, d.costs.confidence);

      document.getElementById('r-taxes').value = d.costs.taxes_brl || '';
      document.getElementById('conf-taxes').innerHTML = renderConf(d.costs.taxes_brl, d.costs.confidence);

      document.getElementById('r-total').value = d.costs.total_brl || '';
      document.getElementById('conf-total').innerHTML = renderConf(d.costs.total_brl, d.costs.confidence);

      document.getElementById('r-transit-time').value = d.costs.transit_time_days || '';
      document.getElementById('conf-transit-time').innerHTML = renderConf(d.costs.transit_time_days, d.costs.confidence);

      document.getElementById('r-agent-origin-port').value = d.costs.origin_airport || '';
      document.getElementById('conf-agent-origin').innerHTML = renderConf(d.costs.origin_airport, d.costs.confidence);

      document.getElementById('r-agent-connections').value = d.costs.connections || '';
      document.getElementById('conf-agent-connections').innerHTML = renderConf(d.costs.connections, d.costs.confidence);

      document.getElementById('r-agent-carrier').value = d.costs.carrier || '';
      document.getElementById('conf-agent-carrier').innerHTML = renderConf(d.costs.carrier, d.costs.confidence);

      if (d.costs.origin_fees && Array.isArray(d.costs.origin_fees)) {
        const lines = d.costs.origin_fees.map(f => `${f.name}: ${(f.value || 0).toFixed(2)} ${f.currency || 'USD'}`);
        document.getElementById('r-agent-origin-services').value = lines.join('\n');
      } else {
        document.getElementById('r-agent-origin-services').value = '';
      }

      if (d.costs.destination_fees && Array.isArray(d.costs.destination_fees)) {
        const lines = d.costs.destination_fees.map(f => `${f.name}: ${(f.value || 0).toFixed(2)} ${f.currency || 'USD'}`);
        document.getElementById('r-agent-destination-services').value = lines.join('\n');
      } else {
        document.getElementById('r-agent-destination-services').value = '';
      }

      // Frequência, Faixa Tarifária e Frete Unitário
      const qId = document.getElementById('pending-quotations').value;
      const q = allQuotations.find(x => x.id === qId);
      let taxavel = 1;
      let loadType = 'AIR_GENERAL';
      let wBreak = 'normal';
      if (q) {
        loadType = q.loadType || 'AIR_GENERAL';
        wBreak = d.costs.weight_break || q.weightBreak || 'normal';
        document.getElementById('r-weight-break').value = wBreak;
        taxavel = getLocalTaxavel(q.packages, q.totalPackages, q.totalGrossWeightKg, loadType, q.totalCbm, wBreak);
      }
      const freightVal = parseFloat(d.costs.freight_usd) || 0;
      const isAir = loadType.toUpperCase().includes('AIR');
      const isLcl = loadType.toUpperCase().includes('LCL');
      const unitVal = isAir || isLcl ? (freightVal / taxavel) : freightVal;

      document.getElementById('r-frequency').value = d.costs.frequency || 'Semanal';
      document.getElementById('conf-frequency').innerHTML = renderConf(d.costs.frequency, d.costs.confidence);
      document.getElementById('r-freight-unit').value = unitVal.toFixed(2);
    }
    checkValidation();
  }
}

function checkValidation() {
  const isDraftActive = document.getElementById('panel-draft').classList.contains('active');
  const isReturnActive = document.getElementById('panel-return').classList.contains('active');

  if (isDraftActive) {
    let isValid = true;
    document.querySelectorAll('#panel-draft .req').forEach(f => {
      if (!f.value.trim() && f.tagName !== 'SELECT') { f.classList.add('error'); isValid = false; }
      else if (f.tagName === 'SELECT' && !f.value) { f.classList.add('error'); isValid = false; }
      else f.classList.remove('error');
    });

    const strip = document.getElementById('statusStrip');
    const btn = document.getElementById('btnGenDraft');
    if(isValid) {
      strip.className = 'status-strip ok'; strip.innerHTML = '✅ Todos os dados preenchidos. Pronto para gerar Rascunho!';
      if (btn) btn.disabled = false;
    } else {
      strip.className = 'status-strip warn'; strip.innerHTML = '⚠️ Há campos destacados em vermelho vazios.';
      if (btn) btn.disabled = true;
    }
  }

  if (isReturnActive) {
    let isValid = true;
    const qId = document.getElementById('pending-quotations').value;
    if (!qId) isValid = false;
    
    // Verificar se os campos de custo foram preenchidos (se a div estiver visivel)
    if (document.getElementById('costs-review-grid').style.display !== 'none') {
       const freight = document.getElementById('r-freight').value;
       if (!freight || freight.trim() === '') isValid = false;
    } else {
       isValid = false; // Tem que extrair antes de gerar o PDF
    }

    const strip = document.getElementById('statusStrip-return');
    const btn = document.getElementById('btnGenerate');
    if(isValid) {
      if(strip) { strip.className = 'status-strip ok'; strip.innerHTML = '✅ Custos validados. Pronto para gerar PDF!'; }
      if (btn) btn.disabled = false;
    } else {
      if(strip) { strip.className = 'status-strip warn'; strip.innerHTML = '⚠️ Extraia ou preencha os custos do agente para gerar o PDF.'; }
      if (btn) btn.disabled = true;
    }
  }
}

document.querySelectorAll('.req, #r-freight, #r-iof, #r-storage, #r-services, #r-taxes, #r-total, #r-transit-time, #r-frequency, #r-freight-unit, #r-weight-break').forEach(f => f.addEventListener('input', checkValidation));
document.querySelectorAll('.req, #r-freight, #r-iof, #r-storage, #r-services, #r-taxes, #r-total, #r-transit-time, #r-frequency, #r-freight-unit, #r-weight-break').forEach(f => f.addEventListener('change', checkValidation));

// Auto-calculate IOF and Freight Unit/Total reatively
document.getElementById('r-freight').addEventListener('input', function() {
  const freight = parseFloat(this.value) || 0;
  const iofField = document.getElementById('r-iof');
  if (freight > 0 && (!iofField.value || parseFloat(iofField.value) === 0)) {
    iofField.value = (freight * 0.035).toFixed(2);
  }
  
  const qId = document.getElementById('pending-quotations').value;
  const q = allQuotations.find(x => x.id === qId);
  let taxavel = 1;
  let loadType = 'AIR_GENERAL';
  const wBreak = document.getElementById('r-weight-break').value;
  if (q) {
    loadType = q.loadType || 'AIR_GENERAL';
    taxavel = getLocalTaxavel(q.packages, q.totalPackages, q.totalGrossWeightKg, loadType, q.totalCbm, wBreak);
  }
  const isAir = loadType.toUpperCase().includes('AIR');
  const isLcl = loadType.toUpperCase().includes('LCL');
  
  if (isAir || isLcl) {
    document.getElementById('r-freight-unit').value = (freight / taxavel).toFixed(2);
  } else {
    document.getElementById('r-freight-unit').value = freight.toFixed(2);
  }
});

document.getElementById('r-freight-unit').addEventListener('input', function() {
  const unit = parseFloat(this.value) || 0;
  const qId = document.getElementById('pending-quotations').value;
  const q = allQuotations.find(x => x.id === qId);
  let taxavel = 1;
  let loadType = 'AIR_GENERAL';
  const wBreak = document.getElementById('r-weight-break').value;
  if (q) {
    loadType = q.loadType || 'AIR_GENERAL';
    taxavel = getLocalTaxavel(q.packages, q.totalPackages, q.totalGrossWeightKg, loadType, q.totalCbm, wBreak);
  }
  const isAir = loadType.toUpperCase().includes('AIR');
  const isLcl = loadType.toUpperCase().includes('LCL');
  
  let totalFreight = 0;
  if (isAir || isLcl) {
    totalFreight = unit * taxavel;
  } else {
    totalFreight = unit;
  }
  document.getElementById('r-freight').value = totalFreight.toFixed(2);
  
  const iofField = document.getElementById('r-iof');
  iofField.value = (totalFreight * 0.035).toFixed(2);
  checkValidation();
});

document.getElementById('r-weight-break').addEventListener('change', function() {
  const unit = parseFloat(document.getElementById('r-freight-unit').value) || 0;
  const qId = document.getElementById('pending-quotations').value;
  const q = allQuotations.find(x => x.id === qId);
  let taxavel = 1;
  let loadType = 'AIR_GENERAL';
  if (q) {
    loadType = q.loadType || 'AIR_GENERAL';
    taxavel = getLocalTaxavel(q.packages, q.totalPackages, q.totalGrossWeightKg, loadType, q.totalCbm, this.value);
  }
  const isAir = loadType.toUpperCase().includes('AIR');
  const isLcl = loadType.toUpperCase().includes('LCL');
  
  let totalFreight = 0;
  if (isAir || isLcl) {
    totalFreight = unit * taxavel;
  } else {
    totalFreight = unit;
  }
  document.getElementById('r-freight').value = totalFreight.toFixed(2);
  
  const iofField = document.getElementById('r-iof');
  iofField.value = (totalFreight * 0.035).toFixed(2);
  checkValidation();
});



// Geração de rascunho (Fase 2)
async function generateDraftEmail() {
  const btn = document.getElementById('btnGenDraft');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ...';

  try {
    // Salva a cotação inicial no banco
    const body = {
      reference: document.getElementById('r-reference').value,
      direction: 'IMPORT',
      modal: document.getElementById('r-type').value === 'AIR_GENERAL' ? 'AIR' : 'SEA',
      loadType: document.getElementById('r-type').value,
      incoterm: document.getElementById('r-incoterm').value,
      originCity: document.getElementById('r-origin').value,
      originCountry: document.getElementById('r-origin-country').value,
      originPort: document.getElementById('r-origin-port').value,
      destinationCity: document.getElementById('r-destination').value,
      destinationCountry: document.getElementById('r-destination-country').value,
      destinationPort: document.getElementById('r-destination-port').value,
      connections: document.getElementById('r-connections').value || null,
      totalGrossWeightKg: parseFloat(document.getElementById('r-weight').value) || 0,
      totalPackages: parseInt(document.getElementById('r-packages').value) || 0,
      isImo: document.getElementById('r-imo').value === 'true',
      requiresInsurance: document.getElementById('r-insurance').value === 'true',
      commercialValue: parseFloat(document.getElementById('r-commercial-value').value) || null,
      packages: document.getElementById('r-dimensions').value || null,
      status: 'SOLICITADO',
      clientName: document.getElementById('r-client-name').value,
      clientCnpj: document.getElementById('r-client-cnpj').value,
      clientContactName: document.getElementById('r-client-contact').value || null,
      clientContactPhone: document.getElementById('r-client-phone').value || null,
      sourceEmails: window.lastExtractedRawText ? JSON.stringify([window.lastExtractedRawText]) : null
    };

    const resCreate = await fetch(API + '/quotations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const qData = await resCreate.json();
    currentQuotationId = qData.id;

    const resDraft = await fetch(API + `/extract/draft/${currentQuotationId}`, { method: 'POST' });
    const draftData = await resDraft.json();
    
    document.getElementById('r-draft-text').value = draftData.draft || '';
    toast('✅ Rascunho gerado com sucesso!');
  } catch(e) {
    alert('Erro ao gerar rascunho: ' + e.message);
  }
  btn.disabled = false; btn.innerHTML = '🤖 Gerar Rascunho';
}

async function saveAsAwaitingAgent() {
  const btn = document.getElementById('btnSendAgent');
  const originalHtml = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ...';

  try {
    const agentEmail = document.getElementById('r-agent-email').value;
    
    const body = {
      reference: document.getElementById('r-reference').value,
      direction: 'IMPORT',
      modal: document.getElementById('r-type').value === 'AIR_GENERAL' ? 'AIR' : 'SEA',
      loadType: document.getElementById('r-type').value,
      incoterm: document.getElementById('r-incoterm').value,
      originCity: document.getElementById('r-origin').value,
      originCountry: document.getElementById('r-origin-country').value,
      originPort: document.getElementById('r-origin-port').value,
      destinationCity: document.getElementById('r-destination').value,
      destinationCountry: document.getElementById('r-destination-country').value,
      destinationPort: document.getElementById('r-destination-port').value,
      connections: document.getElementById('r-connections').value || null,
      totalGrossWeightKg: parseFloat(document.getElementById('r-weight').value) || 0,
      totalPackages: parseInt(document.getElementById('r-packages').value) || 0,
      isImo: document.getElementById('r-imo').value === 'true',
      requiresInsurance: document.getElementById('r-insurance').value === 'true',
      commercialValue: parseFloat(document.getElementById('r-commercial-value').value) || null,
      packages: document.getElementById('r-dimensions').value || null,
      status: 'AGUARDANDO_AGENTE',
      agentEmail: agentEmail,
      clientName: document.getElementById('r-client-name').value,
      clientCnpj: document.getElementById('r-client-cnpj').value,
      clientContactName: document.getElementById('r-client-contact').value || null,
      clientContactPhone: document.getElementById('r-client-phone').value || null,
      sourceEmails: window.lastExtractedRawText ? JSON.stringify([window.lastExtractedRawText]) : null
    };

    if (!currentQuotationId) {
      // Se ainda não foi criada, criamos diretamente com status AGUARDANDO_AGENTE
      const resCreate = await fetch(API + '/quotations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!resCreate.ok) throw new Error('Falha ao criar cotação no banco');
      const qData = await resCreate.json();
      currentQuotationId = qData.id;
    } else {
      // Se já foi criada (ex: gerou rascunho antes), atualizamos a cotação e a fase
      await fetch(API + `/quotations/${currentQuotationId}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          ...body,
          status: undefined, // deixa a fase cuidar do status
          agentEmail: undefined
        })
      });
      await fetch(API + `/quotations/${currentQuotationId}/phase`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ status: 'AGUARDANDO_AGENTE', agentEmail })
      });
    }

    toast('✅ Enviado para Aguardando Agente!');
    loadQuotations();
    switchTab('quotation');
  } catch(e) { 
    alert('Erro: ' + e.message); 
  } finally {
    btn.disabled = false; btn.innerHTML = originalHtml;
  }
}

function recalculateModalDestinationServicesTotal() {
  const destinationServicesRaw = document.getElementById('rev-destination-services').value || '';
  let destinationServicesTotalBrl = 0;
  
  if (destinationServicesRaw.trim()) {
    const lines = destinationServicesRaw.split('\n');
    lines.forEach(line => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const valAndCurr = parts[1].trim().split(/\s+/);
        const value = parseFloat(valAndCurr[0]) || 0;
        const currency = valAndCurr[1] ? valAndCurr[1].trim().toUpperCase() : 'USD';
        
        const usdRate = 5.05;
        const eurRate = 5.50;

        if (currency === 'BRL') {
          destinationServicesTotalBrl += value;
        } else if (currency === 'USD') {
          destinationServicesTotalBrl += value * usdRate;
        } else if (currency === 'EUR') {
          destinationServicesTotalBrl += value * eurRate;
        } else {
          destinationServicesTotalBrl += value * usdRate;
        }
      }
    });
  }
  
  document.getElementById('rev-services').value = destinationServicesTotalBrl.toFixed(2);
  
  // Recalcular total geral
  const storage = parseFloat(document.getElementById('rev-storage').value) || 0;
  const taxes = parseFloat(document.getElementById('rev-taxes').value) || 0;
  const customsClearance = document.getElementById('rev-customs-clearance').checked;
  const customsValue = parseFloat(document.getElementById('rev-customs-value').value) || 900;
  
  // Frete
  const freight = parseFloat(document.getElementById('rev-freight').value) || 0;
  const freightCurrency = document.getElementById('rev-freight-currency') ? document.getElementById('rev-freight-currency').value : 'USD';
  let freightBrl = freight * 5.05;
  if (freightCurrency === 'EUR') freightBrl = freight * 5.50;
  else if (freightCurrency === 'BRL') freightBrl = freight;
  
  // Origem
  let originBrl = 0;
  const originServicesRaw = document.getElementById('rev-origin-services').value || '';
  if (originServicesRaw.trim()) {
    originServicesRaw.split('\n').forEach(line => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const valAndCurr = parts[1].trim().split(/\s+/);
        const val = parseFloat(valAndCurr[0]) || 0;
        const curr = valAndCurr[1] ? valAndCurr[1].trim().toUpperCase() : 'USD';
        if (curr === 'BRL') originBrl += val;
        else if (curr === 'USD') originBrl += val * 5.05;
        else if (curr === 'EUR') originBrl += val * 5.50;
      }
    });
  }

  const finalTotal = freightBrl + originBrl + destinationServicesTotalBrl + storage + taxes + (customsClearance ? customsValue : 0);
  document.getElementById('r-total').value = finalTotal.toFixed(2);
}

function calculateAndInjectInsurance() {
  const requiresIns = document.getElementById('rev-insurance').value === 'true';
  const destFeesTextarea = document.getElementById('rev-destination-services');
  let currentText = destFeesTextarea.value || '';

  // Limpar linha de seguro existente
  const lines = currentText.split('\n').filter(line => {
    const l = line.trim().toLowerCase();
    return !l.startsWith('seguro') && !l.includes('seguro internacional');
  });

  if (requiresIns) {
    const valMercadoria = parseFloat(document.getElementById('rev-commercial-value').value) || 0;
    const valFrete = parseFloat(document.getElementById('rev-freight').value) || 0;
    const freightCurrency = document.getElementById('rev-freight-currency') ? document.getElementById('rev-freight-currency').value : 'USD';
    
    const usdRate = 5.05;
    const eurRate = 5.50;
    
    // Converter Frete para USD
    let valFreteUsd = valFrete;
    if (freightCurrency === 'EUR') valFreteUsd = valFrete * (eurRate / usdRate);
    else if (freightCurrency === 'BRL') valFreteUsd = valFrete / usdRate;

    // Calcular Origem em USD
    let originServicesTotalUsd = 0;
    const originServicesRaw = document.getElementById('rev-origin-services').value || '';
    if (originServicesRaw.trim()) {
      originServicesRaw.split('\n').forEach(line => {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const valAndCurr = parts[1].trim().split(/\s+/);
          const val = parseFloat(valAndCurr[0]) || 0;
          const curr = valAndCurr[1] ? valAndCurr[1].trim().toUpperCase() : 'USD';
          if (curr === 'USD') originServicesTotalUsd += val;
          else if (curr === 'EUR') originServicesTotalUsd += val * 1.08;
          else if (curr === 'BRL') originServicesTotalUsd += val / usdRate;
        }
      });
    }

    // Calcular Base e Taxa
    const baseSeguroUsd = valMercadoria + valFreteUsd + originServicesTotalUsd;
    const seguroValUsd = Math.max(baseSeguroUsd * 0.002, 40.00);

    lines.push(`Seguro Internacional: ${seguroValUsd.toFixed(2)} USD`);
  }

  destFeesTextarea.value = lines.join('\n');
  recalculateModalDestinationServicesTotal();
}

async function validateAndGeneratePDF(qIdParam = null) {
  const fromHistory = qIdParam !== null;
  const qId = qIdParam || document.getElementById('pending-quotations').value;
  if (!qId) { alert('Selecione uma cotação primeiro.'); return; }

  currentPdfQuotationId = qId;

  // Buscar dados atuais da cotação para pré-preencher o modal de revisão
  try {
    const res = await fetch(API + '/quotations/' + qId);
    const q = await res.json();

    // Pré-preencher modal com dados da cotação
    document.getElementById('rev-client-name').value = (q.client?.name) || '';
    document.getElementById('rev-client-cnpj').value = (q.client?.cnpj) || '';
    document.getElementById('rev-client-contact').value = (q.client?.contactName) || '';
    document.getElementById('rev-client-phone').value = (q.client?.contactPhone) || '';
    document.getElementById('rev-reference').value = q.reference || '';
    document.getElementById('rev-incoterm').value = q.incoterm || 'FOB';
    document.getElementById('rev-modal').value = q.modal || 'AIR';
    document.getElementById('rev-load-type').value = q.loadType || 'AIR_GENERAL';
    document.getElementById('rev-direction').value = q.direction || 'IMPORT';
    document.getElementById('rev-origin-city').value = q.originCity || '';
    document.getElementById('rev-origin-country').value = q.originCountry || '';
    document.getElementById('rev-origin-port').value = q.originPort || '';
    document.getElementById('rev-dest-city').value = q.destinationCity || '';
    document.getElementById('rev-dest-country').value = q.destinationCountry || '';
    document.getElementById('rev-dest-port').value = q.destinationPort || '';
    document.getElementById('rev-weight').value = q.totalGrossWeightKg || '';
    document.getElementById('rev-net-weight').value = q.totalNetWeightKg || '';
    document.getElementById('rev-packages').value = q.totalPackages || '';
    document.getElementById('rev-commercial-value').value = q.commercialValue || '';
    document.getElementById('rev-imo').value = q.isImo ? 'true' : 'false';
    document.getElementById('rev-insurance').value = q.requiresInsurance ? 'true' : 'false';
    document.getElementById('rev-dimensions').value = q.packages || '';
    document.getElementById('rev-cargo-description').value = q.cargoDescription || '';
    document.getElementById('rev-ncm-codes').value = q.ncmCodes || '';
    document.getElementById('rev-connections').value = q.connections || '';
    document.getElementById('rev-carrier').value = q.carrier || '';

    // Atualizar título, descrição e botão de acordo com o modo
    const titleEl = document.querySelector('#pdfReviewOverlay h2');
    const descEl = document.querySelector('#pdfReviewOverlay p');
    const confirmBtn = document.querySelector('#pdfReviewOverlay .btn-primary');
    if (isOnlyEditMode) {
      titleEl.textContent = 'Editar Cotação';
      descEl.textContent = 'Modifique todos os dados básicos da cotação e clique em Salvar.';
      confirmBtn.innerHTML = '<span>💾</span> Salvar Alterações';
    } else {
      titleEl.textContent = 'Revisão Final da Cotação';
      descEl.textContent = 'Revise todos os dados antes de gerar o PDF. Todos os campos são editáveis.';
      confirmBtn.innerHTML = '<span>✅</span> Confirmar e Gerar PDF';
    }

    // Custos: quando vem do histórico usa apenas o banco; do fluxo normal prioriza campos da tela
    if (fromHistory) {
      document.getElementById('rev-freight').value = q.freightValue || '';
      if (document.getElementById('rev-freight-currency')) {
        document.getElementById('rev-freight-currency').value = q.freightCurrency || 'USD';
      }
      document.getElementById('rev-iof').value = q.iofUsd || '';
      document.getElementById('rev-storage').value = q.destinationStorage || '';
      document.getElementById('rev-services').value = q.destinationServicesTotal || '';
      document.getElementById('rev-taxes').value = q.destinationTaxes || '';
      document.getElementById('rev-transit-time').value = q.transitTimeDays || '';
      document.getElementById('rev-frequency').value = q.frequency || 'Semanal';
      document.getElementById('rev-weight-break').value = q.weightBreak || 'normal';
      
      let originFeesText = '';
      if (q.originServices) {
        try {
          const fees = JSON.parse(q.originServices);
          if (Array.isArray(fees)) {
            originFeesText = fees.map(f => `${f.name}: ${(f.value || 0).toFixed(2)} ${f.currency || 'USD'}`).join('\n');
          }
        } catch(e) {
          console.error(e);
        }
      }
      document.getElementById('rev-origin-services').value = originFeesText;

      let destFeesText = '';
      if (q.destinationServices) {
        try {
          const fees = JSON.parse(q.destinationServices);
          if (Array.isArray(fees) && fees.length > 0) {
            destFeesText = fees.map(f => `${f.name}: ${(f.value || 0).toFixed(2)} ${f.currency || 'USD'}`).join('\n');
          }
        } catch(e) {
          console.error(e);
        }
      }
      if (!destFeesText) {
        destFeesText = "CCT fee: 10.00 USD\nDelivery Fee: 55.00 USD\nDesconsolidação / Deconsolidation: 55.00 USD";
      }
      document.getElementById('rev-destination-services').value = destFeesText;
    } else {
      document.getElementById('rev-freight').value = document.getElementById('r-freight').value || q.freightValue || '';
      if (document.getElementById('rev-freight-currency')) {
        document.getElementById('rev-freight-currency').value = (document.getElementById('r-freight-currency') ? document.getElementById('r-freight-currency').value : '') || q.freightCurrency || 'USD';
      }
      document.getElementById('rev-iof').value = document.getElementById('r-iof').value || q.iofUsd || '';
      document.getElementById('rev-storage').value = document.getElementById('r-storage').value || q.destinationStorage || '';
      document.getElementById('rev-services').value = document.getElementById('r-services').value || q.destinationServicesTotal || '';
      document.getElementById('rev-taxes').value = document.getElementById('r-taxes').value || q.destinationTaxes || '';
      document.getElementById('rev-transit-time').value = document.getElementById('r-transit-time').value || q.transitTimeDays || '';
      document.getElementById('rev-frequency').value = document.getElementById('r-frequency').value || q.frequency || 'Semanal';
      document.getElementById('rev-weight-break').value = document.getElementById('r-weight-break').value || q.weightBreak || 'normal';
      
      document.getElementById('rev-origin-port').value = document.getElementById('r-agent-origin-port').value || q.originPort || '';
      document.getElementById('rev-connections').value = document.getElementById('r-agent-connections').value || q.connections || '';
      document.getElementById('rev-carrier').value = document.getElementById('r-agent-carrier').value || q.carrier || '';
      
      document.getElementById('rev-origin-services').value = document.getElementById('r-agent-origin-services').value || '';

      let defaultDestText = "CCT fee: 10.00 USD\nDelivery Fee: 55.00 USD\nDesconsolidação / Deconsolidation: 55.00 USD";
      document.getElementById('rev-destination-services').value = document.getElementById('r-agent-destination-services').value.trim() || (q.destinationServices ? (function(){
        try {
          const fees = JSON.parse(q.destinationServices);
          if (Array.isArray(fees) && fees.length > 0) {
            return fees.map(f => `${f.name}: ${(f.value || 0).toFixed(2)} ${f.currency || 'USD'}`).join('\n');
          }
        } catch(e){}
        return defaultDestText;
      })() : defaultDestText);
    }

    // Calcular o unitário inicial
    const loadType = document.getElementById('rev-load-type').value;
    const bruto = parseFloat(document.getElementById('rev-weight').value) || 0;
    const totalPackages = parseInt(document.getElementById('rev-packages').value) || 1;
    const packagesStr = document.getElementById('rev-dimensions').value || '';
    const freightVal = parseFloat(document.getElementById('rev-freight').value) || 0;
    const wBreakModal = document.getElementById('rev-weight-break').value;
    
    const taxavel = getLocalTaxavel(packagesStr, totalPackages, bruto, loadType, q.totalCbm, wBreakModal);
    const isAir = loadType.toUpperCase().includes('AIR');
    const isLcl = loadType.toUpperCase().includes('LCL');
    const unitVal = isAir || isLcl ? (freightVal / taxavel) : freightVal;
    
    document.getElementById('rev-freight-unit').value = unitVal.toFixed(2);

    // Adicionar listeners para comportamento reativo na modal
    const recalculateModalFreight = function() {
      const freight = parseFloat(document.getElementById('rev-freight').value) || 0;
      const lType = document.getElementById('rev-load-type').value;
      const w = parseFloat(document.getElementById('rev-weight').value) || 0;
      const p = parseInt(document.getElementById('rev-packages').value) || 1;
      const d = document.getElementById('rev-dimensions').value || '';
      const wb = document.getElementById('rev-weight-break').value;
      const currentCbm = calculateCbmLocal(d, p);
      const tx = getLocalTaxavel(d, p, w, lType, currentCbm, wb);
      
      const air = lType.toUpperCase().includes('AIR');
      const lcl = lType.toUpperCase().includes('LCL');
      
      if (air || lcl) {
        document.getElementById('rev-freight-unit').value = (freight / tx).toFixed(2);
      } else {
        document.getElementById('rev-freight-unit').value = freight.toFixed(2);
      }
      document.getElementById('rev-iof').value = (freight * 0.035).toFixed(2);
    };

    const recalculateModalUnit = function() {
      const unit = parseFloat(document.getElementById('rev-freight-unit').value) || 0;
      const lType = document.getElementById('rev-load-type').value;
      const w = parseFloat(document.getElementById('rev-weight').value) || 0;
      const p = parseInt(document.getElementById('rev-packages').value) || 1;
      const d = document.getElementById('rev-dimensions').value || '';
      const wb = document.getElementById('rev-weight-break').value;
      const currentCbm = calculateCbmLocal(d, p);
      const tx = getLocalTaxavel(d, p, w, lType, currentCbm, wb);
      
      const air = lType.toUpperCase().includes('AIR');
      const lcl = lType.toUpperCase().includes('LCL');
      
      let tot = 0;
      if (air || lcl) {
        tot = unit * tx;
      } else {
        tot = unit;
      }
      document.getElementById('rev-freight').value = tot.toFixed(2);
      document.getElementById('rev-iof').value = (tot * 0.035).toFixed(2);
    };

    const handleModalWeightBreakChange = function() {
      const unit = parseFloat(document.getElementById('rev-freight-unit').value) || 0;
      const lType = document.getElementById('rev-load-type').value;
      const w = parseFloat(document.getElementById('rev-weight').value) || 0;
      const p = parseInt(document.getElementById('rev-packages').value) || 1;
      const d = document.getElementById('rev-dimensions').value || '';
      const currentCbm = calculateCbmLocal(d, p);
      const tx = getLocalTaxavel(d, p, w, lType, currentCbm, this.value);
      
      const air = lType.toUpperCase().includes('AIR');
      const lcl = lType.toUpperCase().includes('LCL');
      
      let tot = 0;
      if (air || lcl) {
        tot = unit * tx;
      } else {
        tot = unit;
      }
      document.getElementById('rev-freight').value = tot.toFixed(2);
      document.getElementById('rev-iof').value = (tot * 0.035).toFixed(2);
      updateModalCalculatedWeights();
    };

    const onCargoFieldsChange = function() {
      updateModalCalculatedWeights();
      recalculateModalFreight();
    };

    // Remove event listeners anteriores se existirem e adiciona
    document.getElementById('rev-freight').removeEventListener('input', recalculateModalFreight);
    document.getElementById('rev-freight').addEventListener('input', recalculateModalFreight);
    
    document.getElementById('rev-freight-unit').removeEventListener('input', recalculateModalUnit);
    document.getElementById('rev-freight-unit').addEventListener('input', recalculateModalUnit);

    document.getElementById('rev-weight-break').removeEventListener('change', handleModalWeightBreakChange);
    document.getElementById('rev-weight-break').addEventListener('change', handleModalWeightBreakChange);

    // Registrar novos listeners para campos de carga que afetam cubagem/pesos
    document.getElementById('rev-weight').removeEventListener('input', onCargoFieldsChange);
    document.getElementById('rev-weight').addEventListener('input', onCargoFieldsChange);

    document.getElementById('rev-packages').removeEventListener('input', onCargoFieldsChange);
    document.getElementById('rev-packages').addEventListener('input', onCargoFieldsChange);

    document.getElementById('rev-dimensions').removeEventListener('input', onCargoFieldsChange);
    document.getElementById('rev-dimensions').addEventListener('input', onCargoFieldsChange);

    document.getElementById('rev-load-type').removeEventListener('change', onCargoFieldsChange);
    document.getElementById('rev-load-type').addEventListener('change', onCargoFieldsChange);

    // Calcular e atualizar os pesos e volumes calculados inicialmente
    updateModalCalculatedWeights();

    // Eventos reativos para recálculo do seguro e das taxas de destino
    const onInsuranceTriggerFieldsChange = function() {
      calculateAndInjectInsurance();
    };

    document.getElementById('rev-insurance').removeEventListener('change', onInsuranceTriggerFieldsChange);
    document.getElementById('rev-insurance').addEventListener('change', onInsuranceTriggerFieldsChange);

    document.getElementById('rev-commercial-value').removeEventListener('input', onInsuranceTriggerFieldsChange);
    document.getElementById('rev-commercial-value').addEventListener('input', onInsuranceTriggerFieldsChange);

    document.getElementById('rev-freight').removeEventListener('input', onInsuranceTriggerFieldsChange);
    document.getElementById('rev-freight').addEventListener('input', onInsuranceTriggerFieldsChange);

    if (document.getElementById('rev-freight-currency')) {
      document.getElementById('rev-freight-currency').removeEventListener('change', onInsuranceTriggerFieldsChange);
      document.getElementById('rev-freight-currency').addEventListener('change', onInsuranceTriggerFieldsChange);
    }

    document.getElementById('rev-origin-services').removeEventListener('input', onInsuranceTriggerFieldsChange);
    document.getElementById('rev-origin-services').addEventListener('input', onInsuranceTriggerFieldsChange);

    document.getElementById('rev-destination-services').removeEventListener('input', recalculateModalDestinationServicesTotal);
    document.getElementById('rev-destination-services').addEventListener('input', recalculateModalDestinationServicesTotal);

    // Calcular o seguro e injetar inicialmente
    calculateAndInjectInsurance();

    // Desembaraço: sempre desmarcado por padrão, valor pré-fixado R$ 900,00
    document.getElementById('rev-customs-clearance').checked = false;
    document.getElementById('rev-customs-value').value = '900.00';

    // Exibir o modal
    document.getElementById('pdfReviewOverlay').style.display = 'block';
    document.body.style.overflow = 'hidden';
  } catch(e) {
    alert('Erro ao carregar dados da cotação: ' + e.message);
  }
}

function closePdfReviewModal() {
  document.getElementById('pdfReviewOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

async function confirmAndGeneratePDF() {
  const qId = currentPdfQuotationId;
  if (!qId) return;

  const confirmBtn = document.querySelector('#pdfReviewOverlay .btn-primary');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<span class="spinner"></span> Gerando PDF...';

  try {
    const customsClearance = document.getElementById('rev-customs-clearance').checked;
    const customsValue = parseFloat(document.getElementById('rev-customs-value').value) || 900;
    const frequencyValue = document.getElementById('rev-frequency').value || 'Semanal';
    const weightBreakValue = document.getElementById('rev-weight-break').value || 'normal';

    const originServicesRaw = document.getElementById('rev-origin-services').value || '';
    const originServicesList = [];
    let originServicesTotal = 0;
    
    if (originServicesRaw.trim()) {
      const lines = originServicesRaw.split('\n');
      lines.forEach(line => {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const name = parts[0].trim();
          const valAndCurr = parts[1].trim().split(/\s+/);
          const value = parseFloat(valAndCurr[0]) || 0;
          const currency = valAndCurr[1] ? valAndCurr[1].trim().toUpperCase() : 'USD';
          if (name) {
            originServicesList.push({ name, value, currency });
            
            // Calcular valor equivalente em USD para fins de originServicesTotal
            if (currency === 'USD') {
              originServicesTotal += value;
            } else if (currency === 'EUR') {
              originServicesTotal += value * 1.08;
            } else if (currency === 'BRL') {
              originServicesTotal += value / 5.05;
            } else {
              originServicesTotal += value;
            }
          }
        }
      });
    }
    const originServicesStr = originServicesList.length > 0 ? JSON.stringify(originServicesList) : null;

    const destinationServicesRaw = document.getElementById('rev-destination-services').value || '';
    const destinationServicesList = [];
    let destinationServicesTotal = 0;
    let destinationServicesTotalBrl = 0;
    
    if (destinationServicesRaw.trim()) {
      const lines = destinationServicesRaw.split('\n');
      lines.forEach(line => {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const name = parts[0].trim();
          const valAndCurr = parts[1].trim().split(/\s+/);
          const value = parseFloat(valAndCurr[0]) || 0;
          const currency = valAndCurr[1] ? valAndCurr[1].trim().toUpperCase() : 'USD';
          if (name) {
            destinationServicesList.push({ name, value, currency });
            
            // Calcular valor equivalente em USD para fins de destinationServicesTotal
            if (currency === 'USD') {
              destinationServicesTotal += value;
            } else if (currency === 'EUR') {
              destinationServicesTotal += value * 1.08;
            } else if (currency === 'BRL') {
              destinationServicesTotal += value / 5.05;
            } else {
              destinationServicesTotal += value;
            }

            // Calcular valor equivalente em BRL para o total em reais
            if (currency === 'BRL') {
              destinationServicesTotalBrl += value;
            } else if (currency === 'USD') {
              destinationServicesTotalBrl += value * 5.05;
            } else if (currency === 'EUR') {
              destinationServicesTotalBrl += value * 5.50;
            } else {
              destinationServicesTotalBrl += value * 5.05;
            }
          }
        }
      });
    }
    const destinationServicesStr = destinationServicesList.length > 0 ? JSON.stringify(destinationServicesList) : null;

    const targetServicesBrl = destinationServicesList.length > 0 ? destinationServicesTotalBrl : (parseFloat(document.getElementById('rev-services').value) || 0);

    const body = {
      status: 'APPROVED',
      customsClearanceIncluded: customsClearance,
      transitTimeDays: parseInt(document.getElementById('rev-transit-time').value) || null,
      frequency: frequencyValue,
      weightBreak: weightBreakValue,
      // Atualizar também os dados da cotação com os valores revisados
      originCity: document.getElementById('rev-origin-city').value,
      originCountry: document.getElementById('rev-origin-country').value,
      originPort: document.getElementById('rev-origin-port').value,
      destinationCity: document.getElementById('rev-dest-city').value,
      destinationCountry: document.getElementById('rev-dest-country').value,
      destinationPort: document.getElementById('rev-dest-port').value,
      connections: document.getElementById('rev-connections').value || null,
      incoterm: document.getElementById('rev-incoterm').value,
      loadType: document.getElementById('rev-load-type').value,
      totalGrossWeightKg: parseFloat(document.getElementById('rev-weight').value) || null,
      totalPackages: parseInt(document.getElementById('rev-packages').value) || null,
      costs: {
        freight_usd: (function() {
          const val = parseFloat(document.getElementById('rev-freight').value) || 0;
          const curr = document.getElementById('rev-freight-currency') ? document.getElementById('rev-freight-currency').value : 'USD';
          if (curr === 'EUR') return val * 1.08;
          if (curr === 'BRL') return val / 5.05;
          return val;
        })(),
        freight_value: parseFloat(document.getElementById('rev-freight').value) || 0,
        freight_currency: document.getElementById('rev-freight-currency') ? document.getElementById('rev-freight-currency').value : 'USD',
        iof_usd: parseFloat(document.getElementById('rev-iof').value) || 0,
        storage_brl: parseFloat(document.getElementById('rev-storage').value) || 0,
        services_brl: targetServicesBrl,
        taxes_brl: parseFloat(document.getElementById('rev-taxes').value) || 0,
        frequency: frequencyValue,
        weight_break: weightBreakValue,
        total_brl: parseFloat(document.getElementById('r-total').value) || (
          parseFloat(document.getElementById('rev-storage').value) || 0) +
          targetServicesBrl +
          (parseFloat(document.getElementById('rev-taxes').value) || 0) +
          (customsClearance ? customsValue : 0),
        customs_clearance_brl: customsClearance ? customsValue : 0
      }
    };

    // Atualizar dados básicos da cotação (rota, carga)
    await fetch(API + '/quotations/' + qId, {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        reference: document.getElementById('rev-reference').value,
        incoterm: document.getElementById('rev-incoterm').value,
        loadType: document.getElementById('rev-load-type').value,
        modal: document.getElementById('rev-modal').value,
        direction: document.getElementById('rev-direction').value,
        originCity: document.getElementById('rev-origin-city').value,
        originCountry: document.getElementById('rev-origin-country').value,
        originPort: document.getElementById('rev-origin-port').value,
        destinationCity: document.getElementById('rev-dest-city').value,
        destinationCountry: document.getElementById('rev-dest-country').value,
        destinationPort: document.getElementById('rev-dest-port').value,
        connections: document.getElementById('rev-connections').value || null,
        totalGrossWeightKg: parseFloat(document.getElementById('rev-weight').value) || null,
        totalNetWeightKg: parseFloat(document.getElementById('rev-net-weight').value) || null,
        totalPackages: parseInt(document.getElementById('rev-packages').value) || null,
        commercialValue: parseFloat(document.getElementById('rev-commercial-value').value) || null,
        isImo: document.getElementById('rev-imo').value === 'true',
        requiresInsurance: document.getElementById('rev-insurance').value === 'true',
        packages: document.getElementById('rev-dimensions').value,
        cargoDescription: document.getElementById('rev-cargo-description').value || null,
        ncmCodes: document.getElementById('rev-ncm-codes').value || null,
        frequency: frequencyValue,
        weightBreak: weightBreakValue,
        clientName: document.getElementById('rev-client-name').value,
        clientCnpj: document.getElementById('rev-client-cnpj').value,
        clientContactName: document.getElementById('rev-client-contact').value || null,
        clientContactPhone: document.getElementById('rev-client-phone').value || null,
        carrier: document.getElementById('rev-carrier').value || null,
        originServices: originServicesStr,
        originServicesTotal: originServicesTotal || null,
        destinationServices: destinationServicesStr,
        destinationServicesTotal: destinationServicesTotal || null
      })
    });

    // Atualizar fase e custos
    const resUpdate = await fetch(API + '/quotations/' + qId + '/phase', {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    if (!resUpdate.ok) throw new Error('Falha ao atualizar cotação.');

    if (isOnlyEditMode) {
      toast('✅ Cotação salva com sucesso!');
      closePdfReviewModal();
      loadQuotations();
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<span>💾</span> Salvar Alterações';
      return;
    }

    // Abrir PDF
    window.open(API + '/quotations/' + qId + '/pdf', '_blank');
    toast('✅ PDF gerado com sucesso!');
    closePdfReviewModal();
    loadQuotations();
    switchTab('quotation');
  } catch(e) {
    alert('Erro ao salvar ou gerar PDF: ' + e.message);
  }

  confirmBtn.disabled = false;
  if (isOnlyEditMode) {
    confirmBtn.innerHTML = '<span>💾</span> Salvar Alterações';
  } else {
    confirmBtn.innerHTML = '<span style="margin-right:6px;">✅</span> Confirmar e Gerar PDF';
  }
}

function loadPendingQuotationsDropdown() {
  const select = document.getElementById('pending-quotations');
  const pending = allQuotations.filter(q => q.status === 'AGUARDANDO_AGENTE');
  if (pending.length === 0) {
    select.innerHTML = '<option value="">Nenhuma cotação aguardando agente.</option>';
    return;
  }
  
  select.innerHTML = '<option value="">-- Selecione uma cotação --</option>' + 
    pending.map(q => `<option value="${q.id}">${q.reference || 'S/Ref'} - ${q.client?.name || 'S/N'}</option>`).join('');
    
  // Auto-selecionar a última caso a tela pareça vazia para o usuário
  if (currentQuotationId && pending.some(p => p.id === currentQuotationId)) {
    select.value = currentQuotationId;
    loadPendingQuotationData();
  }
}

function loadPendingQuotationData() {
  // Limpa os campos visuais quando troca
  document.getElementById('costs-review-grid').style.display = 'none';
  clearExtract();
  checkValidation();
}

// 3. COTAÇÕES — Estado global
let allQuotations = [];
let filteredQuotations = [];
let currentPage = 1;
const PAGE_SIZE = 10;
let sortField = 'date';
let sortAsc = false;
let expandedRow = null;
let currentPdfQuotationId = null;

async function loadQuotations() {
  try {
    const res = await fetch(API + '/quotations?t=' + Date.now());
    allQuotations = await res.json();
    
    // DEBUG FORÇADO PARA O BACKEND
    fetch(API + '/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Quotations carregadas com sucesso', qtde: allQuotations.length, primeiroItem: allQuotations.length ? allQuotations[0].reference : 'vazio' })
    }).catch(() => {});

    updateSummaryCards();
    filterQuotations();
  } catch(e) {
    fetch(API + '/log-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Erro TryCatch no loadQuotations', err: e.message }) }).catch(() => {});
    toast('Erro ao carregar cotações: ' + e.message);
  }
}

function updateSummaryCards() {
  const total = allQuotations.length;
  const approved = allQuotations.filter(q => q.status === 'APPROVED').length;
  const pending = allQuotations.filter(q => ['SOLICITADO','AGUARDANDO_AGENTE'].includes(q.status)).length;
  
  // Garantir que é sempre número e não string para evitar crashes de .toFixed()
  const volume = allQuotations.reduce((s, q) => s + (Number(q.freightValue) || 0), 0);
  
  document.getElementById('sc-total').textContent = total;
  document.getElementById('sc-approved').textContent = approved;
  document.getElementById('sc-pending').textContent = pending;
  document.getElementById('sc-volume').textContent = '$' + volume.toFixed(2);
  
  loadPendingQuotationsDropdown();
}

function filterQuotations() {
  const search = (document.getElementById('histSearch').value || '').toLowerCase();
  const statusFilter = document.getElementById('filterStatus').value;
  const modalFilter = document.getElementById('filterModal').value;

  filteredQuotations = allQuotations.filter(q => {
    const clientName = q.client?.name || '';
    const ref = q.reference || '';
    const route = (q.originCity || '') + ' ' + (q.destinationCity || '');
    const searchMatch = !search || [ref, clientName, route].join(' ').toLowerCase().includes(search);
    const statusMatch = !statusFilter || q.status === statusFilter;
    const modalMatch = !modalFilter || q.modal === modalFilter;
    return searchMatch && statusMatch && modalMatch;
  });

  applySorting();
  currentPage = 1;
  renderTable();
}

function sortQuotations(field) {
  if (sortField === field) { sortAsc = !sortAsc; }
  else { sortField = field; sortAsc = true; }
  applySorting();
  renderTable();
}

function applySorting() {
  filteredQuotations.sort((a, b) => {
    let va, vb;
    switch(sortField) {
      case 'reference': va = a.reference || ''; vb = b.reference || ''; break;
      case 'client': va = a.client?.name || ''; vb = b.client?.name || ''; break;
      case 'route': va = (a.originCity || ''); vb = (b.originCity || ''); break;
      case 'freight': va = Number(a.freightValue) || 0; vb = Number(b.freightValue) || 0; return sortAsc ? va - vb : vb - va;
      case 'status': va = a.status || ''; vb = b.status || ''; break;
      case 'date': default: va = a.createdAt || ''; vb = b.createdAt || ''; break;
    }
    if (typeof va === 'string') {
      const cmp = va.localeCompare(vb);
      return sortAsc ? cmp : -cmp;
    }
    return 0;
  });
}

function renderTable() {
  const tbody = document.getElementById('quotationTbody');
  expandedRow = null;

  const statMap = {
    'SOLICITADO': '<span class="status-badge review">🔵 Solicitado</span>',
    'AGUARDANDO_AGENTE': '<span class="status-badge review" style="background:var(--warning);color:#000">🟡 Ag. Agente</span>',
    'RETORNO_RECEBIDO': '<span class="status-badge review" style="background:#a855f7;color:#fff">🟣 Retorno</span>',
    'APPROVED': '<span class="status-badge approved">✅ Aprovada</span>',
    'SENT': '<span class="status-badge approved" style="background:var(--info);">📤 Enviada</span>',
    'EXPIRED': '<span class="status-badge expired">🔴 Expirada</span>'
  };

  if (filteredQuotations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="empty-state">
        <div class="es-icon">📭</div>
        <h3>Nenhuma cotação encontrada</h3>
        <p>Tente ajustar os filtros ou crie uma nova cotação.</p>
      </div>
    </td></tr>`;
    document.getElementById('pagination').style.display = 'none';
    return;
  }

  const totalPages = Math.ceil(filteredQuotations.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageData = filteredQuotations.slice(start, start + PAGE_SIZE);

  const statusMap = {
    'SOLICITADO': { label: 'Solicitado', cls: 'review', icon: '🔵' },
    'AGUARDANDO_AGENTE': { label: 'Ag. Agente', cls: 'review', icon: '🟡' },
    'RETORNO_RECEBIDO': { label: 'Retorno', cls: 'review', icon: '🟣' },
    'APPROVED': { label: 'Aprovada', cls: 'approved', icon: '✅' },
    'SENT': { label: 'Enviada', cls: 'sent', icon: '📤' },
    'EXPIRED': { label: 'Expirada', cls: 'expired', icon: '⛔' },
  };

  let html = '';
  pageData.forEach((q, idx) => {
    const st = statusMap[q.status] || { label: q.status, cls: 'draft', icon: '❓' };
    const modalIcon = q.modal === 'AIR' ? '✈️' : '🚢';
    const modalLabel = q.modal === 'AIR' ? 'Aéreo' : 'Marítimo';
    const origin = q.originCity || '—';
    const dest = q.destinationCity || '—';
    const dateStr = q.createdAt ? new Date(q.createdAt).toLocaleDateString('pt-BR') : '—';
    const freightNum = Number(q.freightValue) || 0;
    const freight = q.freightValue != null ? freightNum.toFixed(2) : '—';
    const displayCurrency = q.freightCurrency || 'USD';
    const currencySymbol = displayCurrency === 'EUR' ? '€' : (displayCurrency === 'BRL' ? 'R$' : '$');
    const globalIdx = start + idx;

    const refText = q.reference || '—';
    const clientName = q.client?.name || '—';

    // Formata a rota de forma limpa
    const routeText = `${origin} → ${dest}`;

    // Define o texto de modal/tipo unificado
    let modalTypeLabel = '—';
    if (q.modal === 'AIR') {
      modalTypeLabel = 'Aéreo';
    } else if (q.loadType) {
      // Simplifica FCL_40 para FCL 40', etc.
      modalTypeLabel = String(q.loadType).replace('FCL_', 'FCL ').replace('AIR_', '');
    } else if (q.modal === 'SEA') {
      modalTypeLabel = 'Marítimo';
    }

    html += `<tr onclick="toggleDetail(${globalIdx}, this)">
      <td class="cell-ref" title="${refText}">${refText}</td>
      <td class="cell-client" title="${clientName}">${clientName === '—' ? '<span style="color:var(--text-muted)">—</span>' : clientName}</td>
      <td class="cell-route" title="${routeText}">
        <div class="route-cell">${origin} <span class="arrow">→</span> ${dest}</div>
      </td>
      <td><span class="modal-badge" title="${modalLabel} - ${q.loadType || ''}">${modalIcon} ${modalTypeLabel}</span></td>
      <td style="font-weight:600;">${currencySymbol}${freight}</td>
      <td><span class="status-badge ${st.cls}">${st.icon} ${st.label}</span></td>
      <td>${dateStr}</td>
      <td>
        <div class="action-btns" onclick="event.stopPropagation()">
          <button class="action-btn" onclick="openEditQuotationModal('${q.id}')" title="Editar Cotação">✏️</button>
          <button class="action-btn" onclick="downloadPdf('${q.id}')" title="Baixar PDF">📄</button>
          <button class="action-btn" onclick="copyPublicLink('${q.id}')" title="Copiar Link da Versão Web">🔗</button>
          <button class="action-btn danger" onclick="deleteQuotation('${q.id}')" title="Excluir">🗑️</button>
        </div>
      </td>
    </tr>`;
  });

  tbody.innerHTML = html;

  // Paginação
  const pag = document.getElementById('pagination');
  pag.style.display = 'flex';
  document.getElementById('pageInfo').textContent = `Mostrando ${start + 1}–${Math.min(start + PAGE_SIZE, filteredQuotations.length)} de ${filteredQuotations.length}`;

  let pagHtml = '';
  for (let p = 1; p <= totalPages; p++) {
    pagHtml += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
  }
  document.getElementById('pageBtns').innerHTML = pagHtml;
}

function goToPage(p) { currentPage = p; renderTable(); }

function toggleDetail(idx, rowEl) {
  const tbody = document.getElementById('quotationTbody');
  // fechar qualquer detalhe aberto
  const existing = tbody.querySelector('.detail-row');
  if (existing) {
    const wasIdx = parseInt(existing.dataset.idx);
    existing.remove();
    if (wasIdx === idx) { expandedRow = null; return; } // toggle off
  }

  const q = filteredQuotations[idx];
  if (!q) return;
  expandedRow = idx;

  const detailTr = document.createElement('tr');
  detailTr.className = 'detail-row';
  detailTr.dataset.idx = idx;
  detailTr.innerHTML = `<td colspan="8">
    <div class="detail-content">
      <div class="detail-group">
        <h4>Informações Gerais</h4>
        <div class="dl"><span class="dt">Referência</span><span class="dd">${q.reference || '—'}</span></div>
        <div class="dl"><span class="dt">Direção</span><span class="dd">${q.direction || '—'}</span></div>
        <div class="dl"><span class="dt">Incoterm</span><span class="dd">${q.incoterm || '—'}</span></div>
        <div class="dl"><span class="dt">Conexões</span><span class="dd" style="color:var(--gold); font-weight:600;">${q.connections || 'Sem conexões'}</span></div>
        <div class="dl"><span class="dt">Contrato</span><span class="dd">${q.contractNumber || '—'}</span></div>
        <div class="dl"><span class="dt">Criado em</span><span class="dd">${q.createdAt ? new Date(q.createdAt).toLocaleString('pt-BR') : '—'}</span></div>
        <div class="dl"><span class="dt">Criado por</span><span class="dd">${q.createdBy?.name || '—'}</span></div>
      </div>
      <div class="detail-group">
        <h4>Dados da Carga</h4>
        <div class="dl"><span class="dt">Peso Bruto</span><span class="dd">${q.totalGrossWeightKg ? q.totalGrossWeightKg + ' kg' : '—'}</span></div>
        <div class="dl"><span class="dt">CBM</span><span class="dd">${q.totalCbm || '—'}</span></div>
        <div class="dl"><span class="dt">Volumes</span><span class="dd">${q.totalPackages || '—'}</span></div>
        <div class="dl"><span class="dt">IMO</span><span class="dd">${q.isImo ? '⚠️ Sim' : 'Não'}</span></div>
        <div class="dl"><span class="dt">Descrição</span><span class="dd">${q.cargoDescription || '—'}</span></div>
      </div>
      <div class="detail-group">
        <h4>Custos & Valores</h4>
        <div class="dl"><span class="dt">Frete (${q.freightCurrency || 'USD'})</span><span class="dd" style="color:var(--gold); font-weight:700;">${q.freightCurrency === 'EUR' ? '€' : (q.freightCurrency === 'BRL' ? 'R$' : '$')}${q.freightValue != null ? Number(q.freightValue).toFixed(2) : '—'}</span></div>
        <div class="dl"><span class="dt">IOF (${q.freightCurrency || 'USD'})</span><span class="dd">${q.freightCurrency === 'EUR' ? '€' : (q.freightCurrency === 'BRL' ? 'R$' : '$')}${q.iofUsd != null ? Number(q.iofUsd).toFixed(2) : '—'}</span></div>
        <div class="dl"><span class="dt">Armazenagem (BRL)</span><span class="dd">R$${q.destinationStorage != null ? Number(q.destinationStorage).toFixed(2) : '—'}</span></div>
        <div class="dl"><span class="dt">Serviços (BRL)</span><span class="dd">R$${q.destinationServicesTotal != null ? Number(q.destinationServicesTotal).toFixed(2) : '—'}</span></div>
        <div class="dl"><span class="dt">Total (BRL)</span><span class="dd" style="color:var(--success); font-weight:700;">R$${q.totalBrl != null ? Number(q.totalBrl).toFixed(2) : '—'}</span></div>
      </div>
    </div>
  </td>`;

  // Inserir logo após a row clicada
  rowEl.after(detailTr);
}

function openEditQuotationModal(id) {
  isOnlyEditMode = true;
  validateAndGeneratePDF(id);
}

function downloadPdf(id) {
  isOnlyEditMode = false;
  validateAndGeneratePDF(id);
}

function copyPublicLink(id) {
  const link = `${API}/quotations/${id}/view`;
  navigator.clipboard.writeText(link).then(() => {
    toast('🔗 Link público copiado para a área de transferência!');
  }).catch(err => {
    const el = document.createElement('textarea');
    el.value = link;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    toast('🔗 Link público copiado!');
  });
}

async function deleteQuotation(id) {
  if (!confirm('Tem certeza que deseja excluir esta cotação? Esta ação é irreversível.')) return;
  try {
    const res = await fetch(`${API}/quotations/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast('🗑️ Cotação excluída com sucesso!');
      loadQuotations();
    } else {
      throw new Error('Falha ao excluir');
    }
  } catch(e) {
    alert('Erro: ' + e.message);
  }
}

// Auto-carregar ao abrir a aba
const origSwitchTab = switchTab;
switchTab = function(name) {
  origSwitchTab(name);
  if (name === 'quotation' && allQuotations.length === 0) loadQuotations();
};

// ═══ CONFIGURAÇÕES ═══
function openSettings() {
  document.getElementById('settingsOverlay').classList.add('active');
  switchSettingsTab('company');
}
function closeSettings() {
  document.getElementById('settingsOverlay').classList.remove('active');
}

function switchSettingsTab(tab) {
  document.querySelectorAll('#settingsNav li').forEach(li => li.classList.remove('active'));
  const items = document.querySelectorAll('#settingsNav li');
  const tabMap = ['company','logo','knowledge','taxes','template','users'];
  const idx = tabMap.indexOf(tab);
  if (idx >= 0 && items[idx]) items[idx].classList.add('active');

  const content = document.getElementById('settingsContent');
  const settingsData = JSON.parse(localStorage.getItem('audaz_settings') || '{}');

  switch(tab) {
    case 'company':
      content.innerHTML = `
        <div class="sc-title">🏢 Dados da Empresa</div>
        <p class="sc-desc">Informações que serão usadas no cabeçalho das propostas PDF.</p>
        <div class="settings-section">
          <h3>Informações Gerais</h3>
          <div class="sg-row">
            <div class="form-group"><label>Nome da Empresa</label>
              <input type="text" id="s-company-name" value="${settingsData.companyName || 'Audaz Global'}" placeholder="Ex: Audaz Global">
            </div>
            <div class="form-group"><label>CNPJ</label>
              <input type="text" id="s-company-cnpj" value="${settingsData.companyCnpj || ''}" placeholder="00.000.000/0000-00">
            </div>
          </div>
          <div class="sg-row">
            <div class="form-group"><label>E-mail Comercial</label>
              <input type="email" id="s-company-email" value="${settingsData.companyEmail || ''}" placeholder="contato@audazglobal.com">
            </div>
            <div class="form-group"><label>Telefone</label>
              <input type="text" id="s-company-phone" value="${settingsData.companyPhone || ''}" placeholder="(11) 99999-9999">
            </div>
          </div>
          <div class="form-group"><label>Endereço</label>
            <input type="text" id="s-company-address" value="${settingsData.companyAddress || ''}" placeholder="Rua, número, cidade - UF">
          </div>
        </div>
        <button class="btn btn-primary" onclick="saveCompanySettings()">💾 Salvar Dados</button>`;
      break;

    case 'logo':
      content.innerHTML = `
        <div class="sc-title">🖼️ Logo & Identidade Visual</div>
        <p class="sc-desc">O logo será inserido automaticamente no cabeçalho de todas as propostas PDF geradas.</p>
        <div class="settings-section">
          <h3>Logo Atual</h3>
          <div class="logo-preview" id="logoPreview">
            <img src="/logo-preview" onerror="this.parentElement.innerHTML='<span style=color:var(--text-muted);font-size:13px>Nenhum logo carregado</span>'">
          </div>
          <div class="form-group">
            <label>Enviar Novo Logo (PNG/JPG recomendado, fundo transparente)</label>
            <input type="file" id="logoUpload" accept="image/*" style="padding:8px;" onchange="previewLogo(this)">
          </div>
          <button class="btn btn-primary" onclick="uploadLogo()">📤 Enviar Logo</button>
        </div>`;
      break;

    case 'knowledge':
      content.innerHTML = `
        <div class="sc-title">🧠 Base de Conhecimento (IA)</div>
        <p class="sc-desc">Regras e cenários que a IA consulta durante a extração. Quanto mais regras, mais precisa a extração.</p>
        <div class="settings-section">
          <h3>Nova Regra</h3>
          <div class="form-group"><label>Título</label><input type="text" id="kTitle" placeholder="Ex: IOF padrão para marítimo"></div>
          <div class="form-group"><label>Instrução / Conteúdo</label><textarea id="kContent" placeholder="Ex: O IOF padrão para operações marítimas é 3.5% sobre o frete internacional..."></textarea></div>
          <button class="btn btn-primary" onclick="createKnowledge()" style="margin-top:8px;">💾 Salvar Regra</button>
        </div>
        <div class="settings-section">
          <h3>Regras Cadastradas</h3>
          <div id="knowledgeTableContainer"><p style="color:var(--text-muted);font-size:13px;">Carregando...</p></div>
        </div>`;
      loadKnowledgeTable();
      break;

    case 'taxes':
      content.innerHTML = `
        <div class="sc-title">💱 Taxas Padrão</div>
        <p class="sc-desc">Valores padrão usados pela IA e pela geração de PDF quando não há dados explícitos no e-mail.</p>
        <div class="settings-section">
          <h3>Taxas de Importação</h3>
          <div class="sg-row">
            <div class="form-group"><label>IOF Padrão (%)</label>
              <input type="number" id="s-iof-rate" step="0.1" value="${settingsData.iofRate || 3.5}" placeholder="3.5">
            </div>
            <div class="form-group"><label>Câmbio USD → BRL (referência)</label>
              <input type="number" id="s-exchange-rate" step="0.01" value="${settingsData.exchangeRate || ''}" placeholder="Ex: 5.15">
            </div>
          </div>
          <div class="sg-row">
            <div class="form-group"><label>Armazenagem Mínima (BRL)</label>
              <input type="number" id="s-min-storage" step="0.01" value="${settingsData.minStorage || ''}" placeholder="Ex: 150.00">
            </div>
            <div class="form-group"><label>Validade Padrão da Cotação (dias)</label>
              <input type="number" id="s-validity-days" value="${settingsData.validityDays || 15}" placeholder="15">
            </div>
          </div>
        </div>
        <button class="btn btn-primary" onclick="saveTaxSettings()">💾 Salvar Taxas</button>`;
      break;

    case 'template':
      content.innerHTML = `
        <div class="sc-title">📄 Template do PDF</div>
        <p class="sc-desc">Personalize textos fixos e aparência das propostas geradas.</p>
        <div class="settings-section">
          <div class="empty-state" style="padding:40px">
            <div class="es-icon">🚧</div>
            <h3>Em Desenvolvimento</h3>
            <p>Em breve você poderá personalizar cores, termos e condições, observações padrão e rodapé das propostas.</p>
          </div>
        </div>`;
      break;

    case 'users':
      content.innerHTML = `
        <div class="sc-title">👥 Gerenciamento de Usuários</div>
        <p class="sc-desc">Controle de acesso, permissões e convites.</p>
        <div class="settings-section">
          <div class="empty-state" style="padding:40px">
            <div class="es-icon">🚧</div>
            <h3>Em Desenvolvimento</h3>
            <p>Em breve você poderá convidar membros da equipe, definir papéis (Admin, Operador) e gerenciar permissões.</p>
          </div>
        </div>`;
      break;
  }
}

// Salvar dados da empresa (localStorage)
function saveCompanySettings() {
  const data = JSON.parse(localStorage.getItem('audaz_settings') || '{}');
  data.companyName = document.getElementById('s-company-name').value;
  data.companyCnpj = document.getElementById('s-company-cnpj').value;
  data.companyEmail = document.getElementById('s-company-email').value;
  data.companyPhone = document.getElementById('s-company-phone').value;
  data.companyAddress = document.getElementById('s-company-address').value;
  localStorage.setItem('audaz_settings', JSON.stringify(data));
  toast('✅ Dados da empresa salvos com sucesso!');
}

// Salvar taxas (localStorage)
function saveTaxSettings() {
  const data = JSON.parse(localStorage.getItem('audaz_settings') || '{}');
  data.iofRate = parseFloat(document.getElementById('s-iof-rate').value) || 3.5;
  data.exchangeRate = parseFloat(document.getElementById('s-exchange-rate').value) || null;
  data.minStorage = parseFloat(document.getElementById('s-min-storage').value) || null;
  data.validityDays = parseInt(document.getElementById('s-validity-days').value) || 15;
  localStorage.setItem('audaz_settings', JSON.stringify(data));
  toast('✅ Taxas padrão salvas com sucesso!');
}

// Logo preview
function previewLogo(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('logoPreview').innerHTML = `<img src="${e.target.result}">`;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function uploadLogo() {
  const input = document.getElementById('logoUpload');
  if (!input.files || !input.files[0]) { toast('Selecione um arquivo primeiro.'); return; }
  const form = new FormData();
  form.append('logo', input.files[0]);
  try {
    const res = await fetch(API + '/settings/logo', { method: 'POST', body: form });
    if (res.ok) { toast('✅ Logo atualizado com sucesso!'); }
    else { toast('Erro ao enviar o logo.'); }
  } catch(e) { toast('Erro: ' + e.message); }
}

// Knowledge Base (tabela profissional)
let editingKnowledgeId = null;

async function createKnowledge() {
  const title = document.getElementById('kTitle').value;
  const content = document.getElementById('kContent').value;
  if (!title || !content) { toast('Preencha o título e o conteúdo da regra.'); return; }
  const body = { title, category: 'rule', content, active: true };
  
  if (editingKnowledgeId) {
    // Modo de Edição
    try {
      const res = await fetch(API + '/knowledge/' + editingKnowledgeId, { 
        method: 'PUT', 
        headers: {'Content-Type':'application/json'}, 
        body: JSON.stringify(body) 
      });
      if (res.ok) {
        toast('✅ Regra atualizada!');
        cancelEditKnowledge();
        loadKnowledgeTable();
      } else {
        toast('❌ Erro ao atualizar regra.');
      }
    } catch (e) {
      toast('Erro: ' + e.message);
    }
  } else {
    // Modo de Criação
    await fetch(API + '/knowledge', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    toast('✅ Regra salva!'); document.getElementById('kTitle').value = ''; document.getElementById('kContent').value = '';
    loadKnowledgeTable();
  }
}

function startEditKnowledge(id, title, content) {
  editingKnowledgeId = id;
  document.getElementById('kTitle').value = title;
  document.getElementById('kContent').value = content;
  
  // Atualiza o título da seção e do botão
  const sectionHeader = document.querySelector('#settingsContent .settings-section h3');
  if (sectionHeader) sectionHeader.textContent = 'Editar Regra';
  
  const submitBtn = document.querySelector('#settingsContent .settings-section button.btn-primary');
  if (submitBtn) submitBtn.textContent = '💾 Atualizar Regra';

  // Adiciona botão de cancelar se não existir
  let cancelBtn = document.getElementById('kCancelBtn');
  if (!cancelBtn) {
    cancelBtn = document.createElement('button');
    cancelBtn.id = 'kCancelBtn';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.style.marginTop = '8px';
    cancelBtn.style.marginLeft = '8px';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.onclick = cancelEditKnowledge;
    submitBtn.after(cancelBtn);
  }
  
  // Foca no título para edição
  document.getElementById('kTitle').focus();
}

function cancelEditKnowledge() {
  editingKnowledgeId = null;
  document.getElementById('kTitle').value = '';
  document.getElementById('kContent').value = '';
  
  const sectionHeader = document.querySelector('#settingsContent .settings-section h3');
  if (sectionHeader) sectionHeader.textContent = 'Nova Regra';
  
  const submitBtn = document.querySelector('#settingsContent .settings-section button.btn-primary');
  if (submitBtn) submitBtn.textContent = '💾 Salvar Regra';
  
  const cancelBtn = document.getElementById('kCancelBtn');
  if (cancelBtn) cancelBtn.remove();
}

async function loadKnowledgeTable() {
  try {
    const res = await fetch(API + '/knowledge');
    const rules = await res.json();
    const container = document.getElementById('knowledgeTableContainer');
    if (!rules || rules.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Nenhuma regra cadastrada ainda.</p>';
      return;
    }
    let html = `<table class="k-table"><thead><tr>
      <th>Título</th><th>Categoria</th><th>Conteúdo</th><th>Ativo</th><th>Ações</th>
    </tr></thead><tbody>`;
    rules.forEach(r => {
      const preview = (r.content || '').substring(0, 60) + ((r.content || '').length > 60 ? '...' : '');
      // Escapa aspas para evitar quebra no HTML do onclick
      const safeTitle = (r.title || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const safeContent = (r.content || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n').replace(/\r/g, '');
      
      html += `<tr>
        <td style="font-weight:600;">${r.title}</td>
        <td><span class="status-badge draft">${r.category || 'rule'}</span></td>
        <td style="color:var(--text-muted);">${preview}</td>
        <td><button class="k-toggle ${r.active ? 'on' : 'off'}" onclick="toggleKnowledge('${r.id}', ${!r.active})"></button></td>
        <td>
          <div class="action-btns">
            <button class="action-btn" onclick="startEditKnowledge('${r.id}', '${safeTitle}', '${safeContent}')" title="Editar">✏️</button>
            <button class="action-btn danger" onclick="deleteKnowledge('${r.id}')" title="Excluir">🗑️</button>
          </div>
        </td>
      </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch(e) {
    document.getElementById('knowledgeTableContainer').innerHTML = '<p style="color:var(--error);">Erro ao carregar regras.</p>';
  }
}

async function toggleKnowledge(id, active) {
  await fetch(API + '/knowledge/' + id, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ active })
  });
  toast(active ? '✅ Regra ativada' : '⏸️ Regra desativada');
  loadKnowledgeTable();
}

async function deleteKnowledge(id) {
  if (!confirm('Excluir esta regra?')) return;
  if (editingKnowledgeId === id) cancelEditKnowledge();
  await fetch(API + '/knowledge/' + id, { method: 'DELETE' });
  toast('🗑️ Regra excluída!'); loadKnowledgeTable();
}

// Fechar settings com ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSettings();
});
