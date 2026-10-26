# LabPass — Guide de l’administrateur

_Version 1.0 · ICT University, laboratoire Cisco · English: [admin-guide.en.md](./admin-guide.en.md)_

LabPass enregistre qui emprunte quel matériel au laboratoire Cisco :

- Les étudiants s’identifient à la **borne** (le PC du laboratoire équipé du lecteur de cartes) avec leur carte ICTU, leur téléphone Android, le code QR de l’application LabPass ou leur matricule.
- Ils choisissent ensuite ce qu’ils empruntent ou rendent.
- Vous gérez tout depuis la **console d’administration** : `https://admin.<domaine du labo>`.

## 1. Connexion

1. Ouvrez la console et saisissez votre e-mail et votre mot de passe.
2. Saisissez le code à 6 chiffres de votre application d’authentification (Google Authenticator, Microsoft Authenticator, Aegis…). À la première connexion, vous scannez un code QR pour la configurer. Changez ensuite le mot de passe temporaire dans **Mon profil**.
3. Les sessions expirent après une période d’inactivité. Ne partagez jamais votre compte : chaque action est inscrite à votre nom dans le **Journal d’audit**.

Appuyez sur **Ctrl K** (⌘K sur Mac) n’importe où pour rechercher une page, un étudiant ou un article.

## 2. Rôles

| Rôle                 | Peut                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| Super administrateur | Tout, y compris **Paramètres**, **Utilisateurs** et l’option « Aucune vérification » |
| Responsable du labo  | Matériel et stock, étudiants, imports, demandes, prêts, alertes, rapports, bornes    |
| Assistant de labo    | Prêts, demandes, et confirmation des saisies de matricule à la borne                 |
| Lecteur              | Lecture seule : tableau de bord, inventaire, prêts et rapports                       |

## 3. Travail quotidien

### Tableau de bord

Affiche en direct :

- le matériel en prêt et les prêts en retard ;
- les articles en stock bas ;
- l’état des bornes ;
- l’activité récente.

Il se met à jour tout seul. Le point dans la barre du haut est vert tant que la connexion en direct fonctionne.

### Inventaire : matériel et stock

- **Ajouter du matériel :** Inventaire → _Ajouter du matériel_. Saisissez :
  - le **nom** et le **code** (l’étiquette de l’article ou de l’étagère, ex. `CBL-CONSOLE-USB`) ;
  - la **catégorie** ;
  - la **quantité** initiale ;
  - un **seuil d’alerte** facultatif.
- **Ajuster le stock :** ouvrez l’article → _Ajuster le stock_. Choisissez le type de modification, puis saisissez la quantité et un **motif** :
  - **Réapprovisionnement** : achat, ou unités retrouvées ;
  - **Mise au rebut** : perdu, irréparable, retiré ;
  - **Correction** : après un inventaire physique.

  Le stock n’est jamais modifié directement : chaque changement est un mouvement enregistré, l’historique est donc toujours cohérent.

- Les unités en prêt ne peuvent pas être mises au rebut. Enregistrez d’abord le retour, avec l’état _Perdu_ ou _Endommagé_ si nécessaire.

### Prêts

- **En cours** montre ce qui est sorti, **En retard** ce qui a dépassé l’heure de retour, et **Rendus** l’historique.
- _Enregistrer un retour_ : à utiliser quand le matériel revient sans que l’étudiant passe par la borne (ex. retrouvé sur une table). Choisissez l’état de chaque article (Bon, Endommagé ou Perdu) et indiquez un motif.

### Demandes

- **Pass téléphone :** les étudiants qui veulent utiliser leur téléphone comme carte de laboratoire. Les demandes dont les informations correspondent exactement au dossier de scolarité sont **approuvées automatiquement**. Les autres attendent ici :
  - comparez _Saisi par l’étudiant_ et _Dossier de scolarité_ ;
  - si elles diffèrent, vérifiez la carte d’étudiant en personne avant d’approuver ;
  - le motif d’un refus est envoyé à l’étudiant.
- **Liaisons de cartes :** une carte absente du fichier du fournisseur, liée à la borne par un étudiant. Approuvez après avoir vérifié sa carte d’étudiant.

### Étudiants et imports

- **Étudiants** affiche pour chaque étudiant son statut, sa carte, son pass téléphone et ses prêts en cours. Ouvrez un étudiant pour :
  - _Réinitialiser le PIN_ (PIN de saisie manuelle) ;
  - _Lier une carte_ ou la _Délier_ (carte perdue) ;
  - _Révoquer_ un pass téléphone (téléphone perdu).

  Le statut (Actif / Inactif / Suspendu) provient de l’import du dossier de scolarité.

- **Import :**
  - Téléversez le fichier CSV ou Excel de la scolarité (en-têtes en français ou en anglais). _Télécharger le modèle_ donne les colonnes attendues.
  - Vérifiez l’aperçu (Nouveaux / Modifiés / Inchangés / Problèmes), puis cliquez sur _Importer_.
  - _Annuler l’import_ défait le dernier import.
  - La même page configure le **connecteur au système de scolarité** quand l’informatique en fournit un.
- **Lot de cartes du fournisseur :** importez le fichier du fournisseur (numéro de carte ↔ matricule) pour que les cartes fonctionnent dès le premier passage.

### Bornes

- **Enregistrer une borne :**
  1. Cliquez sur _Enregistrer une borne_ et donnez-lui un nom et un emplacement.
  2. Saisissez le code sur la borne, ou scannez le code QR affiché. Le code ne sert qu’une fois et expire au bout de 10 minutes.
- La liste montre pour chaque borne : en ligne ou hors ligne, dernière activité, état du lecteur et version de l’application. _Révoquer_ bloque immédiatement un PC volé ou retiré.

### Synchro hors ligne

Si le serveur est injoignable, les bornes continuent à prêter (pendant le nombre d’heures fixé dans les Paramètres) et envoient leurs enregistrements au retour du serveur. Les prêts qui n’ont pas pu être appliqués automatiquement apparaissent dans **Synchro hors ligne** :

- _Accepter_ enregistre ce qui s’est réellement passé. Pour un conflit de stock, le stock est d’abord corrigé, la disponibilité ne devient jamais négative.
- _Annuler_ n’enregistre rien. À utiliser si la transaction n’a pas eu lieu ou n’est pas fiable.

## 4. Alertes et notifications

**Alertes** :

- **Seuil d’alerte global :** alerte quand les unités disponibles descendent à ce nombre ou en dessous. Chaque article peut avoir son propre seuil (_Seuils par article_).
- **Comment je reçois les alertes :** e-mail, SMS, WhatsApp et/ou notification push, pour le stock bas, la rupture de stock et les demandes de pass téléphone.
  - Les numéros de téléphone doivent d’abord être vérifiés par un code.
  - _Envoyer un test_ vérifie un canal.
- **Heures calmes :** les alertes de stock bas attendent la fin des heures calmes. Les ruptures de stock sont toujours envoyées. _Regrouper les alertes_ envoie un résumé au lieu de nombreux messages.
- **Fournisseurs** (super administrateur) :
  - la passerelle SMS (_Mode test_ n’envoie rien de réel) ;
  - les paramètres de l’API WhatsApp Cloud (voir le runbook WhatsApp).

  Les secrets enregistrés ne sont plus jamais affichés ; laissez le champ vide pour les conserver.

- **Journal d’envoi :** chaque message, son état et ses tentatives.

## 5. Paramètres (super administrateur)

| Paramètre                                        | Recommandé                                                                   | Remarques                                                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Saisie du matricule sans carte                   | PIN de l’étudiant ou assistant                                               | « Aucune vérification » permet d’emprunter au nom d’un autre étudiant ; ces prêts sont signalés.                                      |
| Échéance des prêts                               | À la fermeture du laboratoire                                                | Ou après un nombre d’heures                                                                                                           |
| Nombre maximum d’articles par étudiant           | 3 à 5                                                                        |                                                                                                                                       |
| Les étudiants en retard ne peuvent pas emprunter | Activé                                                                       |                                                                                                                                       |
| Retour à l’écran d’accueil après                 | 30 s                                                                         | Délai de confidentialité de la borne                                                                                                  |
| Animations                                       | Complètes (Réduites/Minimales sur PC lents)                                  |                                                                                                                                       |
| Sécurité des cartes                              | Numéro de carte seul → Vérification sécurisée à l’arrivée des cartes DESFire |                                                                                                                                       |
| Prêts hors ligne autorisés pendant               | 8 heures                                                                     | 0 désactive les prêts hors ligne                                                                                                      |
| Conserver l’historique des prêts                 | 24 mois                                                                      | Durée de conservation convenue. La v1 l’enregistre ; la purge automatique sera activée après validation de la protection des données. |
| Version minimale de l’application                | Dernière version                                                             | Les anciennes applications Android sont invitées à se mettre à jour                                                                   |

**Mon PIN d’assistant pour la borne** (tous les assistants) : le PIN que vous saisissez à la borne pour confirmer la saisie de matricule d’un étudiant.

## 6. Utilisateurs (super administrateur)

- _Ajouter un utilisateur_ : nom, e-mail, rôle et mot de passe temporaire (12 caractères min.). Remettez le mot de passe en main propre.
- _Réinitialiser 2 étapes_ : l’utilisateur a perdu son téléphone ; il configure une nouvelle application d’authentification à la prochaine connexion.
- _Désactiver_ : les sessions de l’utilisateur prennent fin immédiatement.

## 7. Rapports et audit

- **Rapports**, sur une période : articles les plus empruntés, prêts par jour, heures de pointe, nombre d’étudiants différents. _Exporter en CSV_ pour chaque tableau.
- **Journal d’audit** : chaque action d’administration (qui, quand, quoi). Les secrets et les PIN ne sont jamais affichés.

## 8. En cas de problème

| Problème                                            | Que faire                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| La borne affiche « Lecteur de cartes non connecté » | Rebranchez le lecteur. Les étudiants peuvent utiliser leur matricule ou le code QR de l’application.                  |
| La borne affiche « Serveur LabPass injoignable »    | Les prêts continuent hors ligne. Prévenez l’informatique ; vérifiez ensuite la Synchro hors ligne.                    |
| La carte d’un étudiant est inconnue                 | L’étudiant peut la lier à la borne (avec son matricule) ; approuvez dans Demandes → Liaisons de cartes.               |
| Le stock semble faux                                | Consultez l’historique des mouvements de l’article ; corrigez avec _Ajuster le stock_ → Correction et un motif clair. |
| Application d’authentification perdue               | Demandez à un autre super administrateur de _Réinitialiser 2 étapes_.                                                 |

Les procédures techniques pour l’informatique (installation, sauvegardes, supervision, clés) sont dans [`docs/runbooks`](../runbooks/README.md) (en anglais).
