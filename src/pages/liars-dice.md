---
layout: ../layouts/Layout.astro
title: "Liar's Dice Approach"
description: "An overview of a CFR-based two-player Liar's Dice bot."
---

> Note: This page was written entirely by Claude and is provided for informational purposes only.

# Liar's Dice Approach

This project uses CFR as the main engine for a two-player Liar's Dice bot. The
overall plan was to solve tractable abstractions of the game with tabular CFR,
train a neural net from those CFR targets, and use the neural net to evaluate
cutoff states during depth-limited search at play time.

At a move, the bot rebuilds its belief over private hands from the public
history, solves a limited lookahead game from the current state, uses the neural
net at the leaves of that lookahead, and samples from the solved root strategy.

## CFR in Brief

Counterfactual regret minimization is an iterative method for solving imperfect
information games. Instead of trying to pick one best action at each state, it
tracks how much better each legal action would have been in hindsight, weighted
by the probability of reaching that information set. Those accumulated regrets
define the next strategy: actions with positive regret get more probability,
and actions with no positive regret are usually mixed uniformly.

Over many iterations, CFR averages the strategies it played along the way. In
two-player zero-sum games, that average strategy approaches a Nash equilibrium
under the modeled rules. For Liar's Dice, this is a natural fit because players
act with hidden private dice and only see the public bid history.

## Game Model

The target game is two-player Liar's Dice with five dice per player and six
faces. Each player sees only their own dice. Public actions are increasing bids
and challenge. Ones are wild and are also valid bid faces.

The hidden state is small enough to enumerate exactly: each player's private
hand is one of 252 possible dice multisets. The hard part is the public game
tree. A full tabular solve of the production game is too large, so the project
uses public abstractions while keeping exact private hands.

## First Tabular CFR Approach: Claim Buckets

The first production-scale tabular approach summarized the public history in
terms of claims made by each player. It preserved the exact current bid, then
kept a compact summary of the strongest claims made earlier.

This made the table small enough to train while preserving the most important
signals for bidding and calling:

- the current legal action set,
- the acting player's exact private hand,
- recent or strong claims by each side,
- per-hand action values from CFR.

The benefit was speed and scale. It produced a usable average strategy and
per-hand values that could train the neural net. It was also a good way to
learn the engineering requirements of large CFR tables: stable regret updates,
checkpointing, reach weighting, and extracting policy targets.

The cost was that the abstraction was not a clean public game state. It merged
some histories that should remain distinct. That makes the resulting strategy a
strategy for the abstraction, not for exact Liar's Dice. It is still useful
training signal, but its exploitability and values should be read as abstract
metrics.

## Sidebar: Optimization with Triton

One practical lesson from this project is that long chains of PyTorch tensor
ops are often good candidates for custom Triton kernels. CFR has many repeated
patterns where this matters: compute a strategy from regrets, combine it with
reach probabilities, accumulate counterfactual values, update regrets, and add
to the average-policy table. Written directly in PyTorch, those steps can turn
into many small launches and extra reads and writes of large tables.

Fusing the hot loops into Triton kernels can give large speedups, often 10x or
more when the baseline is a long sequence of simple PyTorch ops over big CFR
tables. This is much easier to attempt now with LLM assistance, because the
kernel can be developed incrementally from the tensor formula instead of being
written from scratch in one pass.

The important rule is to keep parity tests first. For every custom kernel, keep
a PyTorch reference path and compare shapes, values, edge cases, and convergence
metrics against it. Tests should cover small exact cases, dense and sparse
layouts, CPU/GPU reference agreement where possible, isolated kernel calls, and
repeated CFR iterations. The kernel is only an optimization if it preserves the
solver's numerical behavior well enough for the strategy metrics that matter.

## Second Tabular CFR Approach: Bid Buckets

The second tabular approach used a more structured abstraction of the public bid
track. Instead of summarizing earlier claims by hand-built features, it grouped
concrete bids into ordered buckets and solved the game over those abstract bid
levels.

This kept the abstraction closer to the actual public sequence. It also made
the training targets easier to export: reachable abstract states could be paired
with beliefs, per-hand values, and average-policy action probabilities.

Compared with the claim-bucket table, this approach was easier to reason about
as a game. It kept exact private hands, preserved the order of bidding, and
provided better data for the neural net.

The tradeoff was bid distortion. Several concrete bids can share an abstract
bucket, so the table has to pick representative concrete actions when exporting
policy targets. This means the neural net inherits some approximation error
from the bucket design.

## Neural Net Trained from CFR

The neural net is trained to approximate CFR-derived values and, when available,
CFR average policies. Its input is a compact public belief state:

- the last public bid,
- which player is acting,
- each player's belief distribution over the 252 private hands.

The value head predicts per-hand values for the acting player and opponent. The
policy head predicts action logits for each possible private hand.

The value target is the main piece needed at runtime. During depth-limited CFR,
the solver reaches cutoff states where it cannot expand the rest of the game.
The value net estimates the continuation value at those states, allowing the
root search to use more accurate leaf values than a hand-written heuristic.

The policy target is mainly distillation. It helps the model learn the shape of
the tabular CFR strategy, and it can provide a useful prior, but the runtime bot
still re-solves the current subgame.

## Direct Pretraining

Direct pretraining means fitting the neural net directly to rows exported from a
tabular CFR run.

For each sampled abstract public state, the training data contains the belief
state, per-hand value targets, and a policy target from the tabular average
strategy. Training then becomes straightforward supervised learning.

This works well as initialization. It is stable, fast compared with online
self-play, and gives the network a broad view of the table. The weakness is
distribution mismatch. The model is learning from abstract table states, while
the deployed bot sees concrete histories and re-solved lookahead games.

## Tabular-Backed Self-Play Pretraining

Tabular-backed self-play pretraining uses the tabular CFR result differently.
Instead of training directly on exported table rows, it runs depth-limited
self-play solves and uses the tabular values only at the cutoff states.

That produces training examples closer to the runtime loop:

```text
current belief -> depth-limited CFR solve -> tabular leaf values
               -> root value and policy targets
```

This reduces the gap between training and deployment. The examples come from
states created by re-solving, not just from static table rows. The cost is that
it is slower, and the tabular leaf lookup still carries the abstraction error of
the bucketed CFR table.

## Runtime Play

The deployed bot uses the neural net inside a depth-limited CFR search. Each
move follows the same loop:

1. reconstructs beliefs from the public history,
2. builds the current lookahead game,
3. evaluates cutoff states with the neural net,
4. runs CFR under the time budget,
5. samples an action from the root average strategy for its private hand.

The network does not directly choose the move. It supplies leaf values, and CFR
turns those values into a local strategy for the exact current situation.

The submitted bot also used some competition-specific action filtering, such as
blocking very high quantity bids while lower bids remain available and removing
tiny-probability actions before sampling. Those choices were tuned for
head-to-head performance, not derived from equilibrium theory.

## Equilibrium Play in a Win-Rate League

CFR is designed to reduce exploitability. A low-exploitability strategy is hard
to punish by a strong opponent. The league objective is different: maximize
win rate against a field of amateur bots.

Against weak or predictable opponents, balanced play can be too cautious. If an
opponent calls too often, never calls enough, bids deterministically, or uses a
fixed probability threshold, a targeted response can win more than an
equilibrium-style average strategy.

This matters because the leaderboard is not measuring exploitability. It is
measuring finite-sample wins against the submitted field. A robust CFR bot may
avoid large mistakes, but it may also fail to exploit obvious mistakes by the
opponents it actually faces.

Empirical evaluation matters for that reason. The right checkpoint is not
necessarily the one with the best abstract exploitability. It is the one that
wins most reliably against the expected opponent pool under the real time
budget and action interface.

## What I Would Change Next Time

I would add opponent modeling earlier. CFR gives a strong default policy, but a
league bot should also learn common opponent errors and adjust to them.

I would keep depth-limited CFR as the core move generator, then add controlled
exploitation on top. For example, the bot could estimate whether an opponent is
over-calling or under-calling and adjust challenge thresholds and bid aggression
within a bounded range.

I would move sooner from direct table fitting to solve-generated training data.
Direct pretraining is a good start, but the most relevant examples are produced
by the same process the bot uses at runtime: belief reconstruction, subgame
construction, neural leaf evaluation, and root CFR.

I would also tune deployment choices in the same loop as model selection. Time
budget, CFR iteration count, action filters, challenge calibration, and seat
effects all affect league win rate. They should be evaluated against the same
opponent pool used to choose checkpoints.
