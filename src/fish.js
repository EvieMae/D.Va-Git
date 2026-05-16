// ═══════════════════════════════════════════════════════════════════════
//  FISH — "Fishing Incremental" clone, per GDD.
//  Triggered by holding Ctrl and typing F-I-S-H.
//
//  Loop:  Cast (costs energy) → Bite-indicator minigame (perfect zone) →
//         Reel-in click minigame (DPS, Heat, crits) → Catch + reward →
//         repeat until Energy=0 → End of Day → next day.
//  Meta:  Zones (own XP/level), Fish mastery (own XP/level, skews rarity),
//         Skill tree (additive/multiplicative stats), Fish Log.
//  All names/numbers/art are original.
// ═══════════════════════════════════════════════════════════════════════

(() => {
  // ───────────────────────── Data ─────────────────────────
  const RARITIES = [
    { id: 'common',    label: 'Common',    color: '#9aa3b2', valueMul: 1 },
    { id: 'uncommon',  label: 'Uncommon',  color: '#56c46a', valueMul: 2.5 },
    { id: 'rare',      label: 'Rare',      color: '#4d8def', valueMul: 6 },
    { id: 'epic',      label: 'Epic',      color: '#a85cf5', valueMul: 18 },
    { id: 'legendary', label: 'Legendary', color: '#f6c84b', valueMul: 60 },
  ];
  const RARITY_BY_ID = Object.fromEntries(RARITIES.map(r => [r.id, r]));

  // Per-species record. xpPer = XP awarded per catch toward mastery.
  const SPECIES = [
    // — Forest Pond
    { id: 'minnow',  name: 'Minnow',         emoji: '🐟', zone: 'pond',  baseValue: 3,   xpPer: 4 },
    { id: 'perch',   name: 'River Perch',    emoji: '🐠', zone: 'pond',  baseValue: 6,   xpPer: 6 },
    { id: 'frog',    name: 'Pond Frog',      emoji: '🐸', zone: 'pond',  baseValue: 9,   xpPer: 8 },
    { id: 'catfish', name: 'Mossy Catfish',  emoji: '🐡', zone: 'pond',  baseValue: 18,  xpPer: 12 },
    // — River
    { id: 'trout',   name: 'Rainbow Trout',  emoji: '🐠', zone: 'river', baseValue: 22,  xpPer: 14 },
    { id: 'bass',    name: 'Smallmouth Bass',emoji: '🐟', zone: 'river', baseValue: 30,  xpPer: 16 },
    { id: 'eel',     name: 'River Eel',      emoji: '🐍', zone: 'river', baseValue: 48,  xpPer: 20 },
    { id: 'pike',    name: 'Northern Pike',  emoji: '🐡', zone: 'river', baseValue: 70,  xpPer: 24 },
    // — Deep Sea
    { id: 'salmon',  name: 'King Salmon',    emoji: '🐠', zone: 'deep',  baseValue: 110, xpPer: 30 },
    { id: 'marlin',  name: 'Blue Marlin',    emoji: '🐡', zone: 'deep',  baseValue: 200, xpPer: 38 },
    { id: 'sword',   name: 'Swordfish',      emoji: '🗡', zone: 'deep',  baseValue: 380, xpPer: 50 },
    { id: 'octo',    name: 'Deep Octopus',   emoji: '🐙', zone: 'deep',  baseValue: 600, xpPer: 60 },
    // — Frozen Trench (endgame)
    { id: 'glacier', name: 'Glacier Cod',    emoji: '🐟', zone: 'ice',   baseValue: 950, xpPer: 80 },
    { id: 'narwhal', name: 'Pale Narwhal',   emoji: '🦄', zone: 'ice',   baseValue: 1700, xpPer: 110 },
    { id: 'levi',    name: 'Leviathan',      emoji: '🐉', zone: 'ice',   baseValue: 4200, xpPer: 200 },
  ];
  const SPECIES_BY_ID = Object.fromEntries(SPECIES.map(s => [s.id, s]));

  const ZONES = [
    { id: 'pond',  name: 'Forest Pond',   unlockCost: 0,     waterTop: '#5fb6d6', waterBot: '#103b66', sky: '#7fbfe6' },
    { id: 'river', name: 'Wild River',    unlockCost: 400,   waterTop: '#3a9c7a', waterBot: '#0e3a2c', sky: '#a8d8b8' },
    { id: 'deep',  name: 'Deep Sea',      unlockCost: 4500,  waterTop: '#1f4f8a', waterBot: '#040b1a', sky: '#3a5478' },
    { id: 'ice',   name: 'Frozen Trench', unlockCost: 35000, waterTop: '#9cd8e8', waterBot: '#1c4258', sky: '#cfeaf2' },
  ];
  const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]));

  // Stat modifiers — a compact subset of the GDD's enum that drives real logic.
  // base value -> applied via additive then multiplicative through getStat().
  const STATS = [
    'click_power',      // additive flat click damage
    'click_power_mul',  // multiplicative
    'crit_chance',      // 0..1
    'crit_mult',        // crit damage multiplier
    'reaction_time',    // bite bar speed (lower = easier). 1.0 baseline.
    'perfect_zone',     // perfect-zone width multiplier
    'fish_value_mul',   // gold multiplier
    'rare_chance',      // additive bias toward rarer (per rarity tier weight)
    'max_energy',       // additive to base 20
    'auto_clicks',      // passive clicks/sec
    'double_catch',     // 0..1 chance of x2 fish
    'xp_mul',           // global XP multiplier
    'heat_decay',       // multiplier on tension fall rate (negative = slower)
  ];

  // The skill tree. Positions (x,y) are absolute on a 800×640 canvas; the
  // renderer draws SVG edges from each prereq → child and HTML nodes on top.
  // Nodes only appear once all of their prereqs are owned.
  const SKILLS = [
    // ── Roots ─────────────────────────────────────────────────────────
    // CENTER ROOT — the seed node; every branch grows from here.
    { id: 'root',  icon: '⭐', name: 'Start',        desc: 'Begin the tree. Every branch grows from here.', cost: 0,      prereq: [],         effect: {} },
    // POWER (west) — click damage + auto-clicks
    { id: 'pow1',  icon: '👊', name: '+1 Click',     desc: '+1 Click Power.',                     cost: 25,     prereq: ['root'],   effect: { click_power: 1 } },
    { id: 'pow2',  icon: '👊', x: 140, y: 180,  name: '+2 Click',     desc: '+2 Click Power.',                     cost: 90,     prereq: ['pow1'],   effect: { click_power: 2 } },
    { id: 'pow3',  icon: '👊', x: 140, y: 290,  name: '+3 Click',     desc: '+3 Click Power.',                     cost: 260,    prereq: ['pow2'],   effect: { click_power: 3 } },
    { id: 'pow4',  icon: '💪', x: 140, y: 400,  name: '×1.3 Click',   desc: '×1.3 Click Power.',                   cost: 600,    prereq: ['pow3'],   effect: { click_power_mul: 0.3 } },
    { id: 'pow5',  icon: '👊', x: 140, y: 510,  name: '+5 Click',     desc: '+5 Click Power.',                     cost: 1500,   prereq: ['pow4'],   effect: { click_power: 5 } },
    { id: 'pow6',  icon: '💪', x: 140, y: 620,  name: '×1.5 Click',   desc: '×1.5 Click Power.',                   cost: 4000,   prereq: ['pow5'],   effect: { click_power_mul: 0.5 } },
    { id: 'pow7',  icon: '⚙',  x: 140, y: 730,  name: 'Auto +1/s',    desc: '+1 auto-click per second.',           cost: 10000,  prereq: ['pow6'],   effect: { auto_clicks: 1 } },
    { id: 'pow8',  icon: '💪', x: 140, y: 840,  name: '×2 Click',     desc: '×2 Click Power.',                     cost: 28000,  prereq: ['pow7'],   effect: { click_power_mul: 1.0 } },
    { id: 'pow9',  icon: '⚙',  x: 140, y: 950,  name: 'Auto +2/s',    desc: '+2 auto-clicks per second.',          cost: 80000,  prereq: ['pow8'],   effect: { auto_clicks: 2 } },
    { id: 'pow10', icon: '💪', x: 140, y: 1060, name: '×3 Click',     desc: '×3 Click Power.',                     cost: 250000, prereq: ['pow9'],   effect: { click_power_mul: 2.0 } },

    // CRITICAL (col 1)
    // CRITICAL (north-west)
    { id: 'cr1',   icon: '🎯', name: 'Crit +5%',     desc: '+5% Critical Chance.',                cost: 80,     prereq: ['root'],   effect: { crit_chance: 0.05 } },
    { id: 'cr2',   icon: '💥', x: 300, y: 180,  name: 'CritDmg +0.5', desc: '+0.5 Critical Damage.',               cost: 220,    prereq: ['cr1'],    effect: { crit_mult: 0.5 } },
    { id: 'cr3',   icon: '🎯', x: 300, y: 290,  name: 'Crit +5%',     desc: '+5% Critical Chance.',                cost: 550,    prereq: ['cr2'],    effect: { crit_chance: 0.05 } },
    { id: 'cr4',   icon: '💥', x: 300, y: 400,  name: 'CritDmg +1',   desc: '+1.0 Critical Damage.',               cost: 1300,   prereq: ['cr3'],    effect: { crit_mult: 1.0 } },
    { id: 'cr5',   icon: '🎯', x: 300, y: 510,  name: 'Crit +10%',    desc: '+10% Critical Chance.',               cost: 3200,   prereq: ['cr4'],    effect: { crit_chance: 0.10 } },
    { id: 'cr6',   icon: '💥', x: 300, y: 620,  name: 'CritDmg +2',   desc: '+2.0 Critical Damage.',               cost: 8000,   prereq: ['cr5'],    effect: { crit_mult: 2.0 } },
    { id: 'cr7',   icon: '🎯', x: 300, y: 730,  name: 'Crit +10%',    desc: '+10% Critical Chance.',               cost: 20000,  prereq: ['cr6'],    effect: { crit_chance: 0.10 } },
    { id: 'cr8',   icon: '💥', x: 300, y: 840,  name: 'CritDmg +3',   desc: '+3.0 Critical Damage.',               cost: 50000,  prereq: ['cr7'],    effect: { crit_mult: 3.0 } },
    { id: 'cr9',   icon: '🎯', x: 300, y: 950,  name: 'Crit +15%',    desc: '+15% Critical Chance.',               cost: 130000, prereq: ['cr8'],    effect: { crit_chance: 0.15 } },
    { id: 'cr10',  icon: '💥', x: 300, y: 1060, name: 'CritDmg +5',   desc: '+5.0 Critical Damage.',               cost: 320000, prereq: ['cr9'],    effect: { crit_mult: 5.0 } },

    // TENSION (col 2) — slower drain, larger max, click/crit restore
    // TENSION (south-west)
    { id: 'tn1',   icon: '🔗', name: 'Tension -15%', desc: 'Tension drops 15% slower.',           cost: 150,    prereq: ['root'],   effect: { heat_decay: -0.15 } },
    { id: 'tn2',   icon: '🧲', x: 460, y: 180,  name: 'Max +20',      desc: '+20 max Tension.',                    cost: 400,    prereq: ['tn1'],    effect: { heat_max: 20 } },
    { id: 'tn3',   icon: '🔗', x: 460, y: 290,  name: 'Tension -20%', desc: 'Tension drops 20% slower.',           cost: 900,    prereq: ['tn2'],    effect: { heat_decay: -0.20 } },
    { id: 'tn4',   icon: '⚡', x: 460, y: 400,  name: 'Click +50%',   desc: 'Clicks restore +50% Tension.',        cost: 2200,   prereq: ['tn3'],    effect: { click_tension: 0.5 } },
    { id: 'tn5',   icon: '🧲', x: 460, y: 510,  name: 'Max +30',      desc: '+30 max Tension.',                    cost: 5500,   prereq: ['tn4'],    effect: { heat_max: 30 } },
    { id: 'tn6',   icon: '🔗', x: 460, y: 620,  name: 'Tension -25%', desc: 'Tension drops 25% slower.',           cost: 13000,  prereq: ['tn5'],    effect: { heat_decay: -0.25 } },
    { id: 'tn7',   icon: '⚡', x: 460, y: 730,  name: 'Crit Tension', desc: 'Crits restore +6 Tension.',           cost: 32000,  prereq: ['tn6'],    effect: { crit_tension: 6 } },
    { id: 'tn8',   icon: '🧲', x: 460, y: 840,  name: 'Max +50',      desc: '+50 max Tension.',                    cost: 80000,  prereq: ['tn7'],    effect: { heat_max: 50 } },
    { id: 'tn9',   icon: '🔗', x: 460, y: 950,  name: 'Tension -35%', desc: 'Tension drops 35% slower.',           cost: 200000, prereq: ['tn8'],    effect: { heat_decay: -0.35 } },
    { id: 'tn10',  icon: '🛡', x: 460, y: 1060, name: 'Floor 10',     desc: 'Tension never falls below 10.',       cost: 500000, prereq: ['tn9'],    effect: { heat_floor: 10 } },

    // LURE (col 3) — bite minigame
    // LURE (north-east)
    { id: 'lu1',   icon: '🎣', name: 'Zone +15%',    desc: '+15% Perfect Zone size.',             cost: 90,     prereq: ['root'],   effect: { perfect_zone: 0.15 } },
    { id: 'lu2',   icon: '🪝', x: 620, y: 180,  name: 'Bar -15%',     desc: 'Bite bar 15% slower.',                cost: 200,    prereq: ['lu1'],    effect: { reaction_time: -0.15 } },
    { id: 'lu3',   icon: '🎣', x: 620, y: 290,  name: 'Zone +20%',    desc: '+20% Perfect Zone size.',             cost: 550,    prereq: ['lu2'],    effect: { perfect_zone: 0.20 } },
    { id: 'lu4',   icon: '🪝', x: 620, y: 400,  name: 'Bar -20%',     desc: 'Bite bar 20% slower.',                cost: 1400,   prereq: ['lu3'],    effect: { reaction_time: -0.20 } },
    { id: 'lu5',   icon: '🦗', x: 620, y: 510,  name: 'Head Start',   desc: 'Perfect catch starts +10% progress.', cost: 3500,   prereq: ['lu4'],    effect: { start_progress: 0.10 } },
    { id: 'lu6',   icon: '🎣', x: 620, y: 620,  name: 'Zone +25%',    desc: '+25% Perfect Zone size.',             cost: 9000,   prereq: ['lu5'],    effect: { perfect_zone: 0.25 } },
    { id: 'lu7',   icon: '🪝', x: 620, y: 730,  name: 'Bar -25%',     desc: 'Bite bar 25% slower.',                cost: 22000,  prereq: ['lu6'],    effect: { reaction_time: -0.25 } },
    { id: 'lu8',   icon: '🎣', x: 620, y: 840,  name: 'Zone +40%',    desc: '+40% Perfect Zone size.',             cost: 55000,  prereq: ['lu7'],    effect: { perfect_zone: 0.40 } },
    { id: 'lu9',   icon: '🦗', x: 620, y: 950,  name: 'Big Start',    desc: 'Perfect catch starts +20% progress.', cost: 140000, prereq: ['lu8'],    effect: { start_progress: 0.20 } },
    { id: 'lu10',  icon: '🪝', x: 620, y: 1060, name: 'Auto-hook',    desc: '+10% chance bites auto-hook.',        cost: 350000, prereq: ['lu9'],    effect: { auto_hook: 0.10 } },

    // MARKET (col 4) — gold, double / triple catch
    // MARKET (east)
    { id: 'mk1',   icon: '💰', name: 'Value +15%',   desc: '+15% Fish Value.',                    cost: 200,    prereq: ['root'],   effect: { fish_value_mul: 0.15 } },
    { id: 'mk2',   icon: '💵', x: 780, y: 180,  name: 'Double +5%',   desc: '+5% Double Catch chance.',            cost: 500,    prereq: ['mk1'],    effect: { double_catch: 0.05 } },
    { id: 'mk3',   icon: '💰', x: 780, y: 290,  name: 'Value +30%',   desc: '+30% Fish Value.',                    cost: 1200,   prereq: ['mk2'],    effect: { fish_value_mul: 0.30 } },
    { id: 'mk4',   icon: '💵', x: 780, y: 400,  name: 'Double +10%',  desc: '+10% Double Catch chance.',           cost: 3000,   prereq: ['mk3'],    effect: { double_catch: 0.10 } },
    { id: 'mk5',   icon: '💰', x: 780, y: 510,  name: 'Value +50%',   desc: '+50% Fish Value.',                    cost: 7500,   prereq: ['mk4'],    effect: { fish_value_mul: 0.50 } },
    { id: 'mk6',   icon: '💎', x: 780, y: 620,  name: 'Triple +5%',   desc: '+5% Triple Catch chance.',            cost: 18000,  prereq: ['mk5'],    effect: { triple_catch: 0.05 } },
    { id: 'mk7',   icon: '💰', x: 780, y: 730,  name: 'Value ×2',     desc: '+100% Fish Value.',                   cost: 45000,  prereq: ['mk6'],    effect: { fish_value_mul: 1.0 } },
    { id: 'mk8',   icon: '💵', x: 780, y: 840,  name: 'Double +15%',  desc: '+15% Double Catch chance.',           cost: 110000, prereq: ['mk7'],    effect: { double_catch: 0.15 } },
    { id: 'mk9',   icon: '💎', x: 780, y: 950,  name: 'Triple +10%',  desc: '+10% Triple Catch chance.',           cost: 275000, prereq: ['mk8'],    effect: { triple_catch: 0.10 } },
    { id: 'mk10',  icon: '💰', x: 780, y: 1060, name: 'Value ×3',     desc: '+200% Fish Value.',                   cost: 700000, prereq: ['mk9'],    effect: { fish_value_mul: 2.0 } },

    // KNOWLEDGE (col 5) — XP, rarity, energy
    // KNOWLEDGE (south-east)
    { id: 'kn1',   icon: '⚡', name: '+1 Energy',    desc: '+1 Max Energy.',                      cost: 120,    prereq: ['root'],   effect: { max_energy: 1 } },
    { id: 'kn2',   icon: '📘', x: 940, y: 180,  name: 'XP +25%',      desc: '+25% XP.',                            cost: 350,    prereq: ['kn1'],    effect: { xp_mul: 0.25 } },
    { id: 'kn3',   icon: '⚡', x: 940, y: 290,  name: '+1 Energy',    desc: '+1 Max Energy.',                      cost: 900,    prereq: ['kn2'],    effect: { max_energy: 1 } },
    { id: 'kn4',   icon: '🦉', x: 940, y: 400,  name: 'Rare +0.05',   desc: '+0.05 Rare bias.',                    cost: 2400,   prereq: ['kn3'],    effect: { rare_chance: 0.05 } },
    { id: 'kn5',   icon: '📘', x: 940, y: 510,  name: 'XP +50%',      desc: '+50% XP.',                            cost: 6000,   prereq: ['kn4'],    effect: { xp_mul: 0.5 } },
    { id: 'kn6',   icon: '⚡', x: 940, y: 620,  name: '+2 Energy',    desc: '+2 Max Energy.',                      cost: 15000,  prereq: ['kn5'],    effect: { max_energy: 2 } },
    { id: 'kn7',   icon: '🦉', x: 940, y: 730,  name: 'Rare +0.10',   desc: '+0.10 Rare bias.',                    cost: 40000,  prereq: ['kn6'],    effect: { rare_chance: 0.10 } },
    { id: 'kn8',   icon: '🧠', x: 940, y: 840,  name: 'Mastery +50%', desc: '+50% mastery rarity skew.',           cost: 100000, prereq: ['kn7'],    effect: { fish_level_mul: 0.5 } },
    { id: 'kn9',   icon: '⚡', x: 940, y: 950,  name: '+3 Energy',    desc: '+3 Max Energy.',                      cost: 250000, prereq: ['kn8'],    effect: { max_energy: 3 } },
    { id: 'kn10',  icon: '🌟', x: 940, y: 1060, name: 'Legendary +',  desc: '+5% Legendary chance (flat weight).', cost: 600000, prereq: ['kn9'],    effect: { legendary_bonus: 0.05 } },
  ];

  // Radial layout: root at the center, 6 branches at 60° intervals,
  // each tier stepping outward. Branch is encoded in the id prefix.
  const TREE = { cx: 900, cy: 900, w: 1800, h: 1800, tier1Dist: 150, tierStep: 95 };
  const BRANCH_ANGLE = {
    mk:  0,    // east
    kn:  60,   // south-east
    tn:  120,  // south-west
    pow: 180,  // west
    cr:  240,  // north-west
    lu:  300,  // north-east
  };
  (function computePositions() {
    for (const s of SKILLS) {
      if (s.id === 'root') { s.x = TREE.cx; s.y = TREE.cy; continue; }
      const branch = (s.id.match(/^[a-z]+/) || [''])[0];
      const tier = parseInt((s.id.match(/\d+/) || ['1'])[0], 10);
      const angle = (BRANCH_ANGLE[branch] || 0) * Math.PI / 180;
      const dist = TREE.tier1Dist + (tier - 1) * TREE.tierStep;
      s.x = TREE.cx + Math.cos(angle) * dist;
      s.y = TREE.cy + Math.sin(angle) * dist;
    }
  })();

  // ───────────────────────── State ─────────────────────────
  let state = freshState();
  let mounted = false, pane;
  let loopRaf = 0;
  let lastTs = 0;
  let autoAccum = 0;

  function freshState() {
    return {
      money: 0,
      day: 1,
      energy: 5,
      maxEnergyBase: 5,
      zones: { pond: { unlocked: true, level: 1, xp: 0 } },   // others auto-added on unlock
      currentZoneId: 'pond',
      fishCaught: {},  // id -> { count, xp, level, bestRarity }
      discovered: {},  // 'speciesId:rarityId' -> true
      skills: {},      // id -> true
      // Run state
      phase: 'idle',   // idle | waiting | bite | reel | caught | eod
      // Bite phase
      bite: null,
      // Reel phase
      reel: null,
      // Last catch popup
      lastCatch: null,
      // Day stats
      dayStats: { caught: 0, gold: 0, xp: 0, perfects: 0, crits: 0 },
      // UI
      activePanel: null, // 'skills' | 'log' | 'zones' | null
    };
  }

  // ───────────────────────── Stats ─────────────────────────
  // base values for stats not coming from skills
  const STAT_BASES = {
    click_power: 1,
    click_power_mul: 0,
    crit_chance: 0.04,
    crit_mult: 1.5,
    reaction_time: 1.0,
    perfect_zone: 0,
    fish_value_mul: 0,
    rare_chance: 0,
    max_energy: 0,
    auto_clicks: 0,
    double_catch: 0,
    triple_catch: 0,
    xp_mul: 0,
    heat_decay: 0,
    heat_max: 0,            // additive to base 100 tension cap
    heat_floor: 0,          // tension can't drop below this during reel
    click_tension: 0,       // clicks restore (1 + click_tension) × base
    crit_tension: 0,        // crits restore +this Tension
    start_progress: 0,      // perfect catch starts at (0.15 + this) × hp
    fish_level_mul: 0,      // amplifies mastery rarity skew
    legendary_bonus: 0,     // flat weight added to legendary tier
    auto_hook: 0,           // chance for a bite to auto-hook
  };

  function getStat(name) {
    let v = STAT_BASES[name] || 0;
    for (const id of Object.keys(state.skills)) {
      const s = SKILLS.find(x => x.id === id); if (!s) continue;
      const eff = s.effect[name]; if (eff == null) continue;
      v += eff;
    }
    return v;
  }

  function maxEnergy() { return state.maxEnergyBase + getStat('max_energy'); }
  function clickPower() {
    return Math.max(1, Math.round((getStat('click_power')) * (1 + getStat('click_power_mul'))));
  }

  // ───────────────────────── Rarity roll ─────────────────────────
  // base weights heavily favor common. Fish mastery level shifts toward rare.
  function rollRarity(speciesId) {
    const mastery = state.fishCaught[speciesId]?.level || 0;
    const skillBias = getStat('rare_chance');
    const masteryMul = 1 + getStat('fish_level_mul');   // amplifies mastery skew
    const legendaryBonus = getStat('legendary_bonus');
    const baseWeights = [60, 22, 10, 5, 1.2];          // common..legendary
    const w = baseWeights.map((b, i) => {
      const tierBoost = Math.pow(1 + 0.18 * i * masteryMul, mastery) * (1 + skillBias * i);
      return b * (i === 0 ? Math.max(0.4, 1 - 0.04 * mastery) : tierBoost);
    });
    // Flat additive weight on legendary tier
    w[4] += legendaryBonus * (w.reduce((a, b) => a + b, 0));
    const total = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < RARITIES.length; i++) {
      r -= w[i]; if (r <= 0) return RARITIES[i];
    }
    return RARITIES[0];
  }

  function rollSpecies(zoneId) {
    const pool = SPECIES.filter(s => s.zone === zoneId);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ───────────────────────── Zone leveling ─────────────────────────
  function zoneXpForLevel(lvl) { return Math.round(100 * Math.pow(1.2, lvl)); }
  function zoneMultiplier(zoneId) { // total gold/xp multiplier from zone level
    const z = state.zones[zoneId]; if (!z) return 1;
    return 1 + 0.05 * (z.level - 1);
  }
  function addZoneXp(amount) {
    const z = state.zones[state.currentZoneId]; if (!z) return;
    z.xp += amount;
    while (z.xp >= zoneXpForLevel(z.level)) {
      z.xp -= zoneXpForLevel(z.level);
      z.level++;
    }
  }
  function speciesXpForLevel(lvl) { return Math.round(20 * Math.pow(1.4, lvl)); }
  function addSpeciesXp(id, amount) {
    const f = state.fishCaught[id] = state.fishCaught[id] || { count: 0, xp: 0, level: 0, bestRarity: null };
    f.xp += amount;
    while (f.xp >= speciesXpForLevel(f.level + 1)) {
      f.xp -= speciesXpForLevel(f.level + 1);
      f.level++;
    }
  }

  // ───────────────────────── DOM build ─────────────────────────
  function ensurePane() {
    if (mounted) return pane;
    mounted = true;
    injectStyles();
    pane = document.createElement('div');
    pane.className = 'tab-pane hidden';
    pane.id = 'tab-fish';
    pane.innerHTML = `
      <div class="fish-ui">
        <!-- Top HUD -->
        <div class="fish-hud">
          <div class="fish-title">FISHING INCORPORATED</div>
          <div class="fish-pills">
            <div class="pill"><span class="k">$</span><span id="fish-money">0</span></div>
            <div class="pill"><span class="k">DAY</span><span id="fish-day">1</span></div>
            <div class="pill energy"><span class="k">⚡</span>
              <span id="fish-energy">5</span>/<span id="fish-energy-max">5</span></div>
            <div class="pill"><span class="k">ZONE</span>
              <span id="fish-zone-name">Forest Pond</span>
              <span class="sub">Lv <span id="fish-zone-level">1</span></span></div>
          </div>
          <div class="fish-actions">
            <button class="fish-btn" data-panel="zones">Zones</button>
            <button class="fish-btn" data-panel="skills">Skills</button>
            <button class="fish-btn" data-panel="log">Log</button>
            <button class="fish-btn close" id="fish-close" title="Close (Esc)">Close</button>
          </div>
        </div>

        <!-- Main fishing stage -->
        <div class="fish-stage" id="fish-stage">
          <div class="fish-sky" id="fish-sky"></div>
          <div class="fish-clouds"></div>
          <div class="fish-sun"></div>
          <div class="fish-water" id="fish-water">
            <div class="fish-water-shimmer"></div>
            <div class="fish-bobber hidden" id="fish-bobber"></div>
          </div>
          <div class="fish-boat">
            <div class="fish-boat-hull"></div>
            <div class="fish-angler">🎣</div>
          </div>

          <!-- Bite indicator minigame -->
          <div class="fish-bite-mini hidden" id="fish-bite-mini">
            <div class="fish-bite-title">BITE! Stop on the green zone</div>
            <div class="fish-bite-track">
              <div class="fish-bite-zone" id="fish-bite-zone"></div>
              <div class="fish-bite-cursor" id="fish-bite-cursor"></div>
            </div>
            <button class="fish-btn big hook" id="fish-bite-hook">HOOK</button>
          </div>

          <!-- Reel-in click minigame -->
          <div class="fish-reel-mini hidden" id="fish-reel-mini">
            <div class="fish-reel-top">
              <span id="fish-reel-fish">Fish</span>
              <span class="fish-reel-heat-label">TENSION</span>
            </div>
            <div class="fish-reel-bars">
              <div class="fish-reel-bar progress">
                <div class="fish-reel-fill" id="fish-reel-fill"></div>
                <div class="fish-reel-label"><span id="fish-reel-prog">0</span>%</div>
              </div>
              <div class="fish-reel-bar heat">
                <div class="fish-reel-heat-fill" id="fish-reel-heat-fill"></div>
              </div>
            </div>
            <button class="fish-btn big reel" id="fish-reel-click">REEL!</button>
            <div class="fish-reel-hint">Click rapidly. Crits = big chunks. Don't let it slip!</div>
          </div>

          <!-- Catch popup -->
          <div class="fish-popup hidden" id="fish-popup"></div>

          <!-- Status -->
          <div class="fish-status" id="fish-status">Cast a line to start.</div>
        </div>

        <!-- Cast control row -->
        <div class="fish-controls">
          <button class="fish-btn big cast" id="fish-cast">CAST  (−1 ⚡)</button>
          <div class="fish-rate" id="fish-rate"></div>
        </div>

        <!-- Side panels (overlay over stage) -->
        <div class="fish-panel hidden" id="fish-panel-zones">
          <div class="fish-panel-head"><h3>Zones</h3>
            <button class="fish-btn" data-close-panel>×</button></div>
          <div class="fish-panel-body" id="fish-zones-list"></div>
        </div>
        <div class="fish-panel hidden" id="fish-panel-skills">
          <div class="fish-panel-head"><h3>Skill Tree</h3>
            <button class="fish-btn" data-close-panel>×</button></div>
          <div class="fish-panel-body" id="fish-skills-list"></div>
        </div>
        <div class="fish-panel hidden" id="fish-panel-log">
          <div class="fish-panel-head"><h3>Fish Log</h3>
            <button class="fish-btn" data-close-panel>×</button></div>
          <div class="fish-panel-body" id="fish-log-list"></div>
        </div>

        <!-- End of Day panel -->
        <div class="fish-eod hidden" id="fish-eod">
          <div class="fish-eod-card">
            <h2>End of Day <span id="fish-eod-day">1</span></h2>
            <div class="fish-eod-stats" id="fish-eod-stats"></div>
            <button class="fish-btn big cast" id="fish-eod-next">Next Day</button>
          </div>
        </div>

        <!-- Discovery toast -->
        <div class="fish-discover hidden" id="fish-discover"></div>

        <!-- Admin overlay (Ctrl+F+A) -->
        <div class="fish-admin hidden" id="fish-admin">
          <div class="fish-admin-card">
            <h3>🛠 Admin</h3>
            <div class="row">
              <label>Add money</label>
              <input type="number" id="fish-admin-amt" value="10000" min="1" step="1">
              <button class="fish-btn cast" id="fish-admin-add">Add</button>
            </div>
            <div class="row buttons">
              <button class="fish-btn" data-give="1000">+$1k</button>
              <button class="fish-btn" data-give="100000">+$100k</button>
              <button class="fish-btn" data-give="1000000">+$1M</button>
              <button class="fish-btn" data-give="1000000000">+$1B</button>
            </div>
            <div class="row buttons">
              <button class="fish-btn" id="fish-admin-energy">Refill Energy</button>
              <button class="fish-btn" id="fish-admin-unlock">Unlock All Skills</button>
              <button class="fish-btn close" id="fish-admin-reset">Reset Save</button>
            </div>
            <div class="row">
              <button class="fish-btn cast" id="fish-admin-close">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;
    const center = document.querySelector('main');
    if (center) center.appendChild(pane); else document.body.appendChild(pane);
    wireDom();
    return pane;
  }

  function wireDom() {
    pane.querySelector('#fish-close').onclick = closeTab;
    pane.querySelector('#fish-cast').onclick = doCast;
    pane.querySelector('#fish-bite-hook').onclick = doHook;
    pane.querySelector('#fish-reel-click').onclick = doReelClick;
    pane.querySelector('#fish-eod-next').onclick = nextDay;
    pane.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => openPanel(b.dataset.panel));
    pane.querySelectorAll('[data-close-panel]').forEach(b => b.onclick = () => openPanel(null));
    // Admin wiring
    pane.querySelector('#fish-admin-close').onclick = closeAdmin;
    pane.querySelector('#fish-admin-add').onclick = () => {
      const amt = parseInt(pane.querySelector('#fish-admin-amt').value, 10) || 0;
      if (amt > 0) { state.money += amt; render(); }
    };
    pane.querySelectorAll('#fish-admin .row.buttons [data-give]').forEach(b => {
      b.onclick = () => { state.money += parseInt(b.dataset.give, 10); render(); };
    });
    pane.querySelector('#fish-admin-energy').onclick = () => { state.energy = maxEnergy(); render(); };
    pane.querySelector('#fish-admin-unlock').onclick = () => {
      for (const s of SKILLS) state.skills[s.id] = true;
      render(); if (state.activePanel === 'skills') renderSkills();
    };
    pane.querySelector('#fish-admin-reset').onclick = () => {
      if (!confirm('Wipe save and reset to a new game?')) return;
      clearSave();
      state = freshState();
      loadedOnce = true;
      closeAdmin();
      render();
      if (state.activePanel) openPanel(state.activePanel);
    };
  }

  function openAdmin() {
    ensurePane();
    pane.querySelector('#fish-admin').classList.remove('hidden');
  }
  function closeAdmin() {
    if (pane) pane.querySelector('#fish-admin').classList.add('hidden');
  }

  // ───────────────────────── Game flow ─────────────────────────
  function doCast() {
    if (state.phase !== 'idle') return;
    if (state.energy <= 0) { showEod(); return; }
    state.energy -= 1;
    screenshake(0.7);
    punchEl('#fish-cast', 1.1);
    state.phase = 'waiting';
    pane.querySelector('#fish-cast').classList.add('hidden');
    pane.querySelector('#fish-bobber').classList.remove('hidden');
    pane.querySelector('#fish-status').textContent = 'Line is out…';
    // wait 1.6–3.4s, scaled by reaction_time (lower = faster bite? No — bite delay is just feel)
    const baseDelay = 1600 + Math.random() * 1800;
    setTimeout(() => {
      if (state.phase !== 'waiting') return;
      startBite();
    }, baseDelay);
    render();
  }

  function startBite() {
    state.phase = 'bite';
    // Pick the species/rarity NOW so the minigame difficulty can hint at it.
    const species = rollSpecies(state.currentZoneId);
    const rarity = rollRarity(species.id);
    const zoneSpeed = 1 + (state.zones[state.currentZoneId]?.level || 1) * 0.02;
    const reactMod = Math.max(0.5, getStat('reaction_time'));   // lower = slower bar
    // Speed in % per second across the 0..100 track. Rarer = faster.
    const baseSpeed = 60 + rarity.valueMul * 8;
    const speed = baseSpeed * reactMod * zoneSpeed;
    // Perfect-zone width: larger rarities = smaller. Skills enlarge it.
    const zoneSize = Math.max(6, (22 - rarity.valueMul * 1.4) * (1 + getStat('perfect_zone')));
    const zonePos = 25 + Math.random() * (75 - zoneSize); // somewhere on the track
    state.bite = {
      species, rarity,
      pos: 0,
      speed,
      dir: 1,
      zonePos, zoneSize,
      startedAt: performance.now(),
    };
    pane.querySelector('#fish-bite-mini').classList.remove('hidden');
    pane.querySelector('#fish-bobber').classList.add('biting');
    pane.querySelector('#fish-status').textContent = 'BITE! Stop on the green!';
    const zEl = pane.querySelector('#fish-bite-zone');
    zEl.style.left = zonePos + '%';
    zEl.style.width = zoneSize + '%';
    // Auto-hook chance — skip the minigame on success
    if (Math.random() < getStat('auto_hook')) {
      state.dayStats.perfects += 1;
      startReel(species, rarity, true);
    }
  }

  function doHook() {
    if (state.phase !== 'bite') return;
    const b = state.bite;
    const inZone = b.pos >= b.zonePos && b.pos <= b.zonePos + b.zoneSize;
    if (!inZone) {
      // Miss: lose the fish, but no extra energy cost
      state.phase = 'idle';
      pane.querySelector('#fish-bite-mini').classList.add('hidden');
      pane.querySelector('#fish-bobber').classList.add('hidden');
      pane.querySelector('#fish-bobber').classList.remove('biting');
      pane.querySelector('#fish-cast').classList.remove('hidden');
      pane.querySelector('#fish-status').textContent = 'Missed! The fish slipped away.';
      render();
      return;
    }
    // Hook success → reel-in
    state.dayStats.perfects += 1;
    screenshake(1.6);
    punchEl('#fish-bite-hook', 1.2);
    startReel(b.species, b.rarity, /*perfectBonus*/ true);
  }

  function startReel(species, rarity, perfectBonus) {
    pane.querySelector('#fish-bite-mini').classList.add('hidden');
    pane.querySelector('#fish-bobber').classList.add('hidden');
    state.phase = 'reel';
    // HP scales with rarity tier and zone level — fish toughness
    const tier = RARITIES.findIndex(r => r.id === rarity.id);
    const zoneLv = state.zones[state.currentZoneId]?.level || 1;
    const hp = Math.round((25 + tier * 35 + species.baseValue * 0.4) * (1 + zoneLv * 0.05));
    const heatMax = 100 + getStat('heat_max');
    const startFrac = perfectBonus ? (0.15 + getStat('start_progress')) : 0;
    state.reel = {
      species, rarity,
      hp,
      progress: hp * startFrac,
      heat: heatMax,
      heatMax,
      lastClickAt: performance.now(),
      crits: 0,
      clicks: 0,
    };
    const r = state.reel;
    pane.querySelector('#fish-reel-mini').classList.remove('hidden');
    pane.querySelector('#fish-reel-fish').textContent =
      `${species.emoji} ${rarity.label} ${species.name}`;
    pane.querySelector('#fish-reel-fish').style.color = rarity.color;
    pane.querySelector('#fish-status').textContent = 'REELING — click fast!';
    renderReel();
  }

  function doReelClick() {
    if (state.phase !== 'reel') return;
    addReelHit(/*isAuto*/ false);
  }

  function addReelHit(isAuto) {
    const r = state.reel; if (!r) return;
    const base = clickPower();
    const isCrit = Math.random() < getStat('crit_chance');
    const damage = isCrit ? Math.round(base * getStat('crit_mult')) : base;
    r.progress += damage;
    r.clicks += 1;
    if (isCrit) {
      r.crits += 1;
      state.dayStats.crits += 1;
      floatText(`CRIT +${damage}`, '#f6c84b');
      if (!isAuto) { screenshake(2.4); punchEl('#fish-reel-click', 1.28); }
      else { screenshake(1.2); }
    } else if (!isAuto) {
      floatText(`+${damage}`, '#9aa3b2');
      screenshake(0.9);
      punchEl('#fish-reel-click', 1.12);
    }
    // Tension/grip: clicks tighten the line. Auto-clicks give a little less.
    const now = performance.now();
    r.lastClickAt = now;
    const mul = 1 + getStat('click_tension');
    let gain = (isAuto ? 3 : 8) * mul;
    if (isCrit) gain += getStat('crit_tension');
    r.heat = Math.min(r.heatMax, r.heat + gain);
    if (r.progress >= r.hp) finishCatch();
    renderReel();
  }

  function finishCatch() {
    const r = state.reel; if (!r) return;
    const { species, rarity } = r;
    state.phase = 'caught';
    pane.querySelector('#fish-reel-mini').classList.add('hidden');

    // Reward
    let value = species.baseValue * rarity.valueMul * (1 + getStat('fish_value_mul'));
    value *= zoneMultiplier(state.currentZoneId);
    value = Math.round(value);
    let copies = 1;
    if (Math.random() < getStat('double_catch')) copies = 2;
    if (Math.random() < getStat('triple_catch')) copies = Math.max(copies, 3);
    const totalGold = value * copies;
    let xp = species.xpPer * (1 + getStat('xp_mul')) * (1 + (RARITIES.findIndex(x => x.id === rarity.id)) * 0.4);
    xp = Math.round(xp * copies);

    state.money += totalGold;
    state.dayStats.gold += totalGold;
    state.dayStats.caught += copies;
    state.dayStats.xp += xp;

    // Per-species record
    addSpeciesXp(species.id, xp);
    state.fishCaught[species.id].count += copies;
    const prevBest = state.fishCaught[species.id].bestRarity;
    const prevIdx = prevBest ? RARITIES.findIndex(x => x.id === prevBest) : -1;
    const newIdx = RARITIES.findIndex(x => x.id === rarity.id);
    if (newIdx > prevIdx) state.fishCaught[species.id].bestRarity = rarity.id;
    addZoneXp(xp);

    // Discovery
    const key = species.id + ':' + rarity.id;
    let isNew = false;
    if (!state.discovered[key]) { state.discovered[key] = true; isNew = true; }

    showCatchPopup(species, rarity, totalGold, copies, isNew);
    state.lastCatch = { species, rarity, gold: totalGold, copies, isNew, ts: Date.now() };
    // Bigger juice for rarer fish
    const rarityIdx = RARITIES.findIndex(x => x.id === rarity.id);
    screenshake(2 + rarityIdx * 0.5);
    punchEl('#fish-money', 1.25);

    setTimeout(() => {
      state.phase = 'idle';
      pane.querySelector('#fish-cast').classList.remove('hidden');
      pane.querySelector('#fish-status').textContent =
        state.energy > 0 ? `Catch logged. ${state.energy} ⚡ left.` : 'Out of energy.';
      if (state.energy <= 0) showEod();
      render();
    }, 1500);
    render();
  }

  function failReelTension() {
    if (!state.reel) return;
    state.reel = null;
    state.phase = 'idle';
    pane.querySelector('#fish-reel-mini').classList.add('hidden');
    pane.querySelector('#fish-reel-mini').classList.remove('warn');
    pane.querySelector('#fish-cast').classList.remove('hidden');
    pane.querySelector('#fish-status').textContent = 'The line went slack — the fish unbit and slipped away.';
    if (state.energy <= 0) showEod();
    render();
  }

  function showCatchPopup(species, rarity, gold, copies, isNew) {
    const el = pane.querySelector('#fish-popup');
    el.innerHTML = `
      <div class="fish-popup-emoji" style="color:${rarity.color}">${species.emoji}</div>
      <div class="fish-popup-name" style="color:${rarity.color}">${rarity.label} ${species.name}${copies > 1 ? ' ×' + copies : ''}</div>
      <div class="fish-popup-value">+$${gold.toLocaleString()}</div>
      ${isNew ? '<div class="fish-popup-tier" style="color:#f6c84b">★ NEW DISCOVERY ★</div>' : ''}
    `;
    el.classList.remove('hidden', 'pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  // ─────── Juice: screenshake + punch ───────
  function screenshake(mag) {
    const el = pane && pane.querySelector('#fish-stage');
    if (!el) return;
    el.style.setProperty('--shake-mag', (mag || 1).toFixed(2));
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    clearTimeout(el._shakeT);
    el._shakeT = setTimeout(() => el.classList.remove('shake'), 260);
  }
  function punchEl(sel, scale) {
    const el = pane && pane.querySelector(sel);
    if (!el) return;
    el.style.setProperty('--punch-scale', (scale || 1.18).toFixed(3));
    el.classList.remove('punch'); void el.offsetWidth; el.classList.add('punch');
    clearTimeout(el._punchT);
    el._punchT = setTimeout(() => el.classList.remove('punch'), 200);
  }

  function floatText(msg, color) {
    const wrap = pane.querySelector('#fish-reel-mini');
    if (!wrap) return;
    const t = document.createElement('div');
    t.className = 'fish-float';
    t.textContent = msg;
    t.style.color = color;
    t.style.left = (50 + (Math.random() - 0.5) * 30) + '%';
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 800);
  }

  // ───────────────────────── End of Day ─────────────────────────
  function showEod() {
    state.phase = 'eod';
    const s = state.dayStats;
    pane.querySelector('#fish-eod-day').textContent = state.day;
    pane.querySelector('#fish-eod-stats').innerHTML = `
      <div class="row"><span>Fish caught</span><span>${s.caught}</span></div>
      <div class="row"><span>Gold earned</span><span class="gold">$${s.gold.toLocaleString()}</span></div>
      <div class="row"><span>XP gained</span><span>${s.xp}</span></div>
      <div class="row"><span>Perfect catches</span><span>${s.perfects}</span></div>
      <div class="row"><span>Critical hits</span><span>${s.crits}</span></div>
    `;
    pane.querySelector('#fish-eod').classList.remove('hidden');
  }

  function nextDay() {
    state.day += 1;
    state.energy = maxEnergy();
    state.dayStats = { caught: 0, gold: 0, xp: 0, perfects: 0, crits: 0 };
    state.phase = 'idle';
    pane.querySelector('#fish-eod').classList.add('hidden');
    pane.querySelector('#fish-cast').classList.remove('hidden');
    pane.querySelector('#fish-status').textContent = 'A new day. Cast your line!';
    render();
  }

  // ───────────────────────── Panels ─────────────────────────
  function openPanel(name) {
    state.activePanel = name;
    ['zones', 'skills', 'log'].forEach(p => {
      pane.querySelector('#fish-panel-' + p).classList.toggle('hidden', name !== p);
    });
    if (name === 'zones') renderZones();
    if (name === 'skills') renderSkills();
    if (name === 'log') renderLog();
  }

  function renderZones() {
    const host = pane.querySelector('#fish-zones-list');
    host.innerHTML = ZONES.map(z => {
      const data = state.zones[z.id];
      const unlocked = !!data?.unlocked;
      const lvl = data?.level || 0;
      const xp = data?.xp || 0;
      const need = unlocked ? zoneXpForLevel(lvl) : 0;
      const can = !unlocked && state.money >= z.unlockCost;
      const isCurrent = state.currentZoneId === z.id;
      return `
        <div class="fish-zone-card ${isCurrent ? 'current' : ''}" data-id="${z.id}">
          <div class="head">
            <span class="name">${z.name}</span>
            ${unlocked ? `<span class="lv">Lv ${lvl}</span>` : `<span class="lock">🔒 $${z.unlockCost.toLocaleString()}</span>`}
          </div>
          ${unlocked ? `
            <div class="xp-bar"><div class="xp-fill" style="width:${Math.min(100, (xp/need)*100)}%"></div></div>
            <div class="sub">+${((lvl - 1) * 5)}% gold/xp · ${xp}/${need} XP</div>
            <button class="fish-btn ${isCurrent ? '' : 'cast'}" ${isCurrent ? 'disabled' : ''}>${isCurrent ? 'Active' : 'Fish Here'}</button>
          ` : `
            <div class="sub">Unlocks at $${z.unlockCost.toLocaleString()}</div>
            <button class="fish-btn cast" ${can ? '' : 'disabled'}>Unlock</button>
          `}
        </div>
      `;
    }).join('');
    host.querySelectorAll('.fish-zone-card').forEach(el => {
      const z = ZONE_BY_ID[el.dataset.id];
      const btn = el.querySelector('button.fish-btn');
      btn.onclick = () => {
        const data = state.zones[z.id];
        if (!data || !data.unlocked) {
          if (state.money < z.unlockCost) return;
          state.money -= z.unlockCost;
          state.zones[z.id] = { unlocked: true, level: 1, xp: 0 };
        }
        state.currentZoneId = z.id;
        applyZoneTheme();
        render();
        renderZones();
      };
    });
  }

  // ───────────────────────── Save / Load ─────────────────────────
  const SAVE_KEY = 'dva-fish-save-v1';
  let saveTimer = 0;
  function saveState() {
    try {
      const data = {
        v: 1,
        money: state.money,
        day: state.day,
        energy: state.energy,
        maxEnergyBase: state.maxEnergyBase,
        zones: state.zones,
        currentZoneId: state.currentZoneId,
        fishCaught: state.fishCaught,
        discovered: state.discovered,
        skills: state.skills,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {}
  }
  function queueSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = 0; saveState(); }, 250);
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return false;
      state.money = d.money || 0;
      state.day = d.day || 1;
      state.energy = (d.energy != null) ? d.energy : 5;
      state.maxEnergyBase = d.maxEnergyBase || 5;
      state.zones = d.zones || { pond: { unlocked: true, level: 1, xp: 0 } };
      state.currentZoneId = d.currentZoneId || 'pond';
      state.fishCaught = d.fishCaught || {};
      state.discovered = d.discovered || {};
      state.skills = d.skills || {};
      return true;
    } catch { return false; }
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch {}
  }

  function abbreviateCost(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 10e3 ? 0 : 1) + 'k';
    return '' + n;
  }

  // ── Tree pan state ──
  let panX = 0, panY = 0;
  let treePanInitialized = false;
  let dragActive = false, dragStartX = 0, dragStartY = 0, dragOrigX = 0, dragOrigY = 0;
  let panHandlersWired = false;
  function applyPan() {
    const inner = pane && pane.querySelector('#fish-tree-inner');
    if (inner) inner.style.transform = `translate(${Math.round(panX)}px, ${Math.round(panY)}px)`;
  }
  function wireTreePan() {
    const wrap = pane.querySelector('#fish-tree-wrap');
    if (!wrap) return;
    // wrap is rebuilt on every render — bind locally each time.
    wrap.onmousedown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.fish-node')) return;  // click a node, not pan
      e.preventDefault();
      dragActive = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      dragOrigX = panX;       dragOrigY = panY;
      wrap.classList.add('panning');
    };
    if (!panHandlersWired) {
      // Window-level so pan continues even if cursor leaves the wrap.
      window.addEventListener('mousemove', (e) => {
        if (!dragActive) return;
        panX = dragOrigX + (e.clientX - dragStartX);
        panY = dragOrigY + (e.clientY - dragStartY);
        applyPan();
      });
      window.addEventListener('mouseup', () => {
        if (!dragActive) return;
        dragActive = false;
        const w = pane && pane.querySelector('#fish-tree-wrap');
        if (w) w.classList.remove('panning');
      });
      panHandlersWired = true;
    }
  }

  function renderSkills() {
    const host = pane.querySelector('#fish-skills-list');
    const W = TREE.w, H = TREE.h;
    const NODE_W = 84, NODE_H = 84;
    // A node is "visible" if it's owned OR all its prereqs are owned.
    const visible = new Set();
    for (const s of SKILLS) {
      if (state.skills[s.id] || (s.prereq.length === 0) || s.prereq.every(p => state.skills[p])) {
        visible.add(s.id);
      }
    }
    // SVG edges between visible nodes (where the child is reachable).
    let edges = '';
    for (const s of SKILLS) {
      if (!visible.has(s.id)) continue;
      for (const p of s.prereq) {
        const parent = SKILLS.find(x => x.id === p); if (!parent) continue;
        const active = !!state.skills[p] && !!state.skills[s.id];
        const reachable = !!state.skills[p];
        edges += `<line x1="${parent.x}" y1="${parent.y}" x2="${s.x}" y2="${s.y}"
          class="fish-edge ${active ? 'active' : reachable ? 'reachable' : ''}" />`;
      }
    }
    // HTML nodes for everything visible.
    const nodes = SKILLS.filter(s => visible.has(s.id)).map(s => {
      const owned = !!state.skills[s.id];
      const prereqMet = s.prereq.every(p => state.skills[p]);
      const can = !owned && prereqMet && state.money >= s.cost;
      const cls = owned ? 'owned' : can ? 'buyable' : 'poor';
      const left = s.x - NODE_W / 2;
      const top  = s.y - NODE_H / 2;
      return `<div class="fish-node ${cls}" data-id="${s.id}"
        style="left:${left}px;top:${top}px;width:${NODE_W}px;height:${NODE_H}px;">
        <div class="nicon">${s.icon || '⭐'}</div>
        <div class="nlabel">${s.name}</div>
        <div class="ncost">${owned ? '★' : (s.cost === 0 ? 'FREE' : '$' + abbreviateCost(s.cost))}</div>
        <div class="ntip"><b>${s.name}</b><br>${s.desc}<br><span class="pcost">${owned ? 'Owned' : (s.cost === 0 ? 'Free' : 'Cost: $' + s.cost.toLocaleString())}</span></div>
      </div>`;
    }).join('');
    host.innerHTML = `
      <div class="fish-tree-hint">Buy a node to reveal what it leads to. Click + drag the canvas to pan.</div>
      <div class="fish-tree-wrap" id="fish-tree-wrap">
        <div class="fish-tree-inner" id="fish-tree-inner" style="width:${W}px;height:${H}px;">
          <svg class="fish-tree-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet"
            style="width:${W}px;height:${H}px;">
            ${edges}
          </svg>
          <div class="fish-tree-nodes" style="width:${W}px;height:${H}px;">${nodes}</div>
        </div>
      </div>
    `;
    wireTreePan();
    // Re-apply the saved pan after the DOM is rebuilt.
    if (!treePanInitialized) {
      requestAnimationFrame(() => {
        const wrap = pane.querySelector('#fish-tree-wrap');
        if (!wrap) return;
        const rect = wrap.getBoundingClientRect();
        panX = rect.width / 2 - TREE.cx;
        panY = rect.height / 2 - TREE.cy;
        treePanInitialized = true;
        applyPan();
      });
    } else {
      applyPan();
    }
    host.querySelectorAll('.fish-node').forEach(el => {
      el.onclick = () => {
        const s = SKILLS.find(x => x.id === el.dataset.id); if (!s) return;
        if (state.skills[s.id]) return;
        if (!s.prereq.every(p => state.skills[p])) return;
        if (state.money < s.cost) return;
        state.money -= s.cost;
        state.skills[s.id] = true;
        if (s.effect.max_energy) state.energy = Math.min(maxEnergy(), state.energy + s.effect.max_energy);
        render(); renderSkills();
      };
    });
  }

  function renderLog() {
    const host = pane.querySelector('#fish-log-list');
    const byZone = {};
    for (const s of SPECIES) (byZone[s.zone] = byZone[s.zone] || []).push(s);
    host.innerHTML = ZONES.map(z => {
      if (!byZone[z.id]) return '';
      return `<div class="fish-log-zone"><h4>${z.name}</h4>
        <div class="entries">${byZone[z.id].map(sp => {
          const rec = state.fishCaught[sp.id];
          const seen = !!rec && rec.count > 0;
          const best = rec?.bestRarity ? RARITY_BY_ID[rec.bestRarity] : null;
          return `<div class="entry ${seen ? '' : 'unseen'}">
            <span class="em">${seen ? sp.emoji : '❓'}</span>
            <span class="nm">${seen ? sp.name : '???'}</span>
            <span class="ct">${seen ? rec.count + ' caught · Lv ' + rec.level : ''}</span>
            ${best ? `<span class="br" style="color:${best.color}">${best.label}</span>` : ''}
          </div>`;
        }).join('')}</div></div>`;
    }).join('');
  }

  // ───────────────────────── Render ─────────────────────────
  function render() {
    if (!mounted) return;
    pane.querySelector('#fish-money').textContent = state.money.toLocaleString();
    pane.querySelector('#fish-day').textContent = state.day;
    pane.querySelector('#fish-energy').textContent = state.energy;
    pane.querySelector('#fish-energy-max').textContent = maxEnergy();
    const z = state.zones[state.currentZoneId];
    pane.querySelector('#fish-zone-name').textContent = ZONE_BY_ID[state.currentZoneId].name;
    pane.querySelector('#fish-zone-level').textContent = z?.level || 1;

    const auto = getStat('auto_clicks');
    pane.querySelector('#fish-rate').innerHTML = auto
      ? `Auto: <b>${auto.toFixed(1)}</b>/s · Click: <b>${clickPower()}</b> · Crit: <b>${(getStat('crit_chance')*100).toFixed(0)}%</b>`
      : `Click power <b>${clickPower()}</b> · Crit ${(getStat('crit_chance')*100).toFixed(0)}%`;
    queueSave();
  }

  function renderReel() {
    const r = state.reel; if (!r) return;
    const pct = Math.min(100, (r.progress / r.hp) * 100);
    pane.querySelector('#fish-reel-fill').style.width = pct.toFixed(1) + '%';
    pane.querySelector('#fish-reel-prog').textContent = pct.toFixed(0);
    const heatPct = (r.heat / r.heatMax) * 100;
    pane.querySelector('#fish-reel-heat-fill').style.width = heatPct.toFixed(1) + '%';
    // Low-tension warning: shake harder as it nears 0.
    const mini = pane.querySelector('#fish-reel-mini');
    const warn = Math.max(0, (35 - heatPct) / 35);
    mini.style.setProperty('--warn', warn.toFixed(3));
    mini.classList.toggle('warn', warn > 0.01);
  }

  function applyZoneTheme() {
    const z = ZONE_BY_ID[state.currentZoneId];
    const stage = pane.querySelector('#fish-stage');
    const water = pane.querySelector('#fish-water');
    stage.style.background = `linear-gradient(${z.sky} 0%, #0b1322 100%)`;
    water.style.background = `linear-gradient(${z.waterTop} 0%, ${z.waterBot} 100%)`;
  }

  // ───────────────────────── Loop ─────────────────────────
  function loop(ts) {
    if (!pane || pane.classList.contains('hidden')) { loopRaf = 0; return; }
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;

    // Bite minigame movement
    if (state.phase === 'bite' && state.bite) {
      const b = state.bite;
      b.pos += b.dir * b.speed * dt;
      if (b.pos >= 100) { b.pos = 100; b.dir = -1; }
      if (b.pos <= 0)   { b.pos = 0;   b.dir = 1; }
      const cur = pane.querySelector('#fish-bite-cursor');
      cur.style.left = b.pos + '%';
      // Auto-fail after ~6 seconds without hooking
      if (ts - b.startedAt > 6000) {
        doHook(); // try to hook (will likely miss outside zone)
      }
    }

    // Auto-clicks during reel
    if (state.phase === 'reel') {
      const auto = getStat('auto_clicks');
      if (auto > 0) {
        autoAccum += dt * auto;
        while (autoAccum >= 1) { autoAccum -= 1; addReelHit(true); }
      }
      // Tension falls over time. Rarer fish drain it faster. Skills slow it.
      const r = state.reel;
      const tier = RARITIES.findIndex(x => x.id === r.rarity.id);
      const baseDrain = 18 + tier * 4;
      const decay = Math.max(0, baseDrain * (1 + getStat('heat_decay')));
      const floor = getStat('heat_floor');
      r.heat = Math.max(floor, r.heat - decay * dt);
      if (r.heat <= 0) {
        failReelTension();
      } else {
        renderReel();
      }
    } else {
      autoAccum = 0;
    }

    loopRaf = requestAnimationFrame(loop);
  }
  function startLoop() {
    if (loopRaf) return;
    lastTs = 0;
    loopRaf = requestAnimationFrame(loop);
  }

  // ───────────────────────── Tab plumbing ─────────────────────────
  function ensureTabButton() {
    const tabs = document.getElementById('center-tabs');
    if (!tabs || tabs.querySelector('[data-tab="fish"]')) return;
    const btn = document.createElement('button');
    btn.className = 'center-tab';
    btn.dataset.tab = 'fish';
    btn.innerHTML = `<span>🎣 Fish</span> <span class="tab-close" id="fish-tab-close" title="Close">✕</span>`;
    tabs.appendChild(btn);
    btn.onclick = (e) => {
      if (e.target.id === 'fish-tab-close') { closeTab(); return; }
      showTab();
    };
  }
  let loadedOnce = false;
  function showTab() {
    ensurePane();
    if (!loadedOnce) { loadState(); loadedOnce = true; }
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    pane.classList.remove('hidden');
    document.querySelectorAll('.center-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'fish'));
    if (window.state) window.state.activeCenterTab = 'fish';
    applyZoneTheme();
    render();
    startLoop();
  }
  function closeTab() {
    if (!pane) return;
    pane.classList.add('hidden');
    document.querySelectorAll('.center-tab[data-tab="fish"]').forEach(b => b.remove());
    try { if (typeof switchCenterTab === 'function') switchCenterTab('history'); } catch {}
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.center-tab'); if (!t) return;
    if (t.dataset.tab !== 'fish' && pane) pane.classList.add('hidden');
  }, true);

  // ───────────────────────── Ctrl+FISH / Ctrl+FA ─────────────────────────
  const TARGET = 'FISH';
  const ADMIN_TARGET = 'FA';
  let buf = '', bufTimer = null;
  let abuf = '', abufTimer = null;
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (!e.ctrlKey) { buf = ''; abuf = ''; return; }
    const k = (e.key || '').toUpperCase();
    if (k.length !== 1 || !/[A-Z]/.test(k)) return;
    buf += k;
    abuf += k;
    if (buf.length > TARGET.length) buf = buf.slice(-TARGET.length);
    if (abuf.length > ADMIN_TARGET.length) abuf = abuf.slice(-ADMIN_TARGET.length);
    if (bufTimer) clearTimeout(bufTimer);
    if (abufTimer) clearTimeout(abufTimer);
    bufTimer = setTimeout(() => { buf = ''; }, 2500);
    abufTimer = setTimeout(() => { abuf = ''; }, 2500);
    if (buf === TARGET) {
      buf = ''; abuf = ''; e.preventDefault();
      ensureTabButton(); showTab();
    } else if (abuf === ADMIN_TARGET) {
      abuf = ''; e.preventDefault();
      ensureTabButton(); showTab(); openAdmin();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!pane || pane.classList.contains('hidden')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Escape') {
      const adm = pane.querySelector('#fish-admin');
      if (adm && !adm.classList.contains('hidden')) { closeAdmin(); return; }
      closeTab();
    }
    else if (e.key === ' ') {
      e.preventDefault();
      if (state.phase === 'idle') doCast();
      else if (state.phase === 'bite') doHook();
      else if (state.phase === 'reel') doReelClick();
      else if (state.phase === 'eod') nextDay();
    }
  });

  // ───────────────────────── Styles ─────────────────────────
  function injectStyles() {
    if (document.getElementById('fish-styles')) return;
    const css = `
      #tab-fish { position: relative; height: 100%; overflow: auto;
        background: linear-gradient(#0e1b2d 0%, #08111f 100%); color: #e9eef6;
        font-family: inherit; }
      .fish-ui { display: flex; flex-direction: column; height: 100%;
        padding: 12px 16px; gap: 10px; min-height: 600px; }

      /* HUD */
      .fish-hud { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .fish-title { font-size: 17px; font-weight: 800; letter-spacing: 1.8px; color: #b0e8ff; }
      .fish-pills { display: flex; gap: 6px; flex-wrap: wrap; }
      .pill { background: #1a2336; border: 1px solid #2d3b58; padding: 4px 10px;
        border-radius: 18px; font-size: 12px; display: flex; gap: 6px; align-items: baseline; }
      .pill .k { color: #9ab1d4; letter-spacing: 1px; font-size: 10px; }
      .pill.energy { color: #f6c84b; font-weight: 700; }
      .pill .sub { color: #9ab1d4; font-size: 11px; }
      .fish-actions { margin-left: auto; display: flex; gap: 6px; }
      .fish-btn { background: #1d2c46; color: #ece6ff; border: 1px solid #3a4f78;
        padding: 5px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
      .fish-btn:hover:not(:disabled) { background: #2a3f64; }
      .fish-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .fish-btn.close { background: #5a1a2a; border-color: #883048; }
      .fish-btn.big { padding: 10px 22px; font-size: 15px; font-weight: 800; letter-spacing: 1.4px; }
      .fish-btn.cast { background: #1f5a3a; border-color: #2f8a59; }
      .fish-btn.cast:hover { background: #2c7a50; }
      .fish-btn.hook { background: #6a4a14; border-color: #d29c2c; color: #fff6c8; }
      .fish-btn.reel { background: #6a2a14; border-color: #d2562c; color: #ffe8c8;
        animation: fish-reel-pulse 0.6s infinite alternate; }
      @keyframes fish-reel-pulse { from { transform: scale(1); } to { transform: scale(1.04); } }
      .fish-btn.buy { background: #1f5a3a; border-color: #2f8a59; font-weight: 700; padding: 4px 8px; }

      /* Stage */
      .fish-stage { position: relative; height: 280px; min-height: 260px;
        border-radius: 10px; overflow: hidden; border: 1px solid #2d3b58;
        --shake-mag: 1; }
      .fish-stage.shake { animation: fish-screenshake 0.24s cubic-bezier(.36,.07,.19,.97) both; }
      @keyframes fish-screenshake {
        0%   { transform: translate(0, 0) rotate(0); }
        15%  { transform: translate(calc(var(--shake-mag) * -7px),  calc(var(--shake-mag) *  4px)) rotate(calc(var(--shake-mag) * -0.5deg)); }
        30%  { transform: translate(calc(var(--shake-mag) *  6px),  calc(var(--shake-mag) * -5px)) rotate(calc(var(--shake-mag) *  0.6deg)); }
        45%  { transform: translate(calc(var(--shake-mag) * -5px),  calc(var(--shake-mag) * -3px)) rotate(calc(var(--shake-mag) * -0.4deg)); }
        60%  { transform: translate(calc(var(--shake-mag) *  4px),  calc(var(--shake-mag) *  3px)) rotate(calc(var(--shake-mag) *  0.3deg)); }
        75%  { transform: translate(calc(var(--shake-mag) * -2px),  calc(var(--shake-mag) * -1px)) rotate(0); }
        100% { transform: translate(0, 0) rotate(0); }
      }
      /* Punch — short scale pop. Preserves any existing translate via a CSS
         variable so centered overlays (translateX(-50%)) keep their position. */
      .punch { animation: fish-punch 0.18s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes fish-punch {
        0%   { transform: scale(1); }
        45%  { transform: scale(var(--punch-scale, 1.18)); }
        100% { transform: scale(1); }
      }
      /* Variants that keep -50% horizontal centering during the punch. */
      .fish-popup.punch, .fish-bite-mini.punch, .fish-reel-mini.punch {
        animation: fish-punch-centered 0.18s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes fish-punch-centered {
        0%   { transform: translateX(-50%) scale(1); }
        45%  { transform: translateX(-50%) scale(var(--punch-scale, 1.18)); }
        100% { transform: translateX(-50%) scale(1); }
      }
      .fish-sun { position: absolute; top: 18px; right: 30px; width: 50px; height: 50px;
        border-radius: 50%; background: radial-gradient(circle, #fff6c8, #f6c84b 70%, transparent 71%);
        filter: drop-shadow(0 0 8px #f6c84b88); }
      .fish-clouds { position: absolute; inset: 0; pointer-events: none;
        background: radial-gradient(60px 22px at 15% 22%, #ffffffaa, transparent 70%),
          radial-gradient(80px 24px at 70% 14%, #ffffff88, transparent 70%),
          radial-gradient(50px 18px at 45% 30%, #ffffff66, transparent 70%);
        animation: fish-clouds 60s linear infinite; }
      @keyframes fish-clouds { from { background-position: 0 0; } to { background-position: -600px 0; } }
      .fish-water { position: absolute; left: 0; right: 0; bottom: 0; height: 55%; overflow: hidden; }
      .fish-water-shimmer { position: absolute; inset: 0;
        background: repeating-linear-gradient(90deg, transparent 0 14px, #ffffff22 14px 16px);
        animation: fish-shimmer 3.2s linear infinite; opacity: 0.55; }
      @keyframes fish-shimmer { from { transform: translateX(0); } to { transform: translateX(30px); } }
      .fish-bobber { position: absolute; left: 58%; bottom: 30%;
        width: 16px; height: 16px; border-radius: 50%;
        background: radial-gradient(circle at 35% 35%, #fff, #d83a3a 55%, #7a1414 100%);
        box-shadow: 0 2px 0 #00000044;
        animation: fish-bob 1.6s ease-in-out infinite alternate; }
      .fish-bobber.biting { animation: fish-bobber-bite 0.16s ease-in-out infinite alternate; }
      @keyframes fish-bob { from { transform: translateY(0); } to { transform: translateY(-4px); } }
      @keyframes fish-bobber-bite { from { transform: translate(0, 4px); } to { transform: translate(2px, -6px); } }
      .fish-boat { position: absolute; left: 18%; bottom: 48%; transform: translateX(-50%); }
      .fish-boat-hull { width: 110px; height: 28px; background: linear-gradient(#6b4520, #3a2410);
        clip-path: polygon(8% 0, 92% 0, 100% 100%, 0 100%); box-shadow: 0 2px 0 #00000066; }
      .fish-angler { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); font-size: 22px; }
      .fish-status { position: absolute; bottom: 6px; left: 12px; font-size: 12px; color: #cfe6ff;
        text-shadow: 0 1px 0 #00000088; }

      /* Bite minigame */
      .fish-bite-mini { position: absolute; left: 50%; top: 18px; transform: translateX(-50%);
        width: min(560px, 90%); padding: 12px 14px; border-radius: 12px;
        background: rgba(10,8,20,0.82); border: 1px solid #6a4a14; box-shadow: 0 0 18px #f6c84b33;
        display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
      .fish-bite-title { font-size: 13px; color: #f6c84b; letter-spacing: 1.5px; text-align: center; }
      .fish-bite-track { position: relative; height: 22px; background: #0a0f1c;
        border: 1px solid #2d3b58; border-radius: 12px; overflow: hidden; }
      .fish-bite-zone { position: absolute; top: 0; bottom: 0; left: 0; width: 20%;
        background: linear-gradient(#56c46a, #2f8a59); box-shadow: 0 0 8px #56c46a88; }
      .fish-bite-cursor { position: absolute; top: -2px; bottom: -2px; left: 0; width: 4px;
        background: #fff6c8; box-shadow: 0 0 8px #ffffffaa; }
      .fish-bite-mini .fish-btn { align-self: center; }

      /* Reel minigame */
      .fish-reel-mini { position: absolute; left: 50%; top: 18px; transform: translateX(-50%);
        width: min(560px, 90%); padding: 12px 14px; border-radius: 12px;
        background: rgba(10,8,20,0.82); border: 1px solid #d2562c;
        display: flex; flex-direction: column; gap: 6px;
        --warn: 0; }
      .fish-reel-mini.warn { animation: fish-shake 0.08s linear infinite alternate;
        box-shadow: 0 0 calc(40px * var(--warn)) #ff5a3c;
        border-color: #ff5a3c; }
      @keyframes fish-shake { from { transform: translate(calc(-50% - 2px), 0); } to { transform: translate(calc(-50% + 2px), 1px); } }
      .fish-reel-top { display: flex; justify-content: space-between; font-size: 12px;
        color: #cfe6ff; letter-spacing: 1px; }
      .fish-reel-heat-label { color: #ff8a5c; }
      .fish-reel-bars { display: flex; flex-direction: column; gap: 4px; }
      .fish-reel-bar { position: relative; height: 22px; background: #0a0f1c;
        border: 1px solid #2d3b58; border-radius: 6px; overflow: hidden; }
      .fish-reel-bar.heat { height: 8px; }
      .fish-reel-fill { height: 100%; background: linear-gradient(90deg, #56c46a, #4d8def); transition: width 0.08s; }
      .fish-reel-heat-fill { height: 100%; width: 100%;
        background: linear-gradient(90deg, #ff5a3c 0%, #f6c84b 35%, #56c46a 100%);
        transition: width 0.08s; }
      .fish-reel-label { position: absolute; inset: 0; display: flex; align-items: center;
        justify-content: center; font-size: 11px; color: #ece6ff; font-weight: 700;
        text-shadow: 0 1px 1px #000a; }
      .fish-reel-hint { font-size: 11px; color: #9ab1d4; text-align: center; }
      .fish-reel-mini .fish-btn { align-self: center; margin: 4px 0; }
      .fish-float { position: absolute; top: 60%; font-size: 14px; font-weight: 800;
        text-shadow: 0 1px 2px #000c; pointer-events: none;
        animation: fish-float-up 0.8s ease-out forwards; }
      @keyframes fish-float-up { from { transform: translateY(0); opacity: 1; }
        to { transform: translateY(-32px); opacity: 0; } }

      /* Catch popup */
      .fish-popup { position: absolute; top: 18px; left: 50%; transform: translate(-50%, -10px);
        background: rgba(10,8,20,0.85); padding: 10px 22px; border-radius: 12px;
        border: 1px solid #f6c84b; box-shadow: 0 0 18px #f6c84b66;
        text-align: center; min-width: 200px; pointer-events: none; }
      .fish-popup.pop { animation: fish-popup-pop 1.5s ease-out forwards; }
      @keyframes fish-popup-pop {
        0% { transform: translate(-50%, 14px) scale(0.6); opacity: 0; }
        20% { transform: translate(-50%, -10px) scale(1.15); opacity: 1; }
        80% { transform: translate(-50%, -10px) scale(1); opacity: 1; }
        100% { transform: translate(-50%, -30px) scale(0.95); opacity: 0; }
      }
      .fish-popup-emoji { font-size: 30px; line-height: 1; }
      .fish-popup-name { font-weight: 700; }
      .fish-popup-value { color: #56c46a; font-weight: 700; font-size: 18px; }
      .fish-popup-tier { font-size: 11px; letter-spacing: 1.5px; margin-top: 2px; }

      /* Cast row */
      .fish-controls { display: flex; align-items: center; gap: 16px;
        background: #11192a; padding: 10px 14px; border-radius: 10px; border: 1px solid #2d3b58; }
      .fish-rate { font-size: 12px; color: #9ab1d4; }
      .fish-rate b { color: #f0e9ff; }

      /* Side panels */
      .fish-panel { position: absolute; left: 12px; right: 12px; top: 70px; bottom: 12px;
        background: rgba(10,12,22,0.92); border: 1px solid #2d3b58; border-radius: 12px;
        z-index: 30; display: flex; flex-direction: column; }
      .fish-panel-head { display: flex; justify-content: space-between; align-items: center;
        padding: 10px 14px; border-bottom: 1px solid #2d3b58; }
      .fish-panel-head h3 { margin: 0; font-size: 16px; letter-spacing: 1.2px; color: #b0e8ff; }
      .fish-panel-body { flex: 1; overflow: auto; padding: 12px 14px; }

      /* Zones */
      .fish-zone-card { background: #0e1626; border: 1px solid #253657;
        border-radius: 10px; padding: 10px 12px; margin-bottom: 8px;
        display: flex; flex-direction: column; gap: 6px; }
      .fish-zone-card.current { border-color: #f6c84b; box-shadow: 0 0 0 1px #f6c84b55; }
      .fish-zone-card .head { display: flex; justify-content: space-between; }
      .fish-zone-card .name { font-weight: 700; }
      .fish-zone-card .lv { color: #f6c84b; }
      .fish-zone-card .lock { color: #9ab1d4; }
      .fish-zone-card .sub { font-size: 11px; color: #9ab1d4; }
      .fish-zone-card .xp-bar { height: 6px; background: #0a0f1c; border-radius: 4px; overflow: hidden; }
      .fish-zone-card .xp-fill { height: 100%; background: linear-gradient(90deg, #4d8def, #a85cf5); }

      /* Skill tree (node-graph, pannable) */
      #fish-panel-skills .fish-panel-body { display: flex; flex-direction: column;
        overflow: hidden; padding: 8px 10px; }
      .fish-tree-hint { font-size: 11px; color: #9ab1d4; margin-bottom: 6px;
        letter-spacing: 0.5px; text-align: center; flex: 0 0 auto; }
      .fish-tree-wrap { position: relative; flex: 1 1 auto; min-height: 320px;
        background: radial-gradient(ellipse at center, #161e36 0%, #06101e 75%);
        border: 1px solid #253657; border-radius: 10px;
        overflow: hidden; cursor: grab; user-select: none; touch-action: none;
        background-image:
          radial-gradient(ellipse at center, #161e36 0%, #06101e 75%),
          radial-gradient(circle at 1px 1px, #1e2c46 1px, transparent 1px);
        background-size: auto, 24px 24px;
        background-attachment: local, local; }
      .fish-tree-wrap.panning { cursor: grabbing; }
      .fish-tree-inner { position: absolute; left: 0; top: 0;
        will-change: transform; pointer-events: auto; }
      .fish-tree-svg { position: absolute; left: 0; top: 0;
        pointer-events: none; display: block; }
      .fish-tree-nodes { position: absolute; left: 0; top: 0; pointer-events: none; }
      .fish-tree-nodes .fish-node { pointer-events: auto; }
      .fish-edge { stroke: #2a3b5e; stroke-width: 2.5; stroke-linecap: round;
        stroke-dasharray: 4 5; }
      .fish-edge.reachable { stroke: #4d6aa0; stroke-dasharray: none; opacity: 0.7; }
      .fish-edge.active    { stroke: #f6c84b; stroke-width: 3; stroke-dasharray: none;
        filter: drop-shadow(0 0 4px #f6c84b88); }
      .fish-tree-nodes { position: absolute; left: 0; top: 0; pointer-events: none; }
      .fish-node { position: absolute; pointer-events: auto;
        background: linear-gradient(#14213a 0%, #0a1426 100%);
        border: 2px solid #2d4a7a; border-radius: 8px;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 4px 3px 3px; text-align: center; cursor: pointer; overflow: visible;
        transition: transform 0.1s, box-shadow 0.1s, border-color 0.1s; }
      .fish-node:hover { transform: translateY(-2px); z-index: 5; }
      .fish-node .nicon { font-size: 26px; line-height: 1; margin-bottom: 2px; filter: drop-shadow(0 1px 2px #000a); }
      .fish-node .nlabel { font-size: 9px; font-weight: 700; color: #ece6ff; line-height: 1.05;
        letter-spacing: 0.2px; max-width: 100%; }
      .fish-node .ncost { font-size: 10px; color: #f6c84b; font-weight: 800; margin-top: 1px; }
      .fish-node.owned { background: #14361f; border-color: #56c46a;
        box-shadow: 0 0 0 2px #56c46a44, 0 0 16px #56c46a55; }
      .fish-node.owned .ncost { color: #56c46a; }
      .fish-node.buyable { border-color: #f6c84b;
        box-shadow: 0 0 0 1px #f6c84b55, 0 0 14px #f6c84b66;
        animation: fish-node-pulse 1.4s ease-in-out infinite alternate; }
      @keyframes fish-node-pulse { from { box-shadow: 0 0 0 1px #f6c84b55, 0 0 8px #f6c84b44; }
        to { box-shadow: 0 0 0 2px #f6c84b88, 0 0 18px #f6c84baa; } }
      .fish-node.poor { border-color: #5a4a14; opacity: 0.85; }
      .fish-node.poor:hover { border-color: #f6c84b88; }
      .fish-node .ntip { display: none; position: absolute; bottom: 100%;
        left: 50%; transform: translate(-50%, -8px); min-width: 180px;
        background: rgba(5,8,18,0.96); border: 1px solid #2d4a7a; border-radius: 8px;
        padding: 8px 10px; font-size: 11px; color: #cfe6ff; line-height: 1.35;
        font-weight: 400; z-index: 50; pointer-events: none; text-align: left; }
      .fish-node .ntip .pcost { color: #f6c84b; font-weight: 700; }
      .fish-node:hover .ntip { display: block; }

      /* Log */
      .fish-log-zone { margin-bottom: 14px; }
      .fish-log-zone h4 { margin: 0 0 6px 0; color: #b0e8ff; }
      .fish-log-zone .entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px; }
      .fish-log-zone .entry { background: #0e1626; border: 1px solid #253657;
        border-radius: 6px; padding: 6px 8px; display: flex; align-items: center; gap: 8px; font-size: 12px; }
      .fish-log-zone .entry.unseen { opacity: 0.5; }
      .fish-log-zone .entry .em { font-size: 18px; }
      .fish-log-zone .entry .ct { color: #9ab1d4; font-size: 11px; }
      .fish-log-zone .entry .br { margin-left: auto; font-size: 11px; font-weight: 700; }

      /* EOD */
      .fish-eod { position: absolute; inset: 0; background: rgba(5,8,18,0.85);
        display: flex; align-items: center; justify-content: center; z-index: 40; }
      .fish-eod-card { background: #0e1626; border: 1px solid #2d3b58; border-radius: 12px;
        padding: 20px 24px; min-width: 320px; text-align: center; }
      .fish-eod-card h2 { margin: 0 0 12px 0; color: #f6c84b; letter-spacing: 1.5px; }
      .fish-eod-stats { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
      .fish-eod-stats .row { display: flex; justify-content: space-between; font-size: 13px;
        padding: 4px 0; border-bottom: 1px dashed #2d3b58; }
      .fish-eod-stats .row .gold { color: #56c46a; font-weight: 700; }

      /* Admin overlay (Ctrl+F+A) */
      .fish-admin { position: absolute; inset: 0; z-index: 60;
        background: rgba(5,8,18,0.78);
        display: flex; align-items: center; justify-content: center; }
      .fish-admin-card { background: #0e1626; border: 1px solid #6a4a14;
        border-radius: 14px; padding: 18px 22px; min-width: 360px;
        box-shadow: 0 0 24px #f6c84b33; }
      .fish-admin-card h3 { margin: 0 0 12px 0; color: #f6c84b;
        letter-spacing: 1.5px; font-size: 16px; }
      .fish-admin-card .row { display: flex; gap: 8px; align-items: center;
        margin: 8px 0; }
      .fish-admin-card .row.buttons { flex-wrap: wrap; }
      .fish-admin-card label { font-size: 12px; color: #cfe6ff; min-width: 90px; }
      .fish-admin-card input[type=number] { flex: 1; background: #0a0f1c;
        border: 1px solid #2d3b58; color: #ece6ff; padding: 5px 8px;
        border-radius: 6px; font-size: 13px; min-width: 0; }
    `;
    const tag = document.createElement('style');
    tag.id = 'fish-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }
})();
