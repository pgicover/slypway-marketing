# Connecting to the Slypway marketing repo

This guide is for Andrew, and for any Claude session Andrew hands it to. It covers securing the GitHub account, accepting the invite, cloning the repo, running the site locally, and pushing changes so they deploy to slypway.com automatically.

Repo: https://github.com/pgicover/slypway-marketing
Live site: https://slypway.com
Hosting: Cloudflare Pages project slypway-marketing on Craig's Cloudflare account
Owner of the repo: Craig (GitHub user pgicover)
Your access: write collaborator (GitHub user terrassuremga)

## 1. Secure the GitHub account first

Do this before pushing anything. Pushes to main go live on slypway.com, so the account that can push needs to be locked down. The terrassuremga account previously showed signs of having been taken over (dozens of spam repos appeared on it), so treat this as required, not optional.

1. Sign in at https://github.com/login as terrassuremga.
2. Change the password: Settings, Password and authentication, Change password. Use a long unique password stored in a password manager.
3. Turn on two-factor authentication: Settings, Password and authentication, Two-factor authentication, Enable. Choose an authenticator app (1Password, Google Authenticator, Authy). SMS is a fallback only.
4. Save the recovery codes GitHub shows you somewhere safe. Without them a lost phone locks you out.
5. Review Settings, Applications, Authorized OAuth Apps and GitHub Apps. Revoke anything you do not recognise.
6. Review Settings, SSH and GPG keys and Settings, Developer settings, Personal access tokens. Delete any key or token you did not create.
7. Check Settings, Emails and confirm only your addresses are listed.

If Claude is helping, it can walk through these screens with you but cannot do them for you.

## 2. Accept the invite

Craig has invited terrassuremga as a write collaborator. Accept it either from the email GitHub sent to terrassuremga@gmail.com or at:

https://github.com/pgicover/slypway-marketing/invitations

After accepting you can clone, push branches, and push to main.

## 3. Set up Git on your machine

Check whether Git and the GitHub command line tool are installed:

```
git --version
gh --version
```

If gh is missing, install it (on a Mac: `brew install gh`). Then sign in:

```
gh auth login
```

Pick GitHub.com, HTTPS, and sign in through the browser. This lets git push without typing a password each time.

Tell Git who you are:

```
git config --global user.name "Andrew"
git config --global user.email "terrassuremga@gmail.com"
```

## 4. Clone the repo

```
cd ~/Projects
git clone https://github.com/pgicover/slypway-marketing.git
cd slypway-marketing
```

Install the Cloudflare tooling the local dev server needs:

```
npm install
```

## 5. What is in the repo

- `index.html` is the whole coming-soon page. Copy, layout, and styles are in this one file.
- `assets/` holds the hero video (hero.mp4), its poster image, and any other static files.
- `functions/api/signup.js` is the serverless function that receives the email signup form and writes it to the D1 database.
- `schema.sql` defines the signups table.
- `wrangler.toml` tells Cloudflare which D1 database to bind. Do not change the database id in it.
- `archive/` holds the previous three-page site for reference. It is not served.
- `video/` holds the original source video. Do not add more large files here; keep the repo small.

## 6. Run the site locally

```
npx wrangler pages dev . --port 3010
```

Open http://localhost:3010. The first time, create the local signups table so the form works locally:

```
npx wrangler d1 execute slypway-marketing-signups --local --file=./schema.sql
```

Local signups go into a throwaway local database. Production data is never touched by local dev.

Stop the server with Ctrl+C when you are done.

## 7. Make a change

Always work on a branch, then open a pull request. Pushing straight to main deploys to slypway.com immediately, so a branch gives both of us a chance to look first.

```
git checkout main
git pull
git checkout -b andrew/short-description
```

Edit the files, check the result at http://localhost:3010, then add one line to the top of the Entries list in `CHANGELOG.md` describing what you changed and why, dated today with your name. Every change gets an entry, in the same commit. Then:

```
git add index.html CHANGELOG.md
git commit -m "Describe what changed"
git push -u origin andrew/short-description
gh pr create --fill
```

Add only the files you meant to change. Never run `git add -A` or `git add .` blindly, and never commit files containing passwords, API keys, or tokens.

Cloudflare builds every pull request and posts a preview link on it. Check the preview, then merge on GitHub. Merging to main deploys to slypway.com within a minute or two.

If it is a small copy fix and Craig has said it is fine, you can commit directly on main:

```
git checkout main
git pull
git add index.html CHANGELOG.md
git commit -m "Fix wording in hero"
git push
```

A commit without a CHANGELOG.md entry is incomplete. Craig reads the changelog to see what changed without digging through diffs.

## 8. Keep in sync with Craig

Before starting work each time:

```
git checkout main
git pull
```

If a push is rejected because main moved, pull first, resolve any conflict, then push again. Do not force push to main.

## 9. Things not to do

- Do not run `npx wrangler pages deploy`. Cloudflare deploys from GitHub automatically; manual deploys will fight with it.
- Do not change the database id in `wrangler.toml` or delete `schema.sql`.
- Do not add credentials, tokens, or .env files to the repo.
- Do not commit videos larger than a few megabytes. Compress first and put them in `assets/`.
- Do not push to any other repo or account. The only home for this site is pgicover/slypway-marketing.

## 10. Reading signups

Signups live in the production D1 database on Craig's Cloudflare account. Ask Craig for an export; the repo itself holds no signup data.

## Instructions for Claude

If Andrew hands you this file: follow sections 3 through 8 in order, add a CHANGELOG.md entry in every commit, stop and ask before any push to main, never run a Cloudflare deploy command, and never add files beyond the change Andrew asked for. Section 1 must be done by Andrew in his own browser; remind him if he has not confirmed it.
