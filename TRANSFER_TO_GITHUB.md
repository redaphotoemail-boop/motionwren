# Transfer this complete project to GitHub

This folder is the complete transferable MotionWren project as of October 24, 2026.

It includes all application source code, API routes, UI, database migrations, tests, configuration, documentation, and the current uncommitted fixes.

The following are intentionally excluded because they are generated or machine-specific:

- `node_modules/`
- `dist/`
- `.next/`
- `.sites-runtime/`
- `.wrangler/`
- local build caches and temporary files
- secrets and environment values

## Import into the private GitHub repository

Repository: `https://github.com/redaphotoemail-boop/motionwren`

From another ChatGPT account or a local terminal:

```bash
cd motionwren
npm install
npm test
npm run lint
git status
git add .
git commit -m "Complete current MotionWren platform updates"
git branch -M main
git remote add origin https://github.com/redaphotoemail-boop/motionwren.git
git push -u origin main
```

If the remote already exists, use `git remote set-url origin ...` instead of `git remote add origin ...`.

Review the diff before pushing. Do not commit `.env` files or credentials. The external controlled FFmpeg worker still has to be deployed separately and configured through server-side environment variables.
