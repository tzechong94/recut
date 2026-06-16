# Recut — Eval Report

## Recipe quality (the scored technical artifact)
| metric | value |
|---|---|
| shots detected | 7 / 7 expected (match) |
| beats detected | 7 / 7 expected (match) |
| slot-type accuracy | 100% |
| beat-label accuracy | 100% |
| **overall score** | **100%** |

## Token budget (the headline)
| metric | value |
|---|---|
| **your real footage** | **61%** of the cut (14s / 23s) |
| generated | 9s |
| stand-in remaining | 0s |
| tokens spent | 5,900 |
| naive full-generation baseline | 32,100 |
| **tokens saved** | **26,200 (82% cheaper)** |

## Experience
| metric | value |
|---|---|
| time-to-first-playable-cut | 0.03 ms |

_Generation is gap-fill only: the creator's footage is the spine, AI fills the gaps for
kept slots only. That's the token discipline — and the whole point._
