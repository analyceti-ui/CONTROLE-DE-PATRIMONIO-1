# Patrimônio — gestão de ativos

Aplicação Next.js para gestão de ativos, responsáveis, manutenção, ordens, inspeções, estoque e compras. O frontend e as APIs podem ser publicados na Vercel. Os registros são armazenados no **PostgreSQL do Supabase** (um documento JSONB por registro); fotos e comprovantes continuam no **Cloudinary**. A conexão PostgreSQL é usada somente no servidor.

## Configuração local

Requer Node.js 22.5 ou mais recente.

1. Crie ou selecione um projeto Supabase e execute uma vez o SQL em [`supabase/migrations/20261125100000_app_records.sql`](./supabase/migrations/20261125100000_app_records.sql) pelo SQL Editor.
2. Em **Connect**, copie a conexão do **Transaction pooler**. Use-a como `SUPABASE_DB_URL`; no pooler Supabase a porta normalmente é `6543`.
3. Crie ou use uma conta Cloudinary.
4. Copie `.env.example` para `.env.local` e informe os valores reais localmente. Não versione `.env.local`, não envie senhas/chaves pelo chat e não use variáveis `NEXT_PUBLIC_` para credenciais.
5. Inicie o Next.js:

```powershell
npm install
npm run dev
```

Variáveis obrigatórias do servidor:

- `SUPABASE_DB_URL` (string do pooler Supabase, com TLS)
- `SUPABASE_DB_SSL_CERT` (opcional; certificado raiz baixado em Database Settings > SSL configuration para validar a identidade TLS do servidor)
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Na primeira autenticação, o app cria o administrador inicial se o endereço enviado corresponder a `BOOTSTRAP_ADMIN_EMAIL`. Configure também `BOOTSTRAP_ADMIN_PASSWORD` (mínimo de 8 caracteres), `BOOTSTRAP_ORGANIZATION_ID` e `BOOTSTRAP_ORGANIZATION_NAME`. Proteja e remova a senha inicial depois de entrar. O cadastro público continua desativado; administradores criam as demais contas. Se a conexão Supabase ou as credenciais Cloudinary estiverem ausentes, as APIs retornam um erro de configuração explícito e não simulam sucesso.

## Migração do SQLite local

O utilitário abaixo lê somente o arquivo SQLite informado; **não lê nem migra dados do Firebase/Firestore**. A simulação padrão não grava nada. Revise cuidadosamente se o arquivo contém os dados que devem ir para o Supabase:

```powershell
npm run migrate:supabase
```

Depois de conferir a origem e o projeto Supabase de destino, configure `SUPABASE_DB_URL` e as variáveis Cloudinary no `.env.local`, pare o servidor local e execute explicitamente com `--apply`:

```powershell
npm run migrate:supabase -- --apply
```

Ou informe outro arquivo:

```powershell
npm run migrate:supabase -- "C:\caminho\para\patrimonio.sqlite"
npm run migrate:supabase -- "C:\caminho\para\patrimonio.sqlite" --apply
```

O comando `--apply` cria a tabela base se necessário e se recusa a inserir dados quando o destino já tem registros. `--overwrite` permite atualizar somente IDs coincidentes e requer `--apply`; não apaga os demais dados. Fotos SQLite são transferidas ao Cloudinary. Preserve uma cópia offline do arquivo original e valide usuários, ativos, histórico e imagens antes de mudar a produção. Dados atuais do Firebase precisam de um plano de exportação/migração separado; não aponte o app para produção durante testes.

## Publicação na Vercel

1. Importe este repositório como um projeto Next.js na Vercel.
2. Cadastre `SUPABASE_DB_URL`, opcionalmente `SUPABASE_DB_SSL_CERT`, as variáveis Cloudinary e as variáveis bootstrap do primeiro administrador nas configurações de Environment Variables da Vercel para cada ambiente necessário. Baixe o certificado raiz em Supabase **Database Settings > SSL configuration** para validar a identidade TLS. A string do banco contém senha: mantenha-a apenas nas configurações secretas do servidor, nunca no navegador nem no repositório.
3. Execute a migração do schema e confirme que a função Vercel consegue conectar ao pooler Supabase.
4. Publique. Todas as APIs usam runtime Node.js; nenhum banco ou arquivo persistente é criado no filesystem da função.

Fotos são carregadas ao Cloudinary com acesso autenticado. As rotas preservam os caminhos da API já usados pelo app, verificam sessão, organização e acesso ao ativo e só então entregam a imagem. Cada foto pode ter até 3,5 MB para permanecer abaixo do limite de payload de funções serverless da Vercel.

## Backup e restauração

Os endpoints de backup SQLite e a restauração local pelo painel foram desativados. Use as ferramentas de backup do Supabase e do Cloudinary. Os dados não são persistidos no disco temporário da Vercel.

## Recursos e verificações

- **Visão geral** — indicadores, avisos de manutenção e garantias.
- **Ativos** — cadastro detalhado, responsável, unidade, ficha e QR Code.
- **Preventivas**, **Ordens**, **Inspeções**, **Estoque**, **Compras** e **Relatórios**.
- **Usuários**, **Auditoria** e configurações administrativas.
- **Auditoria e frota** — além do histórico de ações, administradores podem filtrar abastecimentos por período, ativo, responsável e combustível; conferir gastos pagos, custos de ordens concluídas, localização, unidade, situação e responsáveis dos ativos; e exportar as listas em CSV. O relatório de combustível reflete os valores pagos registrados. Como litros ainda não são coletados, não calcula preço por litro nem consumo médio.
- Administradores podem definir, por usuário e por tela, **Sem acesso**, **Somente visualizar** ou **Visualizar e editar**. Essas permissões são verificadas nas APIs, não apenas na navegação; usuários e auditoria e as configurações administrativas continuam restritos a administradores.
- As APIs verificam a organização e, para usuários comuns, restringem dados aos ativos vinculados ao usuário.

```powershell
npm run typecheck
npm run lint
npm run build
```
