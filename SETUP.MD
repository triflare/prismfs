# Mint Setup

Setting up Mint after copying it as a template is easy! All you need to do is:

## 1. Install dependencies

```bash
pnpm install # we prefer pnpm because it's faster
```

## 2. Initialize your project

```bash
npm run init
```

This scaffolds `src/` from a template and sets your extension ID/name metadata. Answer the questions that the Mint setup CLI asks you, and your project scaffold will be there in a snap.

## 3. Build and test

```bash
npm run build
npm run test
```

> Later, when you edit `src/`, you'll have to code in test support.

## 4. Keep Mint in sync later

```bash
npm run update:mint # you can also pass --dry-run
```

## 5. Start Coding!

You're done with initial setup -- you can now start coding your extension, and Mint will keep up with you as you do!
