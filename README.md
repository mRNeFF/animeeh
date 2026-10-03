# ANIMEEH

Application de bureau pour **noter et classer tous les animés que vous regardez** — épisode par épisode, sur sept critères, avec un score global pondéré.

[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)

![Bibliothèque](docs/screenshots/library.png)

---

## Sommaire

- [Ce que fait l'application](#ce-que-fait-lapplication)
- [Le modèle de notation](#le-modèle-de-notation)
- [Installation](#installation)
- [Où sont mes données](#où-sont-mes-données)
- [Scripts disponibles](#scripts-disponibles)
- [Architecture](#architecture)
- [Publier une nouvelle version](#publier-une-nouvelle-version)
- [Limites connues](#limites-connues)

---

## Ce que fait l'application

- **Note chaque épisode de 0 à 100.** Un épisode non noté est simplement ignoré : vous pouvez créer une saison entière puis noter au fil du visionnage sans fausser votre moyenne.
- **Sept critères par animé** — Personnages, Histoire, Animation, OST, Opening, Key Factor, Originalité.
- **Score global pondéré**, dont la moyenne des épisodes fait partie intégrante.
- **Quatre vues** : Bibliothèque, Classement global, Classement par critère, Réglages.
- **Recherche AniList** : tapez un titre, l'application pré-remplit l'année, le studio, le nombre d'épisodes **et les titres des épisodes**, puis vous laisse tout corriger à la main.
- **Mise à jour depuis l'application**, via GitHub Releases.
- **100 % local** : vos notes vivent dans un simple fichier JSON chez vous. Aucun compte, aucun serveur.

| Bibliothèque | Fiche détaillée |
|---|---|
| ![Bibliothèque](docs/screenshots/library.png) | ![Fiche](docs/screenshots/detail.png) |

| Classement global | Classement par critère |
|---|---|
| ![Classement](docs/screenshots/leaderboard.png) | ![Critères](docs/screenshots/criteria.png) |

| Recherche AniList | Réglages |
|---|---|
| ![AniList](docs/screenshots/anilist-search.png) | ![Réglages](docs/screenshots/settings.png) |

---

## Le modèle de notation

C'est le cœur de l'application, donc voici exactement comment le score global est calculé.

### Les huit composantes

Sept critères que vous notez vous-même, plus une composante calculée :

| Composante | Source |
|---|---|
| Personnages, Histoire, Animation, OST, Opening, Key Factor, Originalité | Votre note, de 0 à 100 |
| **Moyenne des épisodes** | Calculée automatiquement à partir des épisodes notés |

### La formule

```
score global = Σ (valeur × poids) / Σ (poids)
```

La somme ne porte que sur les composantes **effectivement notées** et dont le **poids est supérieur à zéro**.

Deux conséquences voulues :

- Un critère que vous n'avez pas encore noté est **exclu** du calcul au lieu de compter comme un zéro. Une fiche à moitié remplie n'est donc pas pénalisée.
- Mettre un poids à `0` revient à retirer complètement la composante du classement, sans effacer la note.

Les poids se règlent dans **Réglages → Criteria weights** (de `0` à `3`, par pas de `0,25`) et valent `1` par défaut.

### Exemple concret

Voici le résultat réel d'un test sur *Sousou no Frieren*, tous les poids à `1` :

| Personnages | Histoire | Animation | OST | Opening | Key Factor | Originalité | Moyenne épisodes |
|---|---|---|---|---|---|---|---|
| 95 | 96 | 92 | 88 | 90 | 85 | 89 | 95,6 |

```
(95 + 96 + 92 + 88 + 90 + 85 + 89 + 95,6) / 8 = 91,3
```

→ **91,3**, soit la note **S**.

### Les notes lettrées

| Lettre | Seuil |
|---|---|
| **S** | 90 et plus |
| **A** | 80 – 89,9 |
| **B** | 70 – 79,9 |
| **C** | 60 – 69,9 |
| **D** | 50 – 59,9 |
| **E** | moins de 50 |

### La moyenne des épisodes

Elle ne porte que sur les épisodes réellement notés :

```
moyenne = somme des notes des épisodes notés / nombre d'épisodes notés
```

Si aucun épisode n'est noté, la composante est `null` et se retire du calcul — le score global reste défini à partir des seuls critères.

---

## Installation

### Depuis les releases

1. Téléchargez `ANIMEEH-x.y.z-setup.exe` depuis la page [Releases](https://github.com/mRNeFF/animeeh/releases).
2. Lancez l'installeur, choisissez le dossier d'installation.
3. Raccourcis créés sur le Bureau et dans le menu Démarrer.

L'application se met à jour toute seule ensuite : **Réglages → Check for updates**.

### Depuis les sources

Prérequis : **Node.js 22 ou plus récent** et **Git**.

```powershell
git clone https://github.com/mRNeFF/animeeh.git
cd animeeh
npm install
npm run dev
```

Pour produire un installeur Windows :

```powershell
npm run dist        # installeur NSIS dans release/
npm run dist:dir    # version décompressée, sans installeur (plus rapide)
```

---

## Où sont mes données

Vos notes sont dans un unique fichier JSON :

```
%APPDATA%\ANIMEEH\animeeh-data.json
```

> **À savoir :** lancée depuis les sources (`npm run dev`), l'application utilise un dossier distinct, `%APPDATA%\animeeh`. Les deux versions ne partagent donc **pas** la même liste. Copiez le fichier de l'un vers l'autre si besoin.

Pour sauvegarder ou transférer votre liste : **Réglages → Export backup** (et **Import backup** dans l'autre sens). Le bouton **Show data file** ouvre le dossier directement.

En cas de problème, **Réglages** affiche la version courante et le dossier de données ; les journaux de démarrage sont écrits à côté.

---

## Scripts disponibles

| Commande | Rôle |
|---|---|
| `npm run dev` | Lancement en développement, avec rechargement à chaud |
| `npm run build` | Compile les trois processus dans `out/` |
| `npm run typecheck` | Vérification TypeScript, sans émission |
| `npm run start` | Lance le build compilé |
| `npm run dist` | Installeur Windows (NSIS) dans `release/` |
| `npm run dist:dir` | Application packagée non installable dans `release/win-unpacked/` |
| `npm run icon` | Régénère `build/icon.ico` et les PNG |
| `npm run release` | Construit **et publie** une release GitHub |
| `npm run smoke` | Test de bout en bout : parcours complet + capture d'écran |
| `npm run smoke:offline` | Vérifie le comportement quand AniList est injoignable |
| `npm run smoke:update` | Teste la mise à jour avec un faux serveur local |
| `npm run smoke:update:live` | Teste la mise à jour contre les vraies releases GitHub |

---

## Architecture

Trois processus Electron, plus des types partagés. **Tout le réseau vit dans le processus principal** ; l'interface n'y a jamais accès directement.

```
src/
├── main/                  Processus principal (Node)
│   ├── index.ts           Fenêtre, persistance, IPC
│   ├── anilist.ts         Client GraphQL AniList, avec cache et délais
│   └── updater.ts         electron-updater : détection, téléchargement, installation
├── preload/               Pont IPC sécurisé (contextBridge)
│   └── index.ts           API exposée à l'interface, rien de plus
├── renderer/              Interface (React)
│   ├── index.html
│   └── src/
│       ├── components/    Vues et composants réutilisables
│       ├── App.tsx        Navigation entre les quatre vues
│       ├── scoring.ts     ★ Modèle de notation (testé par les smoke tests)
│       ├── store.tsx      État global + persistance débouncée
│       ├── types.ts       Modèle de données
│       └── useUpdate.ts   État de mise à jour côté interface
└── shared/                Types partagés entre main et renderer
```

**Stack :** Electron 44 · React 19 · TypeScript 7 · Vite 7 (via `electron-vite`) · `electron-updater`.

### Notes d'implémentation

- **Contexte isolé, pas de `nodeIntegration`.** L'interface passe par `window.animeeh`, une API explicite exposée par le preload.
- **Le score des épisodes est nullable.** `null` = non noté. C'est ce qui permet de pré-créer des épisodes sans écraser la moyenne à zéro.
- **Écriture disque débouncée** (350 ms) et ignorée si le contenu n'a pas changé.
- **Mises à jour pilotées par l'utilisateur** (`autoDownload = false`), et une vérification en arrière-plan ne peut jamais écraser un téléchargement en cours ou terminé.
- **AniList** sert de source de référence : son API ne demande aucune inscription et chaque entrée porte `idMal`, l'identifiant MyAnimeList officiel.

---

## Publier une nouvelle version

L'API officielle MyAnimeList exige un OAuth2, et `electron-updater` a besoin d'un fichier `latest.yml` qu'`electron-builder` ne génère pas pour le provider GitHub : `scripts/release.mjs` s'en charge.

```powershell
# 1. Incrémenter la version
npm version patch     # ou minor / major

# 2. Construire et publier
npm run release
```

Le script compile, crée le tag et la release GitHub, génère `latest.yml` (nom, taille, sha512), puis vérifie que les fichiers sont bien en ligne.

> Le dépôt **doit rester public** : `electron-updater` interroge GitHub sans authentification, un dépôt privé exigerait d'embarquer un token dans l'application.

Le prérequis est [GitHub CLI](https://cli.github.com/) authentifié (`gh auth login`).

---

## Limites connues

- **Installeur non signé.** Windows SmartScreen affichera « Éditeur inconnu » au premier lancement chez quelqu'un d'autre que vous. Cela demande un certificat de signature de code payant.
- **Windows uniquement pour l'instant.** `electron-builder.yml` contient des cibles Linux et macOS, mais rien n'a été testé dessus.
- **AniList limite à environ 30 requêtes par minute.** L'application applique un anti-rebond de 450 ms et un cache de 30 minutes ; en usage normal vous ne le sentirez pas.
- **AniList n'est pas MyAnimeList.** Ce sont deux bases distinctes, reliées par `idMal`. Les données sont très proches sur les séries connues, mais peuvent diverger (nombre d'épisodes, studios).
- **L'interface est en anglais**, les messages de l'application aussi.

---

## Licence

[MIT](LICENSE) — faites-en ce que vous voulez.
