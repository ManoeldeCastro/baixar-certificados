// baixar-certificados.js
// Node 18+ recomendado
//
// TSV esperado (dados.tsv): colunas separadas por TAB
//   NomeUsuario    LinkCertificado    Treinamento (opcional)
// Se Treinamento existir (ex.: LGPD, IA, SI), os PDFs vão em subpastas certificados/LGPD/, etc.
// Use consultar-certificados-tothbe.sql para gerar o TSV a partir do banco.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const puppeteer = require('puppeteer');

const INPUT_TSV = path.join(__dirname, 'dados.tsv');
const OUTPUT_DIR = path.join(__dirname, 'certificados');
const CONCURRENCY = 2;            // nº de abas simultâneas
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
          url: r.LinkCertificado,
          treinamento: r.Treinamento || null  // opcional: LGPD, IA, SI, etc. → salva em subpasta
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
  // Configura viewport para landscape (paisagem) - igual ao backend
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Navega para a URL e espera todos os recursos carregarem
  await page.goto(url, { 
    waitUntil: 'networkidle0', 
    timeout: 120000 
  });
  
  // Espera por TODOS os recursos críticos carregarem completamente
  await page.evaluate(async () => {
    // 1. Espera todas as fontes carregarem (CRÍTICO para layout correto)
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    
    // 2. Espera todas as imagens carregarem
    const images = Array.from(document.images);
    if (images.length > 0) {
      await Promise.all(
        images.map(img => {
          if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
          return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(), 10000);
            const onLoad = () => {
              clearTimeout(timeout);
              img.removeEventListener('load', onLoad);
              img.removeEventListener('error', onError);
              resolve();
            };
            const onError = () => {
              clearTimeout(timeout);
              img.removeEventListener('load', onLoad);
              img.removeEventListener('error', onError);
              resolve();
            };
            img.addEventListener('load', onLoad);
            img.addEventListener('error', onError);
          });
        })
      );
    }
    
    // 3. Espera CSS ser aplicado completamente
    // Força reflow para garantir que CSS foi aplicado
    document.body.offsetHeight;
    
    // 4. Espera um ciclo de renderização completo
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
    
    // 5. Espera adicional para garantir que layout está estável
    // Verifica se não há mudanças no layout por 3 verificações consecutivas
    let stableCount = 0;
    let lastHeight = document.body.scrollHeight;
    let lastWidth = document.body.scrollWidth;
    
    await new Promise((resolve) => {
      const checkStability = () => {
        const currentHeight = document.body.scrollHeight;
        const currentWidth = document.body.scrollWidth;
        
        if (currentHeight === lastHeight && currentWidth === lastWidth) {
          stableCount++;
          if (stableCount >= 3) {
            resolve();
            return;
          }
        } else {
          stableCount = 0;
          lastHeight = currentHeight;
          lastWidth = currentWidth;
        }
        
        setTimeout(checkStability, 200);
      };
      
      setTimeout(checkStability, 500);
      setTimeout(resolve, 10000); // Timeout máximo de 10s
    });
  });
  
  // Espera final para garantir renderização completa
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Gera PDF em formato Landscape (paisagem) - igual ao backend
  await page.pdf({
    path: outPath,
    printBackground: true,
    landscape: true,
    format: 'A4',
    preferCSSPageSize: false,
    margin: {
      top: '0px',
      right: '0px',
      bottom: '0px',
      left: '0px'
    }
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

  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: [
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
      '--no-sandbox'
    ]
  });
  const context = await browser.createBrowserContext();

  if (LOGIN_NECESSARIO) {
    const p0 = await context.newPage();
    await loginSeNecessario(p0);
    await p0.close();
  }

  const erros = [];
  let i = 0;
  let sucessos = 0;
  const inicio = Date.now();

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= linhas.length) break;

      const { nome, url, treinamento } = linhas[idx];
      const baseName = sanitizeFilename(nome);
      const subDir = treinamento ? sanitizeFilename(treinamento) : '';
      const dir = subDir ? path.join(OUTPUT_DIR, subDir) : OUTPUT_DIR;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let fileName = `${baseName}.pdf`;
      let k = 2;
      while (fs.existsSync(path.join(dir, fileName))) {
        fileName = `${baseName} (${k++}).pdf`;
      }
      const outPath = path.join(dir, fileName);

      try {
        const page = await context.newPage();
        await salvarPdf(page, url, outPath);
        await page.close();
        sucessos++;
        
        // Calcula estatísticas de progresso
        const progresso = ((idx + 1) / linhas.length * 100).toFixed(1);
        const tempoDecorrido = (Date.now() - inicio) / 1000; // em segundos
        const minutosDecorridos = (tempoDecorrido / 60).toFixed(1);
        const velocidade = tempoDecorrido > 0 ? (sucessos / (tempoDecorrido / 60)) : 0; // por minuto
        const tempoRestante = velocidade > 0 ? ((linhas.length - idx - 1) / velocidade).toFixed(0) : 'calculando...';
        const segundosPorCertificado = tempoDecorrido > 0 ? (tempoDecorrido / sucessos).toFixed(1) : '0';
        
        const pathRel = subDir ? `${subDir}/${fileName}` : fileName;
        console.log(`[${idx + 1}/${linhas.length}] (${progresso}%) ✅ ${pathRel}`);
        console.log(`   ⏱️  Tempo decorrido: ${minutosDecorridos} min | 🚀 Velocidade: ${velocidade.toFixed(1)} cert/min | ⏳ Tempo restante: ~${tempoRestante} min | 📊 ${segundosPorCertificado}s por certificado`);
      } catch (e) {
        const pathRel = subDir ? `${subDir}/${fileName}` : fileName;
        console.error(`[${idx + 1}/${linhas.length}] ❌ ERRO: ${pathRel}`);
        console.error(`   Erro: ${e.message}`);
        erros.push({ nome, url, treinamento: treinamento || null, arquivo: pathRel, erro: e.message });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await browser.close();

  const tempoTotal = ((Date.now() - inicio) / 1000 / 60).toFixed(1);
  const horas = Math.floor(parseFloat(tempoTotal) / 60);
  const minutos = (parseFloat(tempoTotal) % 60).toFixed(0);
  const velocidadeMedia = tempoTotal > 0 ? (sucessos / parseFloat(tempoTotal)).toFixed(1) : '0';
  const tempoMedioPorCertificado = sucessos > 0 ? ((Date.now() - inicio) / 1000 / sucessos).toFixed(1) : '0';
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 ESTATÍSTICAS FINAIS');
  console.log('='.repeat(60));
  
  if (erros.length) {
    fs.writeFileSync(path.join(__dirname, 'erros_download.json'), JSON.stringify(erros, null, 2));
    console.log(`✅ Sucessos: ${sucessos} de ${linhas.length} (${((sucessos/linhas.length)*100).toFixed(1)}%)`);
    console.log(`❌ Erros: ${erros.length} de ${linhas.length} (${((erros.length/linhas.length)*100).toFixed(1)}%)`);
    console.log(`📄 Arquivo de erros: erros_download.json`);
  } else {
    console.log(`✅ Concluído sem erros! ${sucessos} certificados baixados com sucesso.`);
  }
  
  console.log('\n⏱️  TEMPO:');
  if (horas > 0) {
    console.log(`   Total: ${horas}h ${minutos}min (${tempoTotal} minutos)`);
  } else {
    console.log(`   Total: ${tempoTotal} minutos`);
  }
  console.log(`   Média por certificado: ${tempoMedioPorCertificado} segundos`);
  
  console.log('\n🚀 VELOCIDADE:');
  console.log(`   Média: ${velocidadeMedia} certificados/minuto`);
  if (velocidadeMedia > 0) {
    const certificadosPorHora = (parseFloat(velocidadeMedia) * 60).toFixed(0);
    console.log(`   Equivalente a: ~${certificadosPorHora} certificados/hora`);
  }
  
  console.log('\n📁 LOCALIZAÇÃO:');
  console.log(`   ${OUTPUT_DIR}`);
  console.log('='.repeat(60));
}

run().catch(err => {
  console.error('Falha geral:', err);
  process.exit(1);
});
