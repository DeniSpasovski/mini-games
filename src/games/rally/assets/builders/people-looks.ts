/** What a person can wear (people-wear.ts builds it, people.ts picks it per role). */

export type LegKind =
  | 'jeans'
  | 'slim'
  | 'chino'
  | 'cargo'
  | 'jogger'
  | 'leggings'
  | 'shorts'
  | 'bermuda'
  | 'capri'
  | 'skirt'
  | 'pleat'
  | 'plaid'
  | 'overall';

export type TopKind =
  'tee' | 'long' | 'polo' | 'hoodie' | 'jacket' | 'tank' | 'overall';

/** Team-colour patterns on a shirt (people-wear.ts `pattern`). */
export type Pattern =
  | 'none'
  | 'hoops'
  | 'chest'
  | 'triple'
  | 'yoke'
  | 'checker'
  | 'streaks'
  | 'diagonal'
  | 'rings';

/** Hairstyles (people-hair.ts): men's, women's and the ones both wear. */
export type HairStyle =
  | 'bald'
  | 'buzz'
  | 'crop'
  | 'sidepart'
  | 'quiff'
  | 'slick'
  | 'messy'
  | 'curly'
  | 'afro'
  | 'mohawk'
  | 'manbun'
  | 'long'
  | 'wavy'
  | 'bob'
  | 'bobbang'
  | 'pony'
  | 'bun'
  | 'lowbun'
  | 'braid'
  | 'pixie'
  | 'buns';

/** Footwear (people-shoes.ts). */
export type ShoeKind = 'sneaker' | 'shoe' | 'boot' | 'flat';
