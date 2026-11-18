# Patrimônio — gestão de ativos

Aplicação Next.js para gestão de ativos, responsáveis, manutenção, ordens, inspeções, estoque e compras. O frontend e as APIs podem ser publicados na Vercel. Registros relacionais são armazenados em coleções do **Firebase Cloud Firestore**; fotos e comprovantes são armazenados no **Cloudinary**. O app usa Firebase Admin somente no servidor e não inicializa Firebase Analytics.

## Configuração local

Requer Node.js 22.5 ou mais recente.

1. Crie um projeto no Firebase, habilite o **Cloud Firestore** em modo nativo e crie uma conta de serviço com acesso ao Firestore.
2. Crie uma conta Cloudinary.
3. Copie `.env.example` para `.env.local` e informe os valores reais localmente. Não versione `.env.local`, não envie chaves privadas ao navegador e não use variáveis `NEXT_PUBLIC_` para credenciais.
4. Inicie o Next.js:

```powershell
npm install
npm run dev
```

Variáveis obrigatórias do servidor:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (chave da conta de serviço; pode ser armazenada com `\n` escapados)
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Na primeira autenticação, o app cria o administrador inicial se o endereço enviado corresponder a `BOOTSTRAP_ADMIN_EMAIL`. Configure também `BOOTSTRAP_ADMIN_PASSWORD` (mínimo de 8 caracteres), `BOOTSTRAP_ORGANIZATION_ID` e `BOOTSTRAP_ORGANIZATION_NAME`. Proteja e remova a senha inicial depois de entrar. O cadastro público continua desativado; administradores criam as demais contas. Se as credenciais de Firebase ou Cloudinary estiverem ausentes, as APIs retornam um erro de configuração explícito e não simulam sucesso.

## Migração do SQLite local existente

Antes de publicar, faça uma migração única do banco local, preservando IDs, hashes de senha, dados e sessões e transferindo os BLOBs de imagem ao Cloudinary. Configure as variáveis Firebase/Cloudinary no `.env.local`, pare o servidor local e execute na máquina onde está o arquivo SQLite:

```powershell
npm run migrate:cloud
```

Ou informe outro arquivo:

```powershell
npm run migrate:cloud -- "C:\caminho\para\patrimonio.sqlite"
```

O utilitário se recusa a executar se encontrar coleções já preenchidas, para evitar sobrescrever dados de nuvem acidentalmente. `--overwrite` permite atualizar IDs existentes; use-o somente após validar o projeto de destino. Preserve uma cópia offline do arquivo SQLite original até conferir os dados migrados. O app em produção não lê nem grava esse arquivo.

## Publicação na Vercel

1. Importe este repositório como um projeto Next.js na Vercel.
2. Cadastre as variáveis Firebase Admin, Cloudinary e bootstrap do primeiro administrador nas configurações de Environment Variables da Vercel para cada ambiente necessário. Use a chave privada completa; nunca a coloque no repositório.
3. Confirme que o Firestore está habilitado e que a conta de serviço usada pelo Admin SDK pode ler e gravar dados.
4. Publique. Todas as APIs usam runtime Node.js; nenhum banco ou arquivo persistente é criado no filesystem da função.

Fotos são carregadas ao Cloudinary com acesso autenticado. As rotas preservam os caminhos da API já usados pelo app, verificam sessão, organização e acesso ao ativo e só então entregam a imagem. Cada foto pode ter até 3,5 MB para permanecer abaixo do limite de payload de funções serverless da Vercel.

## Backup e restauração

Os endpoints de backup SQLite e a restauração local pelo painel foram desativados. Backups e restaurações devem ser feitos com as ferramentas do Firebase Cloud Firestore e do Cloudinary. Os dados não são persistidos no disco temporário da Vercel.

## Recursos e verificações

- **Visão geral** — indicadores, avisos de manutenção e garantias.
- **Ativos** — cadastro detalhado, responsável, unidade, ficha e QR Code.
- **Preventivas**, **Ordens**, **Inspeções**, **Estoque**, **Compras** e **Relatórios**.
- **Usuários**, **Auditoria** e configurações administrativas.
- As APIs verificam a organização e, para usuários comuns, restringem dados aos ativos vinculados ao usuário.

```powershell
npm run typecheck
npm run lint
npm run build
```
