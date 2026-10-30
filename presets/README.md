# Presets da comunidade

Os presets desta pasta aparecem no estúdio em **Configurações › Presets › Presets da comunidade**.

## Como compartilhar o seu

1. No estúdio, abra **Configurações › Presets**, selecione o preset e clique em **Exportar preset**.
   - Ligue **Incluir meu sistema de edição** para levar junto o `CLAUDE.md`, o `Modelo edicao` e as skills de vídeo do Claude.
   - **Incluir músicas e recursos** leva a pasta `Recursos` (o arquivo fica bem maior).
2. Mande o arquivo `.pqpreset` para quem quiser: a pessoa usa **Importar arquivo** ou **Importar de link**.
3. Para publicar aqui, abra um pull request adicionando o arquivo nesta pasta e uma entrada em `index.json`:

```json
{
  "id": "meu-preset",
  "name": "Meu preset",
  "author": "Seu nome",
  "format": "9:16",
  "description": "Uma linha sobre o resultado.",
  "file": "meu-preset.pqpreset",
  "hasWorkflow": false
}
```

## Formato

Um `.pqpreset` é um JSON (opcionalmente compactado com gzip):

```json
{
  "kind": "pqueiroz-preset",
  "version": 1,
  "name": "Meu preset",
  "author": "Seu nome",
  "format": "9:16",
  "description": "…",
  "prompt": "Instruções para o Claude…",
  "createdAt": 0,
  "workflow": { "files": [{ "path": "CLAUDE.md", "encoding": "utf8", "content": "…" }] }
}
```

`workflow` é opcional. Os arquivos são instalados numa pasta do app (nunca fora dela) e as skills em
`.claude/skills/` também são copiadas para `~/.claude/skills` — skills que já existem não são sobrescritas.
Não publique presets com dados pessoais ou de clientes.
