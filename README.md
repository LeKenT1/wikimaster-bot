# WikiMasters Bot

Un assistant pour WikiMasters qui tourne directement dans ton navigateur, sur ton compte déjà connecté. Il n'a besoin d'aucun mot de passe.

Il sait :
- **ouvrir tes paquets** dès qu'ils sont disponibles ;
- **acheter les cartes que tu veux**, au titre exact (« Zeus » ne prendra jamais « Zeus Ammon »), sans dépasser ton prix max ;
- **chasser les bonnes affaires** : des cartes bradées juste avant la fin de leur enchère ;
- **vendre et trier ta collection** : mise en vente et défausse automatiques des raretés choisies, sauf tes favoris.

## Installation (2 minutes)

1. Installe l'extension **Tampermonkey** depuis le Chrome Web Store (existe aussi pour Firefox, Edge, Safari).
2. Clique sur l'icône Tampermonkey, puis **Créer un nouveau script**.
3. Efface le modèle, colle tout le contenu de `wikimasters-bot.user.js`, puis fais **Ctrl+S**.
4. Ouvre https://www.wiki-masters.com : le panneau du bot apparaît en bas à droite.

Si Chrome le demande, active le « Mode développeur » dans `chrome://extensions` pour que Tampermonkey puisse lancer les scripts.

## Premiers pas

1. **Cartes voulues** : tape un nom, clique Chercher, puis Ajouter sur la bonne carte (badge « titre exact »). Tu peux fixer un prix max par carte, sinon c'est le prix max de sa rareté.
   - Les cartes que tu possèdes déjà sont surlignées en vert (« ✓ Possédée » avec leur rareté), les autres sont marquées « À trouver ».
   - Case **Affaire** : le bot n'achète cette carte que si c'est une bonne affaire, avec la même règle que le Trading.
2. **Réglages** : choisis ta **réserve protégée**, le solde que le bot ne fera jamais descendre.
3. Clique **Démarrer**. Le rond qui tourne en haut du panneau montre que le bot est en ligne : vert en réel, jaune en simulation.
4. Au début, le bot est en **simulation** : il écrit dans le journal ce qu'il ferait, sans rien dépenser. Quand ça te convient, désactive la simulation dans Réglages.

Tout est enregistré automatiquement dès que tu modifies un réglage.

## Le Trading : comment il repère une bonne affaire

**🤖 Utiliser les réglages optimisés** (activé par défaut, en tête des Règles de l'onglet Trading) applique des réglages **fixes**, issus d'une analyse du marché du 30/09/2026 (156 enchères suivies jusqu'à leur fin et 59 achats/reventes). Ils ne changent pas tout seuls.

- **Constat** : les bonnes affaires sont nombreuses. 57 à 63 % des UR et SR finissent sans aucune mise, et le prix monte en fin d'enchère dans environ 15 % des cas. La vraie limite est la revente, avec seulement 5 emplacements. D'où la règle : acheter moins, mais plus rentable.
- **Raretés** : UR, SR, R.
- **Achat** : fin dans moins de 4 min, prix au plus 40 % de la valeur, valeur minimum 60, bénéfice minimum 30.
- **Revente** : stock maximum 15, départ à 90 % de la valeur, baisse de 10 % par invendu, ventes de 10 min, braderie jusqu'à 25 %, vente à perte après 4 invendus.

Budget, réserve, prix max, nombre d'enchères et raretés cochées restent sous ton contrôle. Décoche l'option pour utiliser tes propres valeurs : elles sont gardées.


Toutes les 30 s (réglable), le bot regarde les enchères triées par **fin imminente** qui se terminent dans moins de 3 min.

Pour chaque carte, il estime sa **valeur** :
- c'est la **moyenne de ses ventes passées**, la donnée que le site affiche quand tu mets une carte en vente ;
- jusqu'à **3× le prix habituel de sa rareté**, elle est prise telle quelle. Entre 3× et 5×, seulement 60 % de l'écart sont comptés, pour les cartes recherchées dont la moyenne peut être gonflée. Au-delà de 5×, elle est plafonnée ;
- si la carte n'a jamais été vendue, il prend directement le prix habituel de sa rareté.

Le **prix habituel** de chaque rareté est appris tout seul en observant le marché. Il faut 8 observations par rareté pour commencer, en général quelques minutes. Tu peux aussi imposer ta propre valeur.

**Revente réaliste et concurrence.** Avant d'acheter, le bot regarde combien d'autres exemplaires de la même carte, **dans la même rareté**, sont en vente, et le prix du moins cher. Une copie C d'une carte ne concurrence pas sa version L. Il calcule le bénéfice sur un prix de revente réaliste : le pourcentage de la valeur auquel tes cartes partent vraiment, sans dépasser le prix du concurrent le moins cher. Une carte trop concurrencée (6 autres en vente ou plus), ou qui ne rapporterait pas assez à ce prix, est écartée.

À la revente, la carte est placée juste sous le concurrent le moins cher. Un concurrent qui brade ne la fait jamais descendre sous **50 % de sa valeur**, ni sous son prix d'achat, sauf si tu as autorisé la vente à perte.

**Taux de revente.** Le pourcentage auquel tes cartes partent vraiment est appris sur tes ventes des 7 derniers jours, à partir de la version 1.7 : il faut 8 ventes, avant cela le bot compte 70 %. Il ne sert qu'à décider d'acheter, pas à fixer les prix de vente. Jusqu'à la version 1.6, il fixait aussi le prix de départ : le bot vendait sous ce taux, le taux baissait, le bot vendait encore moins cher, et ainsi de suite jusqu'à n'acheter presque plus rien. Les ventes faites avant la 1.7 ne sont donc plus comptées.

Si le prix est **à moins de 50 %** de la valeur (réglable) et rapporte au moins **15** (réglable), l'enchère est **surveillée**. Le bot mise le minimum seulement **quand il reste moins de 40 s** (réglable), pour laisser moins de temps aux autres de surenchérir. Il commence par les affaires les plus rentables. S'il est dépassé, il resurenchérit jusqu'à 50 % de la valeur au maximum.

À la revente, les cartes qui rapportent le plus passent en premier. Une carte qui vaut 100 ou plus est mise en vente pour 30 min au lieu de la durée choisie, car elle a moins d'acheteurs potentiels. Mesuré le 01/10/2026 : en 30 min, ces cartes partent à 31 % et rapportent 43 par heure d'emplacement, contre 37 pour les autres en 10 min. Avec les réglages optimisés, cette règle est imposée. En mode manuel, la case **« 30 min pour les cartes de 100 ou plus »** permet de la couper.

Garde-fous du trading : prix max par carte, budget total, et **enchères réservées au trading**. Tu choisis dans Réglages combien d’enchères le bot mène en même temps (10 par défaut) : si tu en réserves 2 au trading, les cartes voulues n’en utiliseront jamais plus de 8.

À savoir : le site limite à **5 le nombre de cartes que tu mets en vente** en même temps (« Mes ventes x/5 »). Pour les enchères où tu mises, il ne semble pas y avoir de limite.

En option, le bot peut **revendre automatiquement** les cartes gagnées en trading : il les remet aux enchères avec leur valeur estimée comme mise de départ.
- Si une carte ne part pas, son prix **baisse de 15 %** (réglable) à chaque nouvelle mise en vente, sans descendre sous son prix d'achat, sauf si tu autorises la revente à perte après quelques invendus.
- **Stock maximum à revendre** (10 par défaut) : quand autant de cartes de trading attendent d'être revendues, le bot arrête d'acheter jusqu'à ce qu'il en ait écoulé. Ça évite de se retrouver avec plein de cartes qu'il n'arrive pas à vendre : tu n'as que 5 emplacements de vente.
- **Cartes dormantes 💤** : une carte restée invendue 3 fois d'affilée (réglable) devient dormante.
  - Elle passe **après toutes les autres** à la revente : elle n'a un emplacement que si aucune autre carte n'attend, et elle est alors mise en vente pour 10 min seulement, même si elle vaut 100 ou plus.
  - Elle **ne compte plus dans le stock maximum**, jusqu'à 10 cartes dormantes (réglable). Le bot continue donc d'acheter des cartes fraîches.
  - Pourquoi : sur une journée mesurée (01/10/2026), les cartes à leur 4e mise en vente ou plus rapportaient 3× moins par heure d'emplacement que les autres, et occupaient 39 % du temps de vente. Elles gardaient aussi le stock plein 42 % du temps, et dans ce cas le bot n'achetait presque plus.

En haut de l'onglet Trading, **Mon bénéfice** fait les comptes :
- **réalisé** : prix de revente − prix d'achat, pour les cartes revendues par le bot ;
- **potentiel** : valeur estimée − prix d'achat, pour les cartes pas encore revendues ;
- **dépensé et revendu** au total, avec le détail carte par carte.

Seules les cartes achetées **et** revendues par le bot sont comptées. Une carte revendue à la main reste « en stock ».

**Bilan et alertes.** Toutes les heures, le bot écrit dans le Journal un bilan du trading : combien d'enchères il a regardées, et pour chacune ce qui s'est passé (misée, surveillée, trop chère, bénéfice insuffisant, stock plein, budget atteint, réserve atteinte…). S'il n'a fait aucune mise de trading depuis 2 h, il le signale dans les Alertes, avec les raisons principales. Le journal téléchargé commence par l'état du bot : version, règles réellement appliquées, stock et taux de revente.

Une carte achetée en trading que tu veux garder : **mets-la en favori ★ ou dans une étiquette**. Le bot vise l'exemplaire exact qu'il a acheté : il le passe en « ⭐ gardée », le retire de la revente et du stock, et ne touche pas à tes autres copies de la même carte.

La valeur estimée reste une estimation : une carte peut valoir moins que sa moyenne passée. Commence avec un petit budget.

## Vente automatique

Dans Vente & tri, la vente automatique met en vente les raretés cochées dès qu'un emplacement se libère.
- Si une carte ne part pas, son prix **baisse de 10 %** (réglable) à la mise en vente suivante, sans descendre sous le prix plancher de sa rareté.
- Après **3 invendus d'affilée** (réglable), elle n'est plus remise en vente pendant 24 h, puis repart au prix plein. Elle ne bloque plus un emplacement en boucle.
- Une carte dont un exemplaire est dans le stock de trading n'est jamais mise en vente automatiquement : elle concurrencerait sa propre revente. Une seule copie d'une même carte est en vente à la fois.

## Défausse

Dans Vente & tri, l'option **« Seulement les cartes sorties des paquets »** (activée par défaut) limite la défausse automatique aux cartes que le bot vient de tirer en ouvrant un paquet, dans les raretés cochées. Le reste de ta collection n'est jamais touché. Les paquets que tu ouvres toi-même ne sont pas concernés.

## Tri des paquets par valeur

Une carte peu rare peut se vendre très cher : titre drôle, sujet célèbre… Après chaque ouverture de paquet, le bot regarde le **prix de vente moyen** de chaque carte :
- **au-dessus du seuil** (30 par défaut) : la carte est gardée et affichée dans « Dernières cartes intéressantes sorties des paquets » (onglet Vente & tri). En option, il la met en vente à son prix moyen ;
- **en dessous**, en option, il défausse les C, PC et R.

La défausse automatique par rareté épargne aussi les cartes de valeur.

## Ce que le bot ne fera jamais

- Vendre ou défausser une carte en **favori ★** ou **rangée dans une étiquette** de ta collection, une carte de ta liste « Cartes voulues » ou de ta liste « À garder ».
- Défausser une **SR, UR ou L**. Vendre une UR ou une L sans que tu l'aies explicitement autorisé.
- Faire descendre ton solde sous ta **réserve**, ou dépasser le prix max d'une carte.
- Contourner la **vérification anti-bot** du site. Si elle apparaît, quelle que soit l'action (mise en vente, mise, paquet, défausse), le bot s'arrête aussitôt et n'envoie plus aucune requête. Une seule alerte est notée dans le Journal. Tu fais la vérification toi-même sur le site, puis tu cliques Démarrer. Le 01/10/2026, le site l'a demandée à la mise en vente : la version 1.8.1 ne la reconnaissait pas et avait réessayé 1 905 fois en 77 minutes.

## Partager ses réglages

Réglages → **Copier mes réglages** : le bot crée un code `WMBOT1:…` à envoyer à un ami. De son côté, il colle le code puis clique **Importer**.

- **Tout est transféré à l'identique** : trading, vente et tri, paquets, prix max par rareté, réserve, rythme, liste « À garder »…
- **Sauf ce qui est personnel** : la liste des cartes voulues (chacun garde la sienne, même en important) et le mode simulation ou réel.
- Avant d'importer, le bot indique combien de réglages vont changer et demande confirmation. Après, il vérifie que chaque réglage a été repris exactement et le signale dans le Journal si ce n'est pas le cas.
- Utilisez la même version du bot : si les versions diffèrent, un avertissement le signale.

## Déblocage automatique (extension WikiMasters Clic)

Quand le site bloque les mises, les mises en vente ou les paquets, un clic fait à la main sur « Miser » le débloque. Le bot ne peut pas faire ce clic lui-même : pour le site, un clic fait par un script n'est pas un vrai clic. Depuis les versions 2.10 et 3.2, le bot peut le demander à la petite extension du dossier `wikimasters-clic`, qui clique comme une vraie souris. Plus besoin de macro UI Vision qui surveille l'écran.

1. Dans `chrome://extensions`, active le « Mode développeur », clique « Charger l'extension non empaquetée » et choisis le dossier `wikimasters-clic`.
2. Dans le bot, onglet **Réglages** → **Déblocage automatique** : l'extension doit apparaître comme détectée. Règle la page à ouvrir et le texte du bouton, puis clique « Tester maintenant » (le clic est réel).

À chaque blocage, jamais en simulation, l'extension ouvre la page dans un nouvel onglet, clique le bouton et lit la réponse du site à la mise. Pendant ce temps, Chrome affiche un bandeau « WikiMasters Clic a commencé à déboguer ce navigateur ». Le clic place une vraie mise, au minimum indiqué par la page.

- **Mise acceptée :** l'onglet se ferme, tu retrouves celui où tu étais, et le bot reprend aussitôt (en 2.x, sans attendre l'essai des 10 min).
- **Vérification humaine demandée :** la page ouvre sa fenêtre de vérification. Si elle ne passe pas d'elle-même, l'onglet reste ouvert et le bot te prévient : fais la vérification, la mise se place toute seule ensuite. L'extension ne touche pas à cette vérification, et ne reclique pas pendant 30 min.
- **Mise refusée** (ou aucune mise envoyée) : le message du site est noté dans le journal, et l'extension réessaie 2 min plus tard. Après 3 essais sans effet, elle ne réessaie plus que toutes les 15 min et le bot te prévient : une mise à la main débloque tout de suite.

Tant que l'extension s'en occupe, le bot n'affiche pas « À toi de jouer ». La version 1.0 de l'extension ne lisait pas la réponse du site : elle croyait réussis des clics que le site refusait. Mets-la à jour (bouton ↻ dans `chrome://extensions`).

## Rapport 24 h (version 2.10)

Onglet **Journal** → **📊 Rapport 24 h** : le bot télécharge un fichier `.html` à ouvrir dans le navigateur. On y trouve le bénéfice des reventes, les cartes achetées et revendues, les mises, les bonnes affaires repérées, les blocages anti-bot et les clics de l'extension sur les dernières 24 h, avec des graphiques heure par heure. Survole un graphique pour le détail ; « Voir les données » donne ses chiffres. Le journal ne garde que 2000 lignes, environ 12 h quand le bot tourne : le bot garde donc à part, pendant 26 h, ce dont le rapport a besoin. Le rapport complet est disponible un jour après l'installation ; avant, il indique depuis quand il a des données.

## À savoir

- Le bot ne tourne que tant qu'un onglet WikiMasters est ouvert. Avec plusieurs onglets ouverts, un seul fait tourner le bot ; les autres affichent son état.
- Le bot peut tourner dans un onglet en arrière-plan : ses minuteurs ne sont pas ralentis par Chrome. Il se cale aussi sur l'heure du site, même si l'horloge de ton PC est décalée.
- Depuis les versions 2.10 et 3.2, avec la case **Affichage au repos** (Réglages → Général, décochée par défaut), le panneau se met au repos quand personne n'a touché la souris ni le clavier depuis 1 min : ses animations s'arrêtent et l'accueil ne se met plus à jour que toutes les 10 s. Le bot, lui, ne ralentit pas. Ça compte surtout sur un navigateur sans carte graphique, comme celui du NAS, où chaque image animée coûte du processeur.
- L'automatisation n'est probablement pas autorisée par les règles de WikiMasters : **ton compte peut être bloqué**. Utilise-le à tes risques.
