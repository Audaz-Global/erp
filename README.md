# ERP Audaz (Automação de Cotação de Fretes)

> **Módulo:** Automação de Backoffice e Processamento de Documentos.
> **Objetivo:** Automatizar o fluxo completo de cotações de frete internacional, desde o recebimento de e-mails (Outlook) e leitura de arquivos (PDF/Excel via IA), até a validação de regras de negócio (Incoterms, Taxas) e integração com o sistema core (Atlantis).

---

## Arquitetura e Fluxo de Dados

O backend é construído em Node.js com TypeScript e arquitetura de Serviços (`src/services`), permitindo alta modularidade no tratamento de fretes.

```mermaid
flowchart TD
    subgraph Fontes_de_Entrada
        Outlook[Microsoft Outlook\nCaixa de E-mail]
        Upload[Upload Manual\nPainel Web]
    end

    subgraph Pipeline_de_Automacao [Backend Node.js]
        Cron[outlookCron.ts\nMonitor de E-mails]
        Parser[parserService.ts\npdfService.ts]
        AI[aiService.ts\nExtração via GenAI]
        Rules[Motor de Regras\nIncoterms, Taxas, Ptax]
    end
    
    subgraph Sistemas_Destino
        DB[(Banco de Dados\nPrisma / MySQL)]
        Atlantis[ERP Atlantis]
    end

    Outlook -->|Fetch E-mails| Cron
    Upload --> Parser
    Cron -->|Arquivos .msg / .eml| Parser
    Parser -->|Extração Bruta| AI
    AI -->|JSON Estruturado| Rules
    Rules -->|Validação Lógica| DB
    DB <-->|Sincronização| Atlantis
```

### Tecnologias Utilizadas
* **Plataforma:** Node.js (TypeScript) com Express.
* **Inteligência Artificial:** Integração forte com LLMs (`@google/generative-ai`) para OCR e extração semântica de PDF e imagens (`sharp`, `puppeteer`).
* **Manipulação de Documentos:** `pdf-parse`, `msgreader`, `mailparser`, `xlsx`, `papaparse`.
* **Persistência:** Prisma ORM.

---

## Principais Módulos do Sistema (Services)

O diretório `src/services` contém a inteligência central da Audaz:
1. **Motores de Extração e AI:** `aiService.ts`, `parserService.ts`, `pdfService.ts` (capazes de destrinchar propostas complexas de armadores).
2. **Motores de Regra Aduaneira:** `incotermRuleService.ts`, `incotermTreeService.ts`, `dangerousGoodsService.ts` (validação de viabilidade e custos extras).
3. **Motores Financeiros:** `costCompositionService.ts`, `feeCalculationService.ts`, `ptaxService.ts` (cálculo real e comparativo de propostas).
4. **Integrações:** `outlookCron.ts`, `atlantisService.ts`, `smartcomexService.ts`.

---

## Instalação e Execução Local

```bash
# 1. Acesse a pasta do backend
cd backend

# 2. Instale as dependências (necessário Node.js 18+)
npm install

# 3. Configure as variáveis de ambiente baseando-se no .env.example
# (Serão necessárias as credenciais da API do Google Gemini, Outlook e Banco)
# DATABASE_URL=mysql://user:pass@host:3306/db

# 4. Sincronize o Prisma
npx prisma generate
npx prisma migrate dev
```

### Inicialização
Para ambiente de desenvolvimento (com auto-reload dinâmico via `ts-node-dev`):
```bash
npm run dev
```
Para inicializar o conjunto completo (Backend + Serviços Secundários), pode-se utilizar o `docker-compose.yml` contido no projeto.

---

## Scripts e Utilitários de Diagnóstico
A raiz do `backend/` possui mais de 10 scripts auxiliares cruciais para debugar gargalos na IA e no parseamento. Destacam-se:
* `test-ai.ts`: Valida a conexão e assertividade do prompt da IA.
* `debug-pdf.js`, `debug-xls.js`, `debug-pack3.js`: Utilitários para testar extração documental de arquivos específicos antes de enviá-los ao pipeline principal.
