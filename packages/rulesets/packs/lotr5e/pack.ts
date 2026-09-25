/**
 * `lotr5e` — a 5e-compatible pack for games set in Middle-earth.
 *
 * **Structure only.** Field labels and sheet shape; no rules text, no bundled
 * content, no art, and no publisher's marks. The game it is compatible with is
 * not open, so the pack describes compatibility rather than claiming the name,
 * and the app marks it unofficial. See DECISIONS D-011 and D-018.
 *
 * Written first on purpose. It is the awkward pack — Shadow, Hope, Weary,
 * Callings — and if the format cannot carry those, that is worth finding out
 * with one pack written rather than three.
 *
 * Two rules in here are guesses, and both carry `unverified: true` so the app
 * says it is unsure instead of quietly deciding a rule at someone's table:
 * which Shadow path each Calling takes, and whether Weary changes a d20 test.
 */

import type { RulesetPack } from '../../src/pack.js'

const HEROIC_CULTURES = [
  'Bardings',
  'Dwarves of Durin’s Folk',
  'Elves of Lindon',
  'Hobbits of the Shire',
  'Men of Bree',
  'Rangers of the North',
]

const CALLINGS = ['Captain', 'Champion', 'Messenger', 'Scholar', 'Treasure Hunter', 'Warden']

const SHADOW_PATHS = ['Curse of Vengeance', 'Dragon-sickness', 'Lure of Power', 'Lure of Secrets']

const STANDARDS_OF_LIVING = ['Poor', 'Frugal', 'Martial', 'Prosperous', 'Rich']

const JOURNEY_ROLES = ['Guide', 'Scout', 'Hunter', 'Look-out']

/**
 * Inside an `abilityBlock` modifier, `@score` is that ability's score. Inside a
 * `skillList` modifier, `@mod` is the governing ability's modifier and `@rank`
 * the proficiency rank. Everything else resolves against the character. See
 * docs/RULESET_PACKS.md, "Scoped bindings".
 */
const ABILITY_MODIFIER = 'floor((@score - 10) / 2)'
const SKILL_MODIFIER = '@mod + @rank * @proficiency'

export const lotr5e: RulesetPack = {
  id: 'lotr5e',
  name: 'Middle-earth (5e-compatible)',
  version: '1.0.0',
  summary:
    'The 5e chassis with the Middle-earth layer on top: Heroic Culture, Calling, Shadow, Hope, Weary and Miserable. Sheet structure only — unofficial, and not affiliated with any publisher.',

  licence: {
    name: 'Unofficial — structure only',
    notice:
      'This is an unofficial, fan-made character sheet layout. It contains no rules text, no game content and no publisher’s marks, and is not affiliated with or endorsed by any publisher. You need the published game to play.',
  },

  theme: {
    // Ink on vellum, lit low — the map stays the brightest thing on screen.
    colors: {
      ground: '#100e0a',
      surface: '#1a1712',
      raised: '#231f18',
      sunken: '#0b0a07',
      line: '#3a3327',
      'line-soft': '#2a251c',
      ink: '#ece5d6',
      'ink-soft': '#a89c85',
      'ink-faint': '#756b58',
      accent: '#c8a45c',
      'accent-dim': '#8d7239',
      'accent-ink': '#17130c',
      good: '#7d9a5e',
      warn: '#c9a227',
      bad: '#b8543f',
    },
    fonts: {
      display: 'ui-serif, Georgia, "Iowan Old Style", "Palatino Linotype", serif',
      body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      mono: 'ui-monospace, "SF Mono", Menlo, "Cascadia Mono", monospace',
    },
    radius: '6px',
    texture: 'parchment',
  },

  dice: {
    defaultDie: 20,
    advantageModel: 'keep-highest',
    targetLabel: 'DC',
    criticalSuccess: [20],
    criticalFailure: [1],
    quickDice: ['1d4', '1d6', '1d8', '1d10', '1d12', '1d20', '2d6', '1d100'],
    modifiers: [
      {
        id: 'weary',
        label: 'Weary',
        whenField: 'weary',
        // Unconfirmed against the book. The UI shows this as a rule we are not
        // sure of; correcting it is a one-line edit here, not a code change.
        effect: { kind: 'treat-below-as', threshold: 10, value: 0 },
        unverified: true,
      },
    ],
  },

  sheet: {
    sections: [
      {
        id: 'identity',
        title: 'Character',
        fields: [
          { kind: 'text', key: 'name', label: 'Name', placeholder: 'Who are they?' },
          { kind: 'select', key: 'culture', label: 'Heroic Culture', options: HEROIC_CULTURES, allowCustom: true },
          { kind: 'select', key: 'calling', label: 'Calling', options: CALLINGS, allowCustom: true },
          { kind: 'number', key: 'level', label: 'Level', min: 1, max: 20 },
          { kind: 'number', key: 'proficiency', label: 'Proficiency', derived: '2 + floor((max(1, @level) - 1) / 4)' },
          {
            kind: 'select',
            key: 'standardOfLiving',
            label: 'Standard of Living',
            options: STANDARDS_OF_LIVING,
            allowCustom: true,
          },
          { kind: 'text', key: 'patron', label: 'Patron' },
          { kind: 'select', key: 'journeyRole', label: 'Journey role', options: JOURNEY_ROLES, allowCustom: true },
        ],
      },

      {
        id: 'abilities',
        title: 'Abilities',
        fields: [
          {
            kind: 'abilityBlock',
            key: 'abilities',
            abilities: [
              { key: 'str', label: 'Strength' },
              { key: 'dex', label: 'Dexterity' },
              { key: 'con', label: 'Constitution' },
              { key: 'int', label: 'Intelligence' },
              { key: 'wis', label: 'Wisdom' },
              { key: 'cha', label: 'Charisma' },
            ],
            modifier: ABILITY_MODIFIER,
            roll: { label: 'check', expression: '1d20 + @total' },
          },
        ],
      },

      {
        id: 'skills',
        title: 'Skills',
        fields: [
          {
            kind: 'skillList',
            key: 'skillProficiency',
            ranks: 3,
            modifier: SKILL_MODIFIER,
            roll: { label: 'check', expression: '1d20 + @total' },
            skills: [
              { key: 'acrobatics', label: 'Acrobatics', ability: 'dex' },
              { key: 'animalHandling', label: 'Animal Handling', ability: 'wis' },
              { key: 'athletics', label: 'Athletics', ability: 'str' },
              { key: 'deception', label: 'Deception', ability: 'cha' },
              { key: 'history', label: 'History', ability: 'int' },
              { key: 'insight', label: 'Insight', ability: 'wis' },
              { key: 'intimidation', label: 'Intimidation', ability: 'cha' },
              { key: 'investigation', label: 'Investigation', ability: 'int' },
              { key: 'medicine', label: 'Medicine', ability: 'wis' },
              { key: 'nature', label: 'Nature', ability: 'int' },
              { key: 'perception', label: 'Perception', ability: 'wis' },
              { key: 'performance', label: 'Performance', ability: 'cha' },
              { key: 'persuasion', label: 'Persuasion', ability: 'cha' },
              { key: 'religion', label: 'Religion', ability: 'int' },
              { key: 'sleightOfHand', label: 'Sleight of Hand', ability: 'dex' },
              { key: 'stealth', label: 'Stealth', ability: 'dex' },
              { key: 'survival', label: 'Survival', ability: 'wis' },
            ],
          },
        ],
      },

      {
        id: 'combat',
        title: 'In a fight',
        fields: [
          { kind: 'track', key: 'hp', label: 'Hit points' },
          { kind: 'number', key: 'tempHp', label: 'Temporary HP', min: 0 },
          { kind: 'number', key: 'armourClass', label: 'Armour Class', min: 0 },
          { kind: 'number', key: 'speed', label: 'Speed', min: 0 },
          {
            kind: 'repeater',
            key: 'attacks',
            label: 'Attacks',
            roll: { label: 'attack', expression: '1d20 + @bonus' },
            fields: [
              { kind: 'text', key: 'name', label: 'Attack' },
              { kind: 'number', key: 'bonus', label: 'To hit' },
              { kind: 'text', key: 'damage', label: 'Damage' },
              { kind: 'text', key: 'notes', label: 'Notes' },
            ],
          },
        ],
      },

      {
        id: 'hope',
        title: 'Hope',
        tone: 'highlight',
        fields: [{ kind: 'track', key: 'hope', label: 'Hope', resetOn: 'long-rest' }],
      },

      {
        id: 'shadow',
        title: 'Shadow',
        tone: 'grim',
        fields: [
          { kind: 'number', key: 'shadow', label: 'Shadow points', min: 0 },
          {
            kind: 'select',
            key: 'shadowPath',
            label: 'Shadow path',
            options: SHADOW_PATHS,
            allowCustom: true,
            // Unconfirmed. Offered as a suggestion, never filled in silently.
            suggest: {
              fromKey: 'calling',
              map: {
                Captain: 'Lure of Power',
                Champion: 'Lure of Secrets',
                Messenger: 'Dragon-sickness',
                Scholar: 'Curse of Vengeance',
                'Treasure Hunter': 'Dragon-sickness',
                Warden: 'Curse of Vengeance',
              },
              unverified: true,
            },
          },
          { kind: 'toggle', key: 'weary', label: 'Weary' },
          { kind: 'toggle', key: 'miserable', label: 'Miserable' },
        ],
      },

      {
        id: 'standing',
        title: 'Standing',
        fields: [
          { kind: 'number', key: 'valour', label: 'Valour', min: 0 },
          { kind: 'number', key: 'wisdom', label: 'Wisdom', min: 0 },
          { kind: 'longtext', key: 'virtues', label: 'Virtues' },
          { kind: 'longtext', key: 'rewards', label: 'Rewards' },
        ],
      },

      {
        id: 'gear',
        title: 'Gear',
        fields: [
          { kind: 'longtext', key: 'equipment', label: 'Equipment' },
          { kind: 'longtext', key: 'treasure', label: 'Treasure' },
        ],
      },

      {
        id: 'notes',
        title: 'Notes',
        fields: [
          { kind: 'longtext', key: 'features', label: 'Features' },
          { kind: 'longtext', key: 'notes', label: 'Notes' },
        ],
      },
    ],
  },

  // Names only. The pack ships no rules text, so a condition here is a label to
  // hang on a token, not a description of what it does.
  conditions: [
    { id: 'weary', label: 'Weary' },
    { id: 'miserable', label: 'Miserable' },
    { id: 'blinded', label: 'Blinded' },
    { id: 'charmed', label: 'Charmed' },
    { id: 'deafened', label: 'Deafened' },
    { id: 'frightened', label: 'Frightened' },
    { id: 'grappled', label: 'Grappled' },
    { id: 'incapacitated', label: 'Incapacitated' },
    { id: 'invisible', label: 'Invisible' },
    { id: 'paralysed', label: 'Paralysed' },
    { id: 'petrified', label: 'Petrified' },
    { id: 'poisoned', label: 'Poisoned' },
    { id: 'prone', label: 'Prone' },
    { id: 'restrained', label: 'Restrained' },
    { id: 'stunned', label: 'Stunned' },
    { id: 'unconscious', label: 'Unconscious' },
  ],

  tokenDefaults: {
    squares: 1,
    hpTrack: 'hp',
    colors: ['#c8a45c', '#7d9a5e', '#b8543f', '#6f9bd1', '#9a7bb8', '#c07f3f', '#8fa8a0', '#b0b6bd'],
    showHpToPlayers: false,
  },
}
