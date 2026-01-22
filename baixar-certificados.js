// baixar-certificados.js
// Node 18+ recomendado
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const puppeteer = require('puppeteer');

const INPUT_TSV = path.join(__dirname, 'dados_reprocessar.tsv');
const OUTPUT_DIR = path.join(__dirname, 'certificados2');

const CONCURRENCY = 3;            // nº de abas simultâneas
const LOGIN_NECESSARIO = false;   // se precisar logar, mude para true
const USE_FOLDERS = false;         // cria pastas por Competicao/Trilha (recomendado p/ 41k arquivos)

const CREDENCIAIS = { usuario: 'SEU_LOGIN', senha: 'SUA_SENHA' };

function sanitizeFilename(name) {
  const base = (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return base || 'sem_nome';
}

function limitLen(s, max) {
  const str = (s || '').toString();
  if (str.length <= max) return str;
  return str.slice(0, max).trim();
}

function safeSegment(value, max = 60) {
  return limitLen(sanitizeFilename(value), max) || 'sem_info';
}

function guid8(guid) {
  const g = (guid || '').toString().replace(/-/g, '');
  return g ? g.slice(0, 8) : 'semguid';
}

function escapeHtml(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
          usuarioId: r.UsuarioId,
          nome: r.NomeUsuario,
          competicao: r.CompeticaoNome,
          trilha: r.TrilhaDescricao,
          guid: r.CertificadoGuid,
          url: r.LinkCertificado,
        });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function loginSeNecessario(page) {
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



  await page.pdf({
    path: outPath,
    printBackground: true,
    format: 'A4',
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
  });
}

async function run() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

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

      const { usuarioId, nome, competicao, trilha, guid, url } = linhas[idx];

      // pastas (recomendado)
      let dir = OUTPUT_DIR;
      if (USE_FOLDERS) {
        const compFolder = safeSegment(competicao || 'Sem competicao', 80);
        const trilhaFolder = safeSegment(trilha || 'Sem trilha', 80);
        dir = path.join(OUTPUT_DIR, compFolder, trilhaFolder);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      }

      // nome do arquivo (único e rastreável)
      const baseName = [
        safeSegment(competicao || 'Sem competicao', 50),
        safeSegment(trilha || 'Sem trilha', 45),
        safeSegment(nome || 'Sem nome', 45),
        `u${usuarioId || '0'}`,
        guid8(guid),
      ].join(' - ');

      let fileName = `${baseName}.pdf`;

      // segurança extra (quase nunca vai bater com guid8 + userId, mas mantém)
      let k = 2;
      while (fs.existsSync(path.join(dir, fileName))) {
        fileName = `${baseName} (${k++}).pdf`;
      }

      const outPath = path.join(dir, fileName);

      // texto dentro do PDF (header)
      const headerText = `${competicao || 'Sem competição'} - ${trilha || 'Sem trilha'} - ${nome || 'Sem nome'}`;

      try {
        const page = await context.newPage();
        await salvarPdf(page, url, outPath, headerText);
        await page.close();
        console.log(`[OK] ${fileName}`);
      } catch (e) {
        console.error(`[ERRO] ${fileName} -> ${e.message}`);
        erros.push({ usuarioId, nome, competicao, trilha, guid, url, arquivo: fileName, erro: e.message });
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
