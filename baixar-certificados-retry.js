// baixar-certificados-retry.js
// Reprocessa SOMENTE os certificados que falharam (lendo erros_download.json)
// Node 18+ recomendado

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const INPUT_ERRORS_JSON = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'erros_download.json');

const OUTPUT_DIR = path.join(__dirname, 'certificados');

const CONCURRENCY = 1;            // retry: recomendo 1 (menos stress no site)
const LOGIN_NECESSARIO = false;   // se precisar logar, mude para true
const CREDENCIAIS = { usuario: 'SEU_LOGIN', senha: 'SUA_SENHA' };

const NAV_TIMEOUT = 180000;       // 3 min
const PDF_TIMEOUT = 180000;       // 3 min
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2500;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sanitizeFilename(name) {
  const base = (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return base || 'sem_nome';
}

function safeOutFileName(item) {
  // prioriza o nome já calculado no run anterior (campo "arquivo")
  if (item && item.arquivo) return sanitizeFilename(item.arquivo);
  // fallback (se não tiver "arquivo")
  const guid8 = (item.guid || '').toString().replace(/-/g, '').slice(0, 8) || 'semguid';
  const comp = sanitizeFilename(item.competicao || 'Sem competicao').slice(0, 50);
  const trilha = sanitizeFilename(item.trilha || 'Sem trilha').slice(0, 45);
  const nome = sanitizeFilename(item.nome || 'Sem nome').slice(0, 45);
  const usuario = `u${item.usuarioId || '0'}`;
  return `${comp} - ${trilha} - ${nome} - ${usuario} - ${guid8}.pdf`;
}

async function loginSeNecessario(page) {
  await page.goto('https://jsfassessoria.engage.bz/#/login', { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
  await page.type('#usuario', CREDENCIAIS.usuario);
  await page.type('#senha', CREDENCIAIS.senha);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: NAV_TIMEOUT }),
  ]);
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`Timeout (${label}) após ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function salvarPdf(page, url, outPath) {
  page.setDefaultTimeout(NAV_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  // DICA: networkidle0 costuma travar em SPA por causa de requests contínuos
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

  // garante que a SPA terminou de hidratar o básico
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: NAV_TIMEOUT }).catch(() => {});

  // pequena folga pra render (evita gerar PDF “no meio” do loader)
  await page.waitForTimeout(3500);

  // PDF com timeout controlado por nós (page.pdf não tem timeout confiável em todas as versões)
  await withTimeout(
    page.pdf({
      path: outPath,
      printBackground: true,
      format: 'A4',
    }),
    PDF_TIMEOUT,
    'page.pdf'
  );
}

async function run() {
  if (!fs.existsSync(INPUT_ERRORS_JSON)) {
    console.error(`Arquivo não encontrado: ${INPUT_ERRORS_JSON}`);
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const raw = fs.readFileSync(INPUT_ERRORS_JSON, 'utf8');
  const erros = JSON.parse(raw);

  if (!Array.isArray(erros) || erros.length === 0) {
    console.log('Nenhum erro para reprocessar (array vazio).');
    return;
  }

  // remove duplicados por URL (se tiver repetidos)
  const uniq = [];
  const seen = new Set();
  for (const e of erros) {
    const key = (e && e.url) ? e.url : JSON.stringify(e);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(e);
  }

  console.log(`Registros com erro para retry: ${uniq.length}`);
  console.log(`Lendo de: ${INPUT_ERRORS_JSON}`);
  console.log(`Salvando em: ${OUTPUT_DIR}`);

  const browser = await puppeteer.launch({ headless: 'new' });
  const context = await browser.createBrowserContext();

  if (LOGIN_NECESSARIO) {
    const p0 = await context.newPage();
    await loginSeNecessario(p0);
    await p0.close();
  }

  let i = 0;
  const errosRetry = [];

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= uniq.length) break;

      const item = uniq[idx];
      const url = item.url;
      const fileName = safeOutFileName(item);
      const outPath = path.join(OUTPUT_DIR, fileName);

      // se já existe (por algum motivo), não rebaixa
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        console.log(`[SKIP] já existe: ${fileName}`);
        continue;
      }

      let lastErr = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const page = await context.newPage();

        try {
          console.log(`[TRY ${attempt}/${MAX_RETRIES}] ${fileName}`);
          await salvarPdf(page, url, outPath);
          console.log(`[OK] ${fileName}`);
          lastErr = null;
          await page.close();
          break;
        } catch (e) {
          lastErr = e;
          console.error(`[ERRO] ${fileName} -> ${e.message}`);
          await page.close().catch(() => {});
          // apaga arquivo parcial, se tiver
          try {
            if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
          } catch (_) {}

          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS);
          }
        }
      }

      if (lastErr) {
        errosRetry.push({
          ...item,
          arquivo: fileName,
          erro: lastErr.message,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await browser.close();

  if (errosRetry.length) {
    const outErr = path.join(__dirname, 'erros_retry.json');
    fs.writeFileSync(outErr, JSON.stringify(errosRetry, null, 2));
    console.log(`\nRetry concluído com erros: ${errosRetry.length}. Confira: ${outErr}`);
  } else {
    console.log('\nRetry concluído sem erros. ✅');
  }
}

run().catch(err => {
  console.error('Falha geral:', err);
  process.exit(1);
});
