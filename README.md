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

Le serveur utilise PostgreSQL dès que `DATABASE_URL` est défini. Sans `DATABASE_URL`, il bascule uniquement en dev local sur un store mémoire: les comptes créés disparaissent au redémarrage. En production, `NODE_ENV=production` refuse de démarrer sans `SESSION_SECRET` et `DATABASE_URL`.

Exemple avec la base du cluster exposée temporairement en local:

```powershell
kubectl -n database port-forward svc/postgresql-ha-rw 5432:5432
$env:DATABASE_URL = "postgres://krunker:<password>@127.0.0.1:5432/krunker?sslmode=disable"
pnpm --filter @krunker-arena/server dev
```

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

La production utilise le cluster CloudNativePG existant via le service read/write `postgresql-ha-rw.database.svc.cluster.local:5432`, avec une base et un rôle applicatif dédiés `krunker`. Appliquer les manifests dans `infra/k8s` après avoir créé le secret `krunker-app-secret` avec `SESSION_SECRET` et `DATABASE_URL`.

Le serveur expose:

- `/healthz`: vie du process Node.
- `/readyz`: readiness applicative; vérifie aussi `select 1` contre PostgreSQL quand le store Postgres est actif.

Redis n’est pas requis tant que `krunker-server` reste à une réplique. Pour passer en multi-pod Colyseus, ajouter `@colyseus/redis-presence`, configurer le Redis du namespace `database`, puis changer la stratégie de déploiement et le routage WebSocket en conséquence.
