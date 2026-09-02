# PR127 — Disponibilités Errebot

Pour un tournoi importé depuis Errebot :

- la structure sportive importée concerne uniquement la phase de poules ;
- le classeur Excel de disponibilités peut contenir deux matrices : `Poules` et `Phases finales` ;
- l'onglet `Phases finales` n'importe aucun match, seed, tableau ou résultat Errebot ;
- les disponibilités finales sont conservées comme contraintes afin que Pelote Manager puisse générer puis planifier son propre tableau final lorsque les qualifiés sont connus ;
- l'import des disponibilités ne modifie jamais le planning de poules déjà publié.
