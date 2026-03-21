# Audigue

Extension Chrome qui lit à voix haute le contenu des pages web en français ou en anglais, en utilisant la synthèse vocale locale du navigateur.

## Fonctionnalités

- **100% local** — Utilise l'API Web Speech intégrée au navigateur, aucune donnée n'est envoyée à un serveur externe
- **Sélecteur de voix** — Choisir parmi toutes les voix installées sur votre système (masculines, féminines, naturelles…)
- **Détection automatique de la langue** — Français et anglais, via l'attribut `<html lang>` ou par analyse heuristique
- **Contrôle de la vitesse** — Réglable de 0.5x à 3x en temps réel pendant la lecture
- **Extraction intelligente** — Lit le titre puis le contenu de l'article, filtre les publicités, barres de navigation, sidebars et liens annexes
- **Lecture par blocs** — Découpe le texte en segments avec progression affichée (ex: 3/12)
- **Préférences sauvegardées** — Vitesse et voix mémorisées entre les sessions

## Installation

1. Cloner ce dépôt ou télécharger le ZIP
   ```bash
   git clone https://github.com/Yanndd1/Audigue.git
   ```
2. Ouvrir Chrome et aller sur `chrome://extensions/`
3. Activer le **Mode développeur** (en haut à droite)
4. Cliquer sur **Charger l'extension non empaquetée**
5. Sélectionner le dossier `Audigue`

## Utilisation

1. Naviguer vers une page web en français ou en anglais
2. Cliquer sur l'icône Audigue dans la barre d'extensions
3. Choisir une voix dans le sélecteur (les voix marquées `[local]` fonctionnent hors-ligne)
4. Ajuster la vitesse si besoin
5. Cliquer sur **Lire** pour démarrer la lecture audio
6. Utiliser **Pause** pour suspendre/reprendre et **Stop** pour arrêter

## Vie privée et sécurité

Audigue est conçu avec la vie privée comme priorité :

- **Aucune donnée ne quitte votre navigateur.** Tout le traitement (extraction de texte, synthèse vocale) se fait localement.
- **Aucun serveur externe** n'est contacté. Pas de télémétrie, pas d'analytics, pas de tracking.
- **Permissions minimales** — L'extension ne demande que le strict nécessaire (voir tableau ci-dessous).
- **Pas de service worker** — Aucun processus en arrière-plan ne tourne quand l'extension n'est pas utilisée.
- **Code source ouvert** — Tout le code est lisible et auditable.

## Permissions utilisées

| Permission   | Raison                                              |
|-------------|------------------------------------------------------|
| `activeTab`  | Accéder au contenu de l'onglet actif uniquement lors du clic sur l'icône |
| `scripting`  | Injecter le script de lecture dans la page           |
| `storage`    | Sauvegarder les préférences (vitesse, voix choisie)  |

> **Note :** `activeTab` est la permission la plus restrictive possible — elle ne donne accès qu'à l'onglet actif, uniquement quand l'utilisateur clique sur l'icône de l'extension.

## Structure du projet

```
Audigue/
├── manifest.json        # Configuration de l'extension (Manifest V3)
├── content.js           # Script de contenu : extraction du texte et TTS
├── popup/
│   ├── popup.html       # Interface utilisateur du popup
│   ├── popup.css        # Styles (thème sombre)
│   └── popup.js         # Logique du popup (contrôles, communication)
├── icons/
│   ├── icon16.png       # Icône 16×16
│   ├── icon48.png       # Icône 48×48
│   └── icon128.png      # Icône 128×128
├── LICENSE              # Licence MIT
├── CHANGELOG.md         # Historique des versions
└── README.md            # Ce fichier
```

## Compatibilité

- Chrome 88+ (Manifest V3)
- Chromium, Edge, Brave et autres navigateurs basés sur Chromium

## Contribuer

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.

1. Forker le projet
2. Créer une branche (`git checkout -b feature/ma-fonctionnalite`)
3. Commiter les changements (`git commit -m 'Ajout de ma fonctionnalité'`)
4. Pousser la branche (`git push origin feature/ma-fonctionnalite`)
5. Ouvrir une Pull Request

## Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.
