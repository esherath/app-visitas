# Trinit Visitas

App para vendedores de campo registrarem visitas com GPS, suporte offline e sincronizacao com GHL.

## Stack

- `mobile`: Expo + React Native + TypeScript + SQLite + SecureStore + react-native-maps
- `api`: Next.js + TypeScript + Prisma + PostgreSQL + JWT
- Integracao externa: GHL API (notes no contato)

## Features implementadas

- Registro de visita com captura de localizacao.
- Fila offline local (`PENDING`, `FAILED`, `SYNCED`) em SQLite.
- Sync automatico quando a rede volta e sync manual por botao.
- Sincronizacao de contatos do GHL para base local.
- Cache local de contatos GHL para uso offline no app.
- Busca de contatos por nome/email/telefone no app (sem listar tudo de uma vez).
- Autenticacao JWT (`register/login/me`) com token no SecureStore.
- Rotas protegidas por token no backend.
- Historico com filtro de periodo (hoje, 7/15/30 dias e customizado).
- Tela de mapa com pontos das visitas no periodo filtrado.
- Configuracao de build Android com EAS (`preview` e `production`).

## Estrutura

- `mobile/`: app Android
- `api/`: API (persistencia + integracao GHL)

## Setup rapido

### 1) Banco

```bash
docker compose up -d
```

### 2) API

```bash
cd api
npm install
cp .env.example .env
npx prisma migrate dev
npm run prisma:seed
npm run dev
```

Credenciais de seed:
- email: `seller-demo-1@placeholder.local`
- senha: `123456`
- email: `master-demo-1@placeholder.local`
- senha: `123456`

### 3) Mobile

```bash
cd mobile
npm install
npm run start
```

Para emulador Android, `apiBaseUrl` padrao: `http://10.0.2.2:4000`.

## Variaveis de ambiente (API)

- `DATABASE_URL`
- `JWT_SECRET`
- `GHL_API_BASE_URL`
- `GHL_LOCATION_ID`
- `GHL_ACCESS_TOKEN`
- `GHL_CONTACT_SYNC_MAX_PAGES` (default `200`, com `limit=100` por pagina => ~20k)

## Endpoints principais

Autenticacao:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

Negocio (todos com `Authorization: Bearer <token>`):
- `POST /api/ghl/sync` (sincroniza contatos do GHL)
- `GET /api/ghl/contacts` (lista contatos sincronizados para o app)
- `POST /api/sync`
- `GET /api/visits?limit=30`
- `POST /api/visits`
- `GET /api/clients`
- `POST /api/clients`
- `PUT /api/clients`

## Build/release Android (EAS)

```bash
cd mobile
npm run build:android:preview
npm run build:android:production
```

Arquivo de configuracao: `mobile/eas.json`.

## Deploy producao (resumo pratico)

Arquitetura sugerida:
- API Next.js em um host publico (Railway/Render/Fly/VPS).
- PostgreSQL gerenciado (Neon/Supabase/Railway Postgres).
- App Android via EAS Build (AAB) com `EXPO_PUBLIC_API_BASE_URL` apontando para a API publica.

### API (producao)

1. Configure variaveis no host:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `GHL_API_BASE_URL`
   - `GHL_LOCATION_ID`
   - `GHL_ACCESS_TOKEN`
   - `GHL_CONTACT_SYNC_MAX_PAGES`
2. Build/start:
   - `npm install`
   - `npm run build`
   - `npm run prisma:migrate:deploy`
   - `npm run start:render`
3. Health check:
   - `GET /` deve responder `trinit visitas api is running`.

### Mobile (producao)

1. Defina URL publica da API no EAS:
   - `eas secret:create --scope project --name EXPO_PUBLIC_API_BASE_URL --value https://sua-api.com`
2. Gere AAB de producao:
   - `npm run build:android:production`
3. Publique no Google Play via EAS Submit (opcional):
   - `eas submit -p android --profile production`

## Observacoes

- GPS pode funcionar sem internet, mas com precisao variavel.
- Em modo offline, o app salva normalmente e sincroniza depois.
- O mapa exibe a ultima coordenada registrada; disponibilidade de tiles depende do dispositivo/rede.
- Para contatos aparecerem no app, rode sync GHL na aba `CONFIG`.
