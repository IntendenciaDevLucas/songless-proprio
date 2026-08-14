# Songless

Jogo musical local para dois jogadores usando suas playlists e a reprodução oficial do Spotify.

## Configuração

1. Crie um app no [Spotify for Developers](https://developer.spotify.com/dashboard).
2. Em **Redirect URIs**, adicione exatamente `http://127.0.0.1:5173/`.
3. Copie `.env.example` para `.env` e informe o Client ID do app.
4. Instale e rode:

```bash
npm install
npm run dev
```

Abra `http://127.0.0.1:5173/` (não use `localhost`, pois o Spotify não o aceita como redirect local).

## Como jogar

- Escolha os nomes, uma playlist e a quantidade de rodadas.
- Clique em **Tocar música**.
- Jogador 1 aperta `A`; Jogador 2 aperta `L`.
- Cada jogador tem uma tentativa por rodada e digita a resposta livremente.
- Acertar o nome da música vale até 1.000 pontos, proporcionalmente ao tempo restante.
- Acertar somente o artista ou banda vale metade dos pontos proporcionais.
- A comparação ignora acentos, maiúsculas e sufixos comuns como “feat.” e “ao vivo”.

O Web Playback SDK exige Spotify Premium. A aplicação usa OAuth com PKCE e não armazena senha nem Client Secret.

## Salas online com Supabase

1. Crie um projeto gratuito em [supabase.com](https://supabase.com).
2. No painel do projeto, abra **Connect** (ou **Project Settings → API**).
3. Copie a **Project URL** e a chave pública **anon/publishable**.
4. Acrescente ao arquivo `.env`:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_publica
```

5. Reinicie `npm run dev` depois de alterar o `.env`.

O modo online usa apenas canais públicos temporários do Supabase Realtime; não precisa criar tabelas nem executar SQL. O anfitrião escolhe uma capacidade entre 2 e 10 pessoas, conecta o Spotify, cria a sala e envia o código ou link aos demais jogadores. Cada participante responde pelo próprio dispositivo. Nunca coloque a chave `service_role` no `.env` do site.

## Publicação no GitHub Pages

O workflow `.github/workflows/deploy-pages.yml` publica automaticamente cada envio para a branch `main`.

No repositório do GitHub:

1. Acesse **Settings → Pages** e escolha **GitHub Actions** em *Source*.
2. Acesse **Settings → Secrets and variables → Actions**.
3. Crie os quatro secrets: `VITE_SPOTIFY_CLIENT_ID`, `VITE_SPOTIFY_REDIRECT_URI`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. Use como redirect a URL final completa do Pages, por exemplo `https://usuario.github.io/songless/`.
5. Cadastre exatamente a mesma URL em **Redirect URIs** no aplicativo do Spotify.

As variáveis que começam com `VITE_` ficam públicas no navegador. Use somente a chave pública `anon/publishable` do Supabase — nunca a chave `service_role`.
