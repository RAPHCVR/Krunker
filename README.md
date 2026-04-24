# Krunker Arena

FPS arena 3D original, auto-hébergeable sur Kubernetes, inspiré des sensations arcade rapides sans reprendre les assets ni l'identité de Krunker.

## Stack

- Client: Vite, TypeScript, Three.js, Pico CSS.
- Serveur: Node.js, Express, Colyseus, PostgreSQL, argon2id.
- Shared: constantes gameplay et types réseau partagés.
- Déploiement: images GHCR, NGINX Ingress, manifests Kubernetes.

## Dev local

```powershell
corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm install
pnpm dev
```

Le client écoute sur `http://localhost:5173` et proxifie `/api` + `/realtime` vers le serveur `http://localhost:2567`.

Sans `DATABASE_URL`, le serveur utilise un store mémoire pour le dev local: les comptes créés disparaissent au redémarrage.

Pour diagnostiquer le mouvement client/serveur, ouvrir `http://localhost:5173/?debug=1`: l’overlay affiche l’écart de prédiction et le nombre de corrections dures.

Avec le client et le serveur déjà lancés, le smoke navigateur automatisé se lance avec:

```powershell
pnpm smoke:browser
```

Pour tester le respawn en local, lancer le serveur avec `ENABLE_DEBUG_CHEATS=true`, puis exécuter:

```powershell
pnpm smoke:browser:respawn
```

## Validation

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke:browser
```

## Production

- Client: `ghcr.io/raphcvr/krunker-client:latest`.
- Serveur: `ghcr.io/raphcvr/krunker-server:latest`.
- Host: `krunker.raphcvr.me`.

Appliquer les manifests dans `infra/k8s` après avoir créé le secret `krunker-app-secret` avec `SESSION_SECRET` et `DATABASE_URL`.
