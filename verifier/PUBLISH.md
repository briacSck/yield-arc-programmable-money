# Publishing `@yield-cfo/mandate-verify` — CTO handoff

The package is **fully built and ready**. This is only about npm auth (the interactive `npm login`
web flow kept expiring its CLI callback before browser 2FA completed — a token sidesteps it).
Everything is on branch `feat/verifier`. Name `@yield-cfo/mandate-verify` is unclaimed (first publish).

## Option A — local publish (fastest, ~2 min)

```bash
# 1. Create a Granular Access Token on npmjs.com:
#    avatar → Access Tokens → Generate New Token → Granular Access Token
#    Permissions: Packages and scopes = Read and write, scope = @yield-cfo org, pick an expiry.
# 2. Point npm at it (stays in your ~/.npmrc):
npm config set //registry.npmjs.org/:_authToken=npm_XXXXXXXX
npm whoami                      # should print your username
# 3. Publish (prepublishOnly rebuilds the esbuild bundle + runs tests):
cd verifier && npm publish
```
`publishConfig.access` is already `public`, so no `--access` flag needed.

## Option B — CI publish with provenance (cleanest, on-message)

Publishes a signed provenance link (tarball ← this commit ← this workflow), which is exactly the
trust story the tool sells.

```bash
# 1. Add the granular token (from A.1) as a GitHub repo secret named NPM_TOKEN
#    (repo Settings → Secrets and variables → Actions → New repository secret).
# 2. Tag and push — .github/workflows/release-verifier.yml runs tests then publishes:
git tag verifier-v0.1.0 && git push origin verifier-v0.1.0
```

## Verify it worked

```bash
npx -y @yield-cfo/mandate-verify              # live chain, 5/5 COMPLIANT in ~3s
npx -y @yield-cfo/mandate-verify --fixture naive-agent   # negative demo, exits 1
```

Then the README badges (`img.shields.io/npm/v/@yield-cfo/mandate-verify`) go green on their own, and
the judge command in the top fold works for real. That's the last CP2 blocker on the verifier lane.
