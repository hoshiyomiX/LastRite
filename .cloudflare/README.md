# Custom Domain Management

## Automatic via GitHub Actions

Custom domains **auto-attach** setelah setiap deploy.

### How It Works

1. Edit `.cloudflare/domains.txt` - add/remove domains
2. Push to `main` or `testing` branch
3. GitHub Actions auto-attach semua domains
4. Done! ✨

## Manual Management

```bash
# Make executable
chmod +x .cloudflare/manage-domains.sh

# Attach all domains
./.cloudflare/manage-domains.sh attach

# List domains
./.cloudflare/manage-domains.sh list

# Verify responses
./.cloudflare/manage-domains.sh verify
```

## Add Domain

1. Edit `domains.txt`:
   ```bash
   echo "new.example.com" >> .cloudflare/domains.txt
   ```

2. Commit & push:
   ```bash
   git add .cloudflare/domains.txt
   git commit -m "add: new.example.com"
   git push
   ```

3. Auto-attached! ✅

## Remove Domain

1. Delete line dari `domains.txt`
2. Manual detach:
   ```bash
   wrangler domains remove old.example.com --force
   ```
3. Commit & push

## Troubleshooting

**Domains not attaching?**

Check GitHub Actions logs:
```
Actions → Latest run → Deploy Worker → Auto-attach custom domains
```

**Manual override:**
```bash
export CLOUDFLARE_API_TOKEN="your-token"
./.cloudflare/manage-domains.sh attach
```

## Required Secrets

GitHub repo secrets:
- `CF_API_TOKEN` - Cloudflare API token
- `CF_ACCOUNT_ID` - Account ID

Permissions needed: Workers Scripts:Edit, Workers Routes:Edit, DNS:Edit
