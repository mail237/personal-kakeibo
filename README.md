This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## GAS をターミナルから更新（自動化）

`gas/Code.gs` を Apps Script に反映し、必要ならデプロイまでターミナルから行えます（初回のみログインが必要）。

### 1) 初回セットアップ

- Apps Script のプロジェクトID（scriptId）を用意
- Google にログイン（初回のみ）

```bash
npx clasp login
```

### 2) 環境変数を設定

```bash
export GAS_SCRIPT_ID="（Apps Script の scriptId）"

# 既存の WebアプリURL を変えたくない場合（推奨）
# すでに Webアプリとしてデプロイ済みなら、その deploymentId を設定
export GAS_DEPLOYMENT_ID="（任意）"
```

### 3) 実行

- コード反映だけ:

```bash
npm run gas:push
```

- コード反映 + デプロイ:

```bash
npm run gas:deploy
```

`GAS_DEPLOYMENT_ID` を指定すると **同じデプロイ先** を更新できます（URL を固定しやすいです）。

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
