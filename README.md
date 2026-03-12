# Baixar certificados (TothBe)

Script para baixar em lote os certificados dos treinamentos do cliente TothBe, a partir de um TSV gerado pela consulta SQL.

## Treinamentos (ambiente = competição)

| Treinamento        | Ambiente | Trilha |
|--------------------|----------|--------|
| LGPD               | 19012    | 66022  |
| IA                 | 21106    | 76169  |
| SI                 | 12131    | 37020  |
| Engenharia Social  | 19970    | 70187  |
| Anticorrupção      | 19412    | 67837  |

## Passo a passo

### 1. Gerar o arquivo de dados (TSV)

1. Abra o script **`consultar-certificados-tothbe.sql`** no SQL Server Management Studio (ou cliente que acesse o banco).
2. Execute a consulta.
3. Exporte o resultado como arquivo de texto com:
   - **Separador:** Tab (TAB)
   - **Colunas:** NomeUsuario, LinkCertificado, Treinamento
4. Salve como **`dados.tsv`** na pasta do projeto (substituindo o existente se houver).

Se o seu cliente de banco não exportar TSV diretamente, exporte para CSV com tab como delimitador ou use “Copy with headers” e cole em um editor, depois salve com extensão `.tsv`.

### 2. Instalar dependências e rodar o download

```bash
npm install
node baixar-certificados.js
```

Os PDFs serão gravados na pasta **`certificados`**.  
Se o TSV tiver a coluna **Treinamento**, cada tipo de treinamento terá sua subpasta (ex.: `certificados/LGPD/`, `certificados/IA/`).

## Formato do TSV esperado

O script espera um TSV com **cabeçalho** e as colunas:

| Coluna          | Obrigatório | Descrição |
|-----------------|-------------|-----------|
| NomeUsuario     | Sim         | Nome do colaborador (usado no nome do arquivo PDF). |
| LinkCertificado | Sim         | URL do certificado, ex.: `https://tothbe.engage.bz/#/certificates/{GUID}`. |
| Treinamento     | Não         | Nome do treinamento (ex.: LGPD, IA). Se existir, os PDFs são salvos em subpastas por treinamento. |

A consulta em **`consultar-certificados-tothbe.sql`** já retorna os dados nesse formato para os 5 treinamentos listados acima.

## Configuração opcional

- **`CONCURRENCY`** (no script): número de abas simultâneas no navegador (padrão: 2).
- **`LOGIN_NECESSARIO`**: defina `true` se for preciso fazer login na plataforma antes de acessar as URLs dos certificados e ajuste **`CREDENCIAIS`** e o fluxo em **`loginSeNecessario`** conforme o ambiente.