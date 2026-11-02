# Working from GitHub

Repository: https://github.com/GrayGrayson1/chronicle (public). Player site: https://graygrayson1.github.io/chronicle/

The repository is public so GitHub Pages stays free. It contains no credentials, recordings or campaign data. `.env`, `data/`, `node_modules/` and `.venv/` are ignored, and the published campaign bundle in `site/data/` is encrypted.

## One-time setup (repository owner)

1. Create and push the repository from the folder that holds this file:
   ```bash
   gh repo create GrayGrayson1/chronicle --public --source=. --remote=origin --push
   ```
   Without the GitHub CLI: create an empty public repo named `chronicle` on github.com (no README), then
   `git remote add origin https://github.com/GrayGrayson1/chronicle.git && git push -u origin main`.
2. Turn on Pages: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The "Player site" workflow deploys `site/` on every push to `main` that changes it. Re-run it once from the **Actions** tab after enabling Pages.
3. Invite collaborators: **Settings → Collaborators → Add people**, by GitHub username. They need write access to push code and publish campaign data.

## Host PC (Jace)

```powershell
git clone https://github.com/GrayGrayson1/chronicle.git
cd chronicle
```

Then follow START_HERE.md from "Install the tools". If you already set Chronicle up from the ZIP, copy your existing `.env` and the whole `data` folder into the clone (with Chronicle stopped). Nothing in the repo overwrites them.

Add the `SITE_*` settings from `.env.example` to `.env` (see [PLAYER_SITE.md](PLAYER_SITE.md)), then run `npm ci` and `npm run register` once.

To get updates: stop Chronicle, `git pull`, `npm ci`, start it again. Back up `data` first if a change mentions the database.

## Branches

`main` is what the host runs and what Pages deploys. Larger changes go on a branch and a pull request so the host can test them before game night. Campaign-data commits from the host (`Publish campaign site: …`) only touch `site/data/`.
