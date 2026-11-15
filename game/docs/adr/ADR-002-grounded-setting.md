# ADR-002: A grounded 600–700 AD setting with no fantasy creatures

- **Status:** Accepted (owner decision, 2026-10-31)
- **Design document:** `Bardia_Design_and_Build_Plan.md` v0.2: §4.1, §4.2, §4.7, §8.6, §9.8, §12.2, §12.7, §19.2, §21, §22.6, §26.1, §35 (D1)
- **Supersedes:** the "mythic register" of design v0.1 (draugar, a frost-giant, the Barrow-King, sea-serpent and ghost-ship sightings)

## Context

Design v0.1 proposed a fictional Norse-inspired world in which the supernatural was "rare and ambiguous" but real: undead barrow guardians, a frost-giant boss, a Barrow-King duel, sea-serpent and ghost-ship encounters, and relics with powers that were framed as luck but implied magic.

The owner chose an invented Norse-inspired world that is **very 600–700 AD Earth-based, with no fantasy creatures**. That period is the Vendel-period North, the Anglo-Saxon heptarchy, Merovingian Francia, 7th-century Byzantium and the Avar/Bulgar steppe. It sits before the classic Viking Age, so period technology also differs from the usual Viking-game set dressing.

## Decision

1. **Invented world, real period.** Bardia keeps its own names, gods, cultures and map (§4), but its material culture, technology and politics are those of 600–700 AD. Real analogs are a writers' reference only and never appear in game text. No real historical place or person names are used.
2. **No supernatural beings and no working magic, anywhere.** That rules out undead, giants, dragons, sea-serpents and other monsters, ghosts, elves, trolls, spirits that appear, shape-changers, curses that work and spells that do anything.
3. **Belief is real to the characters.** The Old Ways, the Lantern, the River Spirits and the Golden Lantern rite are portrayed sincerely. Characters pray, sacrifice, swear on relics, read omens and fear divine anger.
4. **Mechanics model the human side of belief.** Gods' Favor, omens and relic effects stay mechanically real, but they abstract **morale, luck, prestige, loyalty and know-how**. They are never shown as divine action.
5. **Period technology.** Ships are oared and have only lately adopted the square sail. Mail and swords are rare elite kit. There are no crossbows and no couched-lance knights: Corvani cavalry are spear-and-javelin horsemen. Old imperial stone walls survive in some Corvani and Saraleonese cities. Saraleon's galleys use **sea-fire**, a Greek-fire-like naphtha weapon (real technology, not magic).

## Consequences

- **Content replaced (design v0.2):** draugar became barrow-wardens (hereditary human guardians); the frost-giant boss became a great bear (natural beast boss) together with the hermit clan of a mountain shrine; the Barrow-King boss duel became the Barrow-Warden champion (human) duel; the giant's cairn became a mountain shrine; the ghost-ship became a derelict plague ship; "mythic encounters" became "strange sightings" (whales, icebergs, a derelict, northern lights); the "haunted" delve modifier became "occupied by squatters"; wyrmfire became sea-fire.
- **Units changed:** Corvani Lancers became Horsemen (charge ×1.6) and Crossbowmen became Javelinmen; Eyjar Strand-Riders charge at ×1.5. New guardian units: Barrow-wardens, Hermit clansmen and the Great bear.
- **Relics** keep their effects. Each has an in-world basis in prestige, morale, loyalty or the know-how of the people who come with it (design §21.2). Legend hooks are written as what people believe.
- **Data and code:** no unit, site, event or storylet may carry a supernatural flag or behaviour. Content validation SHOULD reject banned unit or site kinds (for example `undead`, `giant`, `ghost`), and the content schemas list only human, animal and hazard guardian kinds.
- **Tone:** the setting reads as historical fiction with a saga voice. Wonder comes from landscape, weather, the sea, faith and human deeds.
- **Trade-off:** we lose monster spectacle as an easy boss-fight source. Climactic encounters must come from champions, fortified sites, beasts and natural hazards.

## Content rules

### For writers
- Report belief as belief: "The crew swear the raven is Valgrim's," not "Valgrim sends a raven."
- Skalds, seers and priests may tell myths, saints' lives and wonder-tales as stories. Legend hooks use framing such as *said to*, *men say*, *the tale goes*. The game never confirms a myth.
- Omens and "signs" are read from natural things (birds, weather, bones, comets, eclipses), and the narration never says the reading came true because of a god.
- Seers are cryptic, and they can be wrong; nobody is ever shown seeing the future.
- Miracles at cloisters are *proclaimed*, *claimed* or *believed*. Pilgrims and silver flock to them either way.
- Strange sights always have a natural explanation available: a derelict ship (plague, mutiny, storm), the northern lights, a comet, whales, icebergs, a robbed barrow.
- No anachronisms of technology: no crossbows, no couched lances or knights in plate, no full-rigged ships, no gunpowder. Mail and swords mark wealth and rank.
- No real-world place or person names in game text. The analog column in design §4.2 stays internal.

### For designers
- Every enemy is a **human** (warriors, outlaws, wreckers, squatters, barrow-wardens, hermit clans, champions) or a **natural animal** (wolves, a great bear, boars, walrus). There are no supernatural guardian types.
- Every hazard is **natural**: tides, flooding, cold, ice, avalanche, collapse, fire, smoke, bad air in caves, disease, storms.
- Favor, omens and relic modifiers must be explainable as morale, luck, prestige, loyalty or know-how. Write the explanation into the tooltip or Codex entry.
- A guardian may be "fearless" or "never rout" only for a human reason (oath, kin, a sacred duty, the barrow they guard), and the condition must be breakable (for example, barrow-wardens rout normally once their barrow is breached).
- Boss fights are human champions, fortified positions, beasts and hazards, alone or in combination.
- Sea-fire is a limited, costly state weapon of Saraleon, not a spell. It burns hulls and morale and follows the same rules as other fire.

### For artists and audio
- No monsters, glowing runes, auras, spectral effects, magic particles or "power-up" glows on relics. Relics look like real crafted objects: worn, repaired, valuable.
- Depict 7th-century material culture: Vendel-style helmets for the elite, many men in caps and padded or leather armour, round shields, spears as the main weapon, seaxes, bows, javelins; oared ships with modest square sails; timber halls and earthworks; stone only where old imperial walls survive.
- Omens can be shown as natural phenomena (a comet, an eclipse, ravens, the northern lights) with no added supernatural glow.
- Music and SFX may evoke awe and ritual (horns, chant, drums), but no "magic" stingers tied to supernatural events.
