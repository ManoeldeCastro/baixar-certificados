-- =============================================================================
-- Consulta certificados TothBe - 5 treinamentos
-- Cliente: tothbe
-- Exporte o resultado como TSV (tab como separador) com as colunas:
--   NomeUsuario, LinkCertificado, Treinamento
-- e use o arquivo como dados.tsv para o script baixar-certificados.js
-- =============================================================================
-- Treinamentos:
--   LGPD:              Ambiente 19012 / Trilha 66022
--   IA:                Ambiente 21106 / Trilha 76169
--   SI:                Ambiente 12131 / Trilha 37020
--   Engenharia Social: Ambiente 19970 / Trilha 70187
--   Anticorrupção:     Ambiente 19412 / Trilha 67837
-- =============================================================================

SELECT
    u.tx_nome_completo AS NomeUsuario,
    'https://tothbe.engage.bz/#/certificates/' + CAST(uc.tx_guid AS VARCHAR(36)) AS LinkCertificado,
    CASE
        WHEN uc.id_competicao = 19012 AND uc.id_trilha = 66022 THEN 'LGPD'
        WHEN uc.id_competicao = 21106 AND uc.id_trilha = 76169 THEN 'IA'
        WHEN uc.id_competicao = 12131 AND uc.id_trilha = 37020 THEN 'SI'
        WHEN uc.id_competicao = 19970 AND uc.id_trilha = 70187 THEN 'Engenharia Social'
        WHEN uc.id_competicao = 19412 AND uc.id_trilha = 67837 THEN 'Anticorrupcao'
        ELSE 'Outro'
    END AS Treinamento
FROM usuario_certificado uc
INNER JOIN usuario u
    ON u.id = uc.id_usuario
    AND u.id_cliente = uc.id_cliente
WHERE uc.id_cliente = 'tothbe'
  AND uc.id_status = 1
  AND (
      (uc.id_competicao = 19012 AND uc.id_trilha = 66022)   -- LGPD
      OR (uc.id_competicao = 21106 AND uc.id_trilha = 76169) -- IA
      OR (uc.id_competicao = 12131 AND uc.id_trilha = 37020) -- SI
      OR (uc.id_competicao = 19970 AND uc.id_trilha = 70187) -- Engenharia Social
      OR (uc.id_competicao = 19412 AND uc.id_trilha = 67837) -- Anticorrupção
  )
ORDER BY Treinamento, u.tx_nome_completo;


-- =============================================================================
-- Quantidade de certificados por treinamento (rode para conferir totais)
-- =============================================================================

SELECT
    CASE
        WHEN uc.id_competicao = 19012 AND uc.id_trilha = 66022 THEN 'LGPD'
        WHEN uc.id_competicao = 21106 AND uc.id_trilha = 76169 THEN 'IA'
        WHEN uc.id_competicao = 12131 AND uc.id_trilha = 37020 THEN 'SI'
        WHEN uc.id_competicao = 19970 AND uc.id_trilha = 70187 THEN 'Engenharia Social'
        WHEN uc.id_competicao = 19412 AND uc.id_trilha = 67837 THEN 'Anticorrupcao'
        ELSE 'Outro'
    END AS Treinamento,
    COUNT(1) AS Quantidade
FROM usuario_certificado uc
WHERE uc.id_cliente = 'tothbe'
  AND uc.id_status = 1
  AND (
      (uc.id_competicao = 19012 AND uc.id_trilha = 66022)
      OR (uc.id_competicao = 21106 AND uc.id_trilha = 76169)
      OR (uc.id_competicao = 12131 AND uc.id_trilha = 37020)
      OR (uc.id_competicao = 19970 AND uc.id_trilha = 70187)
      OR (uc.id_competicao = 19412 AND uc.id_trilha = 67837)
  )
GROUP BY
    CASE
        WHEN uc.id_competicao = 19012 AND uc.id_trilha = 66022 THEN 'LGPD'
        WHEN uc.id_competicao = 21106 AND uc.id_trilha = 76169 THEN 'IA'
        WHEN uc.id_competicao = 12131 AND uc.id_trilha = 37020 THEN 'SI'
        WHEN uc.id_competicao = 19970 AND uc.id_trilha = 70187 THEN 'Engenharia Social'
        WHEN uc.id_competicao = 19412 AND uc.id_trilha = 67837 THEN 'Anticorrupcao'
        ELSE 'Outro'
    END
ORDER BY Treinamento;
