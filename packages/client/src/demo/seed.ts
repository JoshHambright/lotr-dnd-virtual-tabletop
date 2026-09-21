/**
 * A table mid-session, so the demo opens onto something worth looking at
 * rather than an empty grid.
 *
 * It deliberately contains things a player must not see — a staged scene, a
 * hidden ambusher, a stat block, GM notes, a roll made behind the screen — so
 * that switching seats demonstrates the filtering rather than describing it.
 */

import { emptyRoom, newCharacter, newScene, newStatBlock, newToken, reduce } from '@vtt/core'
import type { Op, RoomState } from '@vtt/core'
import { paint } from '@vtt/core'

export function seedDemoRoom(): RoomState {
  const tavern = newScene('tavern', 'The Prancing Pony', 1400, 1000, null)
  tavern.grid = { ...tavern.grid, size: 70 }
  tavern.gmNotes = 'Strider is watching from the corner. He speaks on turn 3.'
  tavern.fog = {
    enabled: true,
    // The company has explored the common room but not the back passage.
    mask: paint(tavern.fog.mask, { kind: 'circle', x: 560, y: 470, radius: 330 }, true),
  }

  const weathertop = newScene('weathertop', 'Weathertop, after dark', 1400, 1000, null)
  weathertop.gmNotes = 'Five Nazgûl close in from the east once the fire is lit.'

  const frodo = {
    ...newCharacter('c-frodo', 'Frodo', 'You'),
    culture: 'Hobbits of the Shire',
    calling: 'Treasure Hunter',
  }
  frodo.level = 3
  frodo.abilities = { str: 8, dex: 16, con: 12, int: 12, wis: 13, cha: 14 }
  frodo.skillProficiency = { stealth: 2, perception: 1, insight: 1 }
  frodo.maxHp = 22
  frodo.currentHp = 17
  frodo.armourClass = 13
  frodo.speed = 25
  frodo.hope = 3
  frodo.maxHope = 3
  frodo.shadow = 1
  frodo.shadowPath = 'Dragon-sickness'
  frodo.standardOfLiving = 'Frugal'
  frodo.journeyRole = 'Scout'
  frodo.equipment = 'Sting, mithril shirt (unworn), a letter from Gandalf'
  frodo.gmNotes = 'He is bearing the Ring. Tempt him when the company is cornered.'

  const sam = { ...newCharacter('c-sam', 'Sam', 'Sam'), culture: 'Hobbits of the Shire', calling: 'Warden' }
  sam.level = 3
  sam.abilities = { str: 12, dex: 12, con: 14, int: 9, wis: 13, cha: 11 }
  sam.maxHp = 26
  sam.currentHp = 26
  sam.armourClass = 14

  const ops: Op[] = [
    { t: 'settings.update', patch: { name: 'The Ring Goes South' } },
    { t: 'scene.create', scene: tavern },
    { t: 'scene.create', scene: weathertop },
    { t: 'scene.setActive', id: 'tavern' },

    { t: 'character.upsert', character: frodo },
    { t: 'character.upsert', character: sam },

    {
      t: 'token.create',
      token: newToken('t-frodo', 'tavern', 455, 435, {
        label: 'Frodo',
        characterId: 'c-frodo',
        color: '#5b7f52',
        hp: 17,
        maxHp: 22,
      }),
    },
    {
      t: 'token.create',
      token: newToken('t-sam', 'tavern', 525, 435, {
        label: 'Sam',
        characterId: 'c-sam',
        color: '#3f6b8f',
        hp: 26,
        maxHp: 26,
      }),
    },
    {
      t: 'token.create',
      token: newToken('t-strider', 'tavern', 735, 645, { label: 'Hooded man', color: '#6a5a8c' }),
    },

    // Staged out of sight: the GM decides when he shows himself.
    {
      t: 'token.create',
      token: newToken('t-ferny', 'tavern', 805, 295, {
        label: 'Bill Ferny',
        color: '#a33d3d',
        hidden: true,
        statBlockId: 'sb-spy',
        hp: 9,
        maxHp: 9,
        showHpToPlayers: false,
      }),
    },

    {
      t: 'statblock.upsert',
      statBlock: {
        ...newStatBlock('sb-spy', 'Bill Ferny'),
        kind: 'Spy of Isengard',
        attacks: 'Knife +4 (1d4+2)',
        notes: 'Flees once reduced below half.',
      },
    },
    {
      t: 'statblock.upsert',
      statBlock: {
        ...newStatBlock('sb-orc', 'Orc of the White Hand'),
        maxHp: 15,
        armourClass: 14,
        attacks: 'Scimitar +4 (1d6+2)',
      },
    },
    {
      t: 'encounter.upsert',
      encounter: {
        id: 'e-ambush',
        name: 'Ambush at Weathertop',
        notes: 'Trigger when the fire is lit.',
        members: [{ statBlockId: 'sb-orc', count: 4 }],
      },
    },

    {
      t: 'chat.add',
      message: {
        id: 'm1',
        at: Date.now() - 400_000,
        by: 'Sam',
        text: 'I do not like the look of that man in the corner.',
        visibility: 'public',
      },
    },
    {
      t: 'chat.add',
      message: {
        id: 'm2',
        at: Date.now() - 300_000,
        by: 'GM',
        text: 'Ferny slips out the back once they sit down.',
        visibility: 'gm',
      },
    },
  ]

  return ops.reduce(reduce, emptyRoom('The Ring Goes South'))
}
