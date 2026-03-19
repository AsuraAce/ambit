# Commit Types Reference

## Types

| Type | Use for |
|---|---|
| `feat` | New feature or system |
| `fix` | Bug fix |
| `refactor` | Code restructure with no behaviour change |
| `data` | Adding or modifying data files (bestiary, careers, content) |
| `docs` | Documentation only (GDD, TDD, KNOWLEDGE, rules, skills) |
| `test` | Adding or fixing tests |
| `style` | Formatting, whitespace, no logic change |
| `chore` | Build config, dependency updates, tooling |
| `perf` | Performance improvement |
| `revert` | Reverting a previous commit |

## Scope Examples

Scope is the system or area affected. Keep it short.

| Project area | Scope examples |
|---|---|
| Combat system | `combat`, `advantage`, `hit-location` |
| Enemy data | `bestiary`, `skaven`, `undead` |
| Career data | `careers`, `soldier`, `scholar` |
| Map / world | `mapgen`, `overmap`, `hex` |
| Rendering | `renderer`, `tileset`, `fov` |
| UI | `hud`, `character-sheet`, `inventory` |
| Backend / API | `api`, `server`, `gemini` |
| Database | `db`, `schema`, `migration` |
| Data services | `csv-import`, `categoriser`, `dedup` |
| State | `store`, `zustand` |
| Testing | `tests`, `vitest` |
| Config / build | `vite`, `tsconfig`, `deps` |

## Full Examples

```
feat(combat): implement opposed test resolution with advantage tracking

fix(fov): correct PreciseShadowcasting origin offset for row y=0

data(skaven): integrate Clanrat and Stormvermin with game metadata

refactor(enemy-adapter): simplify wounds derivation, remove redundant fallback

docs(tdd): update combat section with SL damage formula correction

test(combat): add edge case coverage for advantage cap at WB

chore(deps): upgrade vite to 6.2.1
```
