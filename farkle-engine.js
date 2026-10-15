/**
 * Farkle scoring engine.
 *
 * Farkle does not have one universal rulebook — "three pairs", "straight",
 * and the 4/5/6-of-a-kind values all vary by the set of house rules a group
 * plays with. The defaults below follow a common / Hasbro-style ruleset.
 * Every value here is configurable from the app's Settings screen.
 *
 * This file works both as a browser <script> (exposes window.FarkleEngine)
 * and as a CommonJS module (for the Node test harness in /test).
 */
(function (global) {
  'use strict';

  const DEFAULT_RULES = {
    singleOne: 100,
    singleFive: 50,
    threeOnesValue: 1000,
    tripleOtherMultiplier: 100, // triple of v (v=2..6) => v * this
    fourKindMode: 'flat', // 'flat' | 'double'
    fourKindFlat: 1000,
    fiveKindFlat: 2000,
    sixKindFlat: 3000,
    straightEnabled: true,
    straightValue: 1500,
    threePairEnabled: true,
    threePairValue: 1000,
    twoTripletsEnabled: true,
    twoTripletsValue: 2500,
    minToGetOnBoard: 500,
    winningScore: 10000,
    finalRoundOnWin: true,
  };

  function mergeRules(rules) {
    return Object.assign({}, DEFAULT_RULES, rules || {});
  }

  function tally(values) {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (const v of values) {
      if (v < 1 || v > 6 || !Number.isInteger(v)) {
        throw new Error('Invalid die value: ' + v);
      }
      counts[v]++;
    }
    return counts;
  }

  function nOfKindPoints(v, k, rules) {
    const base3 = v === 1 ? rules.threeOnesValue : v * rules.tripleOtherMultiplier;
    if (k === 3) return base3;
    if (k === 4) return rules.fourKindMode === 'double' ? base3 * 2 : rules.fourKindFlat;
    if (k === 5) return rules.fourKindMode === 'double' ? base3 * 4 : rules.fiveKindFlat;
    if (k === 6) return rules.fourKindMode === 'double' ? base3 * 8 : rules.sixKindFlat;
    return 0;
  }

  // Best way to score all dice of a single face value v, given count c.
  // Returns { points, used, breakdown: [...] }
  function bestValueScore(v, c, rules) {
    if (c === 0) return { points: 0, used: 0, breakdown: [] };

    if (v === 1 || v === 5) {
      const singleValue = v === 1 ? rules.singleOne : rules.singleFive;
      let best = { points: -1, used: 0, breakdown: [] };
      const groupSizes = [0];
      for (let g = 3; g <= c; g++) groupSizes.push(g);
      for (const g of groupSizes) {
        const remainder = c - g;
        const groupPoints = g > 0 ? nOfKindPoints(v, g, rules) : 0;
        const remainderPoints = remainder * singleValue;
        const points = groupPoints + remainderPoints;
        if (points > best.points) {
          const breakdown = [];
          if (g > 0) {
            breakdown.push({ type: g + '-of-a-kind', face: v, dice: g, points: groupPoints });
          }
          if (remainder > 0) {
            breakdown.push({ type: 'single', face: v, dice: remainder, points: remainderPoints });
          }
          best = { points, used: c, breakdown };
        }
      }
      return best;
    }

    // Values 2, 3, 4, 6 only score in groups of 3+; leftovers are dead dice.
    if (c >= 3) {
      const points = nOfKindPoints(v, c, rules);
      return {
        points,
        used: c,
        breakdown: [{ type: c + '-of-a-kind', face: v, dice: c, points }],
      };
    }
    return { points: 0, used: 0, breakdown: [] };
  }

  function isStraight(counts) {
    for (let v = 1; v <= 6; v++) if (counts[v] !== 1) return false;
    return true;
  }

  function isThreePair(counts) {
    let pairCount = 0;
    for (let v = 1; v <= 6; v++) {
      if (counts[v] === 2) pairCount++;
      else if (counts[v] !== 0) return false;
    }
    return pairCount === 3;
  }

  function isTwoTriplets(counts) {
    let tripleCount = 0;
    for (let v = 1; v <= 6; v++) {
      if (counts[v] === 3) tripleCount++;
      else if (counts[v] !== 0) return false;
    }
    return tripleCount === 2;
  }

  /**
   * Compute the maximum possible Farkle score for a given set of rolled
   * dice values (1-6 each), under the supplied (or default) house rules.
   *
   * Returns:
   *  {
   *    score: number,
   *    usedCount: number,        // dice that contributed to the score
   *    leftoverCount: number,    // dice that scored nothing (dead this throw)
   *    farkle: boolean,          // true if score === 0 (bust)
   *    hotDice: boolean,         // true if every rolled die scored
   *    breakdown: [{ type, face?, dice, points }]
   *  }
   */
  function scoreRoll(diceValues, rules) {
    rules = mergeRules(rules);
    if (!Array.isArray(diceValues) || diceValues.length === 0) {
      throw new Error('scoreRoll requires a non-empty array of die values');
    }
    const counts = tally(diceValues);
    const n = diceValues.length;

    const candidates = [];

    if (n === 6) {
      if (rules.straightEnabled && isStraight(counts)) {
        candidates.push({
          score: rules.straightValue,
          usedCount: 6,
          breakdown: [{ type: 'straight', dice: 6, points: rules.straightValue }],
        });
      }
      if (rules.threePairEnabled && isThreePair(counts)) {
        candidates.push({
          score: rules.threePairValue,
          usedCount: 6,
          breakdown: [{ type: 'three-pairs', dice: 6, points: rules.threePairValue }],
        });
      }
      if (rules.twoTripletsEnabled && isTwoTriplets(counts)) {
        candidates.push({
          score: rules.twoTripletsValue,
          usedCount: 6,
          breakdown: [{ type: 'two-triplets', dice: 6, points: rules.twoTripletsValue }],
        });
      }
    }

    // General per-value decomposition (always computed; works for any n).
    let generalScore = 0;
    let generalUsed = 0;
    let generalBreakdown = [];
    for (let v = 1; v <= 6; v++) {
      const r = bestValueScore(v, counts[v], rules);
      generalScore += r.points;
      generalUsed += r.used;
      generalBreakdown = generalBreakdown.concat(r.breakdown);
    }
    candidates.push({ score: generalScore, usedCount: generalUsed, breakdown: generalBreakdown });

    // Pick the best candidate; tie-break on using more dice (helps hot dice).
    let best = candidates[0];
    for (const c of candidates.slice(1)) {
      if (c.score > best.score || (c.score === best.score && c.usedCount > best.usedCount)) {
        best = c;
      }
    }

    return {
      score: best.score,
      usedCount: best.usedCount,
      leftoverCount: n - best.usedCount,
      farkle: best.score === 0,
      hotDice: best.usedCount === n && best.score > 0,
      breakdown: best.breakdown,
    };
  }

  const FarkleEngine = { DEFAULT_RULES, mergeRules, scoreRoll, tally };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FarkleEngine;
  }
  if (typeof global !== 'undefined') {
    global.FarkleEngine = FarkleEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
