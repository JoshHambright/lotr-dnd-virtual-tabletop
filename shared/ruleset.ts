/**
 * Data for The Lord of the Rings Roleplaying (Free League, 5e).
 *
 * The 5e chassis is standard — six abilities, proficiency bonus, the usual
 * skill list — so only the Middle-earth layer is spelled out here. Anything
 * the table rules differently is a free-text field on the sheet rather than
 * an enum, because a VTT that argues with the GM is worse than one that
 * forgets a rule.
 */

export const HEROIC_CULTURES = [
  'Bardings',
  'Dwarves of Durin’s Folk',
  'Elves of Lindon',
  'Hobbits of the Shire',
  'Men of Bree',
  'Rangers of the North',
] as const

export const CALLINGS = [
  'Captain',
  'Champion',
  'Messenger',
  'Scholar',
  'Treasure Hunter',
  'Warden',
] as const

/** Each Calling has its own Shadow path — how the character frays under strain. */
export const SHADOW_PATHS: Record<string, string> = {
  Captain: 'Lure of Power',
  Champion: 'Lure of Secrets',
  Messenger: 'Dragon-sickness',
  Scholar: 'Curse of Vengeance',
  'Treasure Hunter': 'Dragon-sickness',
  Warden: 'Curse of Vengeance',
}

export const STANDARDS_OF_LIVING = [
  'Poor',
  'Frugal',
  'Martial',
  'Prosperous',
  'Rich',
] as const

/** Roles taken up while the company is on the road. */
export const JOURNEY_ROLES = ['Guide', 'Scout', 'Hunter', 'Look-out'] as const

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type Ability = (typeof ABILITIES)[number]

export const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

export const SKILLS: { key: string; name: string; ability: Ability }[] = [
  { key: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
  { key: 'animalHandling', name: 'Animal Handling', ability: 'wis' },
  { key: 'athletics', name: 'Athletics', ability: 'str' },
  { key: 'deception', name: 'Deception', ability: 'cha' },
  { key: 'history', name: 'History', ability: 'int' },
  { key: 'insight', name: 'Insight', ability: 'wis' },
  { key: 'intimidation', name: 'Intimidation', ability: 'cha' },
  { key: 'investigation', name: 'Investigation', ability: 'int' },
  { key: 'medicine', name: 'Medicine', ability: 'wis' },
  { key: 'nature', name: 'Nature', ability: 'int' },
  { key: 'perception', name: 'Perception', ability: 'wis' },
  { key: 'performance', name: 'Performance', ability: 'cha' },
  { key: 'persuasion', name: 'Persuasion', ability: 'cha' },
  { key: 'religion', name: 'Religion', ability: 'int' },
  { key: 'sleightOfHand', name: 'Sleight of Hand', ability: 'dex' },
  { key: 'stealth', name: 'Stealth', ability: 'dex' },
  { key: 'survival', name: 'Survival', ability: 'wis' },
]

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4)
}

export function formatModifier(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`
}
