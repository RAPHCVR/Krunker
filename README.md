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

Le serveur utilise PostgreSQL dès que `DATABASE_URL` est défini. Sans `DATABASE_URL`, il bascule uniquement en dev local sur un store mémoire: les comptes créés disparaissent au redémarrage. En production, `NODE_ENV=production` + `AUTH_STORE=postgres` refusent de démarrer sans `SESSION_SECRET` et `DATABASE_URL`.

Exemple avec la base du cluster exposée temporairement en local:

```powershell
kubectl -n database port-forward svc/postgresql-ha-rw 5432:5432
$env:DATABASE_URL = "postgres://krunker:<password>@127.0.0.1:5432/krunker?sslmode=disable"
pnpm --filter @krunker-arena/server dev
```

Pour diagnostiquer le mouvement client/serveur, ouvrir `http://localhost:5173/?debug=1`: l’overlay affiche l’écart de prédiction et le nombre de corrections dures.

Le smoke navigateur automatisé démarre le serveur et le client localement si les ports `2567` et `5173` ne répondent pas déjà:

```powershell
pnpm smoke:browser
```

Pour tester le respawn en local:

```powershell
pnpm smoke:browser:respawn
```

Si tu veux cibler un environnement déjà lancé sans gestion automatique des services locaux, utiliser `GAME_URL` ou `SMOKE_MANAGE_SERVERS=0`.
Pour forcer une taille de viewport pendant le smoke, définir `SMOKE_VIEWPORT_WIDTH` et `SMOKE_VIEWPORT_HEIGHT`.

## Latence temps réel

Le client utilise par défaut le même host que la page et se connecte à `/realtime`. Pour une prod FPS, le chemin temps réel doit éviter les tunnels/proxys HTTP partagés. Définir `VITE_REALTIME_URL` au build du client pour pointer vers un endpoint Colyseus direct:

```powershell
$env:VITE_REALTIME_URL = "wss://krunker-rt.raphcvr.me"
pnpm --filter @krunker-arena/client build
```

`VITE_REALTIME_URL` accepte `ws:`, `wss:`, `http:` ou `https:`; `http:` et `https:` sont convertis en WebSocket côté client. Le manifest expose aussi `krunker-rt.raphcvr.me` comme host realtime dédié. Si ce host passe encore par Cloudflare Tunnel, un p95 autour de quelques centaines de millisecondes reste attendu. Pour viser quelques dizaines de ms, faire pointer ce même host vers une route directe, idéalement géographiquement proche des joueurs, et garder Cloudflare seulement pour le site statique/API non critique.

## Validation

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke:browser
```

Le test `pnpm smoke:latency` cible maintenant un profil FPS compétitif par défaut: `MAX_ACK_P95_MS=80`, `MAX_ACK_MAX_MS=250`, `MAX_PATCH_P95_MS=80`. Pour un simple smoke d’infra lente ou tunnelisée, surcharger explicitement ces seuils au lieu de considérer ce profil comme validé.

## Production

- Client: `ghcr.io/raphcvr/krunker-client:latest`.
- Serveur: `ghcr.io/raphcvr/krunker-server:latest`.
- Host: `krunker.raphcvr.me`.

La production utilise le cluster CloudNativePG existant via le service read/write `postgresql-ha-rw.database.svc.cluster.local:5432`, avec une base et un rôle applicatif dédiés `krunker`. Appliquer les manifests dans `infra/k8s` après avoir créé le secret `krunker-app-secret` avec `SESSION_SECRET` et `DATABASE_URL`.

Le serveur expose:

- `/healthz`: vie du process Node.
- `/readyz`: readiness applicative; vérifie aussi `select 1` contre PostgreSQL quand le store Postgres est actif.

Redis n’est pas requis tant que `krunker-server` reste à une réplique. Pour passer en multi-pod Colyseus, ajouter `@colyseus/redis-presence`, configurer le Redis du namespace `database`, puis changer la stratégie de déploiement et le routage WebSocket en conséquence.

Les manifests Kubernetes forcent le profil prod: `NODE_ENV=production`, `AUTH_STORE=postgres`, redirect HTTPS Ingress, headers statiques HSTS côté NGINX, namespace en Pod Security `restricted`, PDB client/serveur, deux réplicas pour le client statique et serveur Colyseus mono-réplique volontaire.
