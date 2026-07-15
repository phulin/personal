---
title: We don't need no stinkin' tensor library
description: Solving poker in the browser with custom WebGPU kernels
---

# Solving Poker in the Browser with WebGPU

I needed a tensor library for WebGPU. There isn't one, but it doesn't matter. 

For the past year, I've been interested in the state of solvers for poker. For those unfamiliar: a solver finds an approximate Nash equilibrium strategy for any game situation in poker. In practice, they take a "spot", a set of public cards and betting history, and produce an output strategy. Because the strategy approximates an equilibrium, it is provably (up to epsilon) *non-exploitable*: if a player plays a different strategy than your equilibrium, they can't beat you in expectation. 

Commercial solvers have existed for years, but they tend to be quite expensive. I wanted to make an open source, in-browser solver that I could offer for free. Given the compute requirements, I needed to find a way to run the neural net and algorithm in the browser. There are good ways to evaluate models using WebGL or WebGPU, but there is no general tensor-library equivalent of PyTorch[^1].

## Reference Implementations

But this is 2026. We don't need libraries anymore. All I needed was code that produced the same output, quickly, in WebGPU (same function; different platform). I've learned to spot the reference-implementation pattern anywhere: PyTorch is a correctness oracle. So I instructed Codex to build me a set of WebGPU kernels that allowed evaluation of the model and the CFR algorithm, and to confirm parity with the PyTorch reference implementation. It passed the parity tests after a single prompt, so I left it running in a loop overnight to optimize the kernels. With that simple approach, Codex got a greater than 10x speedup on its first attempt—and it also flagged that I needed to switch the models' activation function for performance. 

![The original prompt asking Codex to create the custom kernels](<./Pasted image 20260715141729.png>)

To first order, libraries exist because writing correct, fast, well-architected code is expensive, so we amortize that cost across thousands of users and accept the abstraction penalties that come with generality. If generation is cheap and verifiable, that tradeoff can flip: a custom kernel that does exactly your computation can beat a general library. As [others have noted](https://simonwillison.net/2025/Dec/15/porting-justhtml/), a test suite you trust to exercise all relevant behavior can be better than a specification in the LLM era.

## In Practice

I wrote the first implementation of the CFR algorithm last fall, largely manually. At that point, the LLMs were really only useful for bug-hunting and enhanced-Google; they struggled to generate code that worked, let alone code I actually wanted to commit. On this task, they simply couldn't write working kernels for nonstandard, complex operations. Now, since this task has a verifiable reward, I could leave the LLM running for three days and it essentially just finished whatever I asked it to do.

Library and language choice are less binding than ever, but that doesn't mean you can write one prompt and get a working, complex system. This project still took me months and required days of work supervising LLM coding and experiments.

The solver is available at [holdem.computer](https://holdem.computer), and the code is all available at https://github.com/phulin/poker2.

[^1]: There is a TensorFlow project called TFJS, but it seems to be largely abandoned, does not support several primitive operations I needed, and in testing was quite slow.

### Postscript

I did most of this work while a participant at the [Recurse Center](https://recurse.com), a retreat for programmers in NYC and one of my favorite places in the world. If you're wondering whether to apply, you should!
### Appendix

Equilibrium solving relies on a search-style algorithm called [counterfactual regret minimization](https://www.ma.imperial.ac.uk/~dturaev/neller-lanctot.pdf). Traditional solvers come with giant tables of strategies and expected values in different spots; they use abstraction to collapse similar spots into one bucket. A more modern approach instead  "re-solves" each spot to a limited search depth and uses a neural network as an approximation function at the depth cutoff. Both tabular (e.g. Piosolver) and neural (e.g. GTOWizard) commercial solvers are available.

This project combined methods from different papers in the academic literature. In particular, I found [DeepStack](https://arxiv.org/abs/1701.01724) and [ReBeL](https://arxiv.org/abs/2007.13544) to be very helpful, but there are too many papers I relied on to list here.

The live model is not the strongest poker solver out there, and it only supports two-player ("heads-up") play. I'd need more GPU time for the underlying model to become a really strong player, as it has probably been trained with 100x less compute than models in the academic literature.
