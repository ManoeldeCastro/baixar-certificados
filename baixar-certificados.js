// baixar-certificados.js
// Node 18+ recomendado
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const puppeteer = require('puppeteer');

const INPUT_TSV = path.join(__dirname, 'dados.tsv');
const OUTPUT_DIR = path.join(__dirname, 'certificados');
const CONCURRENCY = 3;            // nº de abas simultâneas
const LOGIN_NECESSARIO = false;   // se precisar logar, mude para true

// Ajuste se precisar logar antes (selecione os elementos corretos do seu login)
const CREDENCIAIS = { usuario: 'SEU_LOGIN', senha: 'SUA_SENHA' };

function sanitizeFilename(name) {
  const base = (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^\w\s.-]/g, '') // remove símbolos estranhos
    .replace(/\s+/g, ' ')      // compacta espaços múltiplos
    .trim();
  return base || 'usuario_sem_nome';
}

async function lerTSV(caminho) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(caminho)
      .pipe(parse({
        delimiter: '\t',
        columns: true,
        trim: true,
        skip_empty_lines: true
      }))
      .on('data', (r) => {
        rows.push({
          nome: r.NomeUsuario,
          url: r.LinkCertificado
        });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function loginSeNecessario(page) {
  // Exemplo – ajuste para o fluxo real
  await page.goto('https://jsfassessoria.engage.bz/#/login', { waitUntil: 'networkidle0', timeout: 120000 });
  await page.type('#usuario', CREDENCIAIS.usuario);
  await page.type('#senha', CREDENCIAIS.senha);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 })
  ]);
}

async function salvarPdf(page, url, outPath) {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
  // Se o certificado carregar dados via API, acrescente um wait:
  // await page.waitForTimeout(1500);
  await page.pdf({
    path: outPath,
    printBackground: true,
    format: 'A4',
  });
}

async function run() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const linhas = await lerTSV(INPUT_TSV);
  if (!linhas.length) {
    console.log('TSV sem registros.');
    return;
  }
  console.log(`Registros para processar: ${linhas.length}`);

  const browser = await puppeteer.launch({ headless: 'new' });
  const context = await browser.createBrowserContext();

  if (LOGIN_NECESSARIO) {
    const p0 = await context.newPage();
    await loginSeNecessario(p0);
    await p0.close();
  }

  const erros = [];
  let i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= linhas.length) break;

      const { nome, url } = linhas[idx];
      const baseName = sanitizeFilename(nome);
      let fileName = `${baseName}.pdf`;
      let k = 2;
      while (fs.existsSync(path.join(OUTPUT_DIR, fileName))) {
        fileName = `${baseName} (${k++}).pdf`;
      }
      const outPath = path.join(OUTPUT_DIR, fileName);

      try {
        const page = await context.newPage();
        await salvarPdf(page, url, outPath);
        await page.close();
        console.log(`[OK] ${fileName}`);
      } catch (e) {
        console.error(`[ERRO] ${fileName} -> ${e.message}`);
        erros.push({ nome, url, arquivo: fileName, erro: e.message });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await browser.close();

  if (erros.length) {
    fs.writeFileSync(path.join(__dirname, 'erros_download.json'), JSON.stringify(erros, null, 2));
    console.log(`\nConcluído com erros: ${erros.length}. Confira erros_download.json`);
  } else {
    console.log('\nConcluído sem erros.');
  }
  console.log(`PDFs salvos em: ${OUTPUT_DIR}`);
}

run().catch(err => {
  console.error('Falha geral:', err);
  process.exit(1);
});
