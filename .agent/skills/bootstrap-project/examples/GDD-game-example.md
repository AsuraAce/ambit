# Game Design Document — Depths of Ironhaven
**Version:** 0.2
**Phase:** 1 — Core Loop
**Last Updated:** 2026-03-01
**AI Dev Note:** This document is written for an AI coding assistant.
Paste at session start when working on game mechanics, content, or systems.
Paste the TDD alongside this for implementation sessions.

---

## Elevator Pitch
A browser-based roguelike set in a Victorian steampunk city. Solo character, permadeath, turn-based. The player descends through the criminal underworld of Ironhaven — from street level to the machine-filled depths beneath the city. Inspired by ADOM and Caves of Qud. Depth over spectacle.

---

## Design Pillars
These principles guide every design decision. When in doubt, return to these.

1. **Every run tells a story** — Character background and choices shape what the player encounters.
2. **Systems depth over content breadth** — A few interlocking systems beat a long feature list.
3. **Failure is interesting** — Death should feel meaningful, not punishing.
4. **No filler** — Every mechanic must earn its place. Cut anything that doesn't create decisions.

---

## Core Loop
What does the player do every 5 minutes?

1. Explore a procedurally generated district floor
2. Encounter enemies, traps, environmental hazards
3. Manage limited resources (health, ammunition, tools)
4. Find gear, clues, and faction contacts
5. Choose: push deeper or escape to the surface to recover

---

## Mechanical Foundation

### Resolution System
All actions resolved via d100 roll-under skill checks.
- Success = roll ≤ skill value
- Margin of success = (skill − roll) / 10, rounded down
- Opposed checks: highest positive margin wins; ties go to defender

### Combat
- Bump-to-attack on enemy tile initiates combat
- Attack roll vs target's Defence (derived from Agility + armour)
- Damage = weapon base + margin of success − target's Toughness (min 1)
- Critical hit on roll ≤ skill / 2: double margin of success
- No hit points below 0 — at 0 HP, roll on Injury table

### Key Derived Stats
```
Defence     = floor(Agility / 10) + armour value
Toughness   = floor(Endurance / 10)
Carry       = floor(Strength / 10) × 2   (item slots)
Initiative  = Agility value (higher acts first)
```

### Character Backgrounds
Three starting backgrounds: Enforcer, Smuggler, Tinkerer.
Each gives different starting skills, gear, and faction relationships.
Asymmetric starts — Enforcers start on surface, Smugglers start mid-depth.

---

## Content Structure

### World Layout
- 6 district floors per run (surface → depths)
- Each floor: one procedurally generated map + one fixed landmark
- Floors increase in danger, complexity, and reward
- One boss encounter per floor (skippable via alternate routes)

### Factions (Phase 2+)
Three factions: City Watch, The Guild, The Mechanists.
Reputation system affects NPC dialogue, shop prices, quest availability.
Not in Phase 1 — placeholder NPCs only.

### Districts (Phase 1 scope)
- The Warrens (floors 1–2) — cramped corridors, rat catchers, petty thieves
- The Foundry (floors 3–4) — industrial, automatons, steam vents
- The Depths (floors 5–6) — unknown, Phase 2

---

## Scope and Phases

### Phase 1 — Core Loop (current)
- [ ] One background fully playable (Enforcer)
- [ ] Two district floors (The Warrens only)
- [ ] Full combat system (attack, defence, injury table)
- [ ] Basic inventory (carry limit, equip/unequip)
- [ ] Permadeath + run restart
- [ ] Minimal HUD (HP, inventory count, floor depth)
- [ ] Procedural map generation (rooms + corridors)
- [ ] 5 enemy types with distinct behaviours

### Phase 2 — Content + Factions
- All three backgrounds
- Full 6-floor depth
- Faction reputation system
- Shop and services at surface
- Saving and run history

### Phase 3 — Polish + Meta
- Meta-progression (unlocks between runs)
- Full faction questlines
- Steam and gas environmental hazards
- Controller support

---

## Out of Scope — Permanent
These will not be built regardless of phase.

- **Multiplayer** — solo experience only, architecture will not support it
- **Real-time combat** — turn-based is a design pillar, not a constraint
- **Procedural narrative** — hand-authored story beats only, no AI generation
- **Mobile** — browser desktop only

---

## Open Questions
Decisions not yet made. The AI must not guess at these — ask the user.

- Win condition: reach floor 6 boss? Retrieve a specific artefact? Escape alive?
- Injury table: permanent injuries only, or temporary recovery possible?
- Does player retain anything between runs, or pure roguelike (no meta-progression until Phase 3)?
