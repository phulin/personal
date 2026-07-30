---
title: We don't need no stinkin' tensor library
description: Solving poker in the browser with custom WebGPU kernels
date: 2026-07-30T14:16:04Z
---

# Solving Poker with Custom WebGPU

Have coding agents gotten good enough that we don't need libraries anymore? This post recounts one case in which the answer is "we don't": I needed a tensor library to run my poker model in WebGPU. The library I wanted did not exist. It turned out I did not need it.

## Background

For the past year, I've been interested in the state of solvers for poker. For those unfamiliar: a solver finds an approximate Nash equilibrium strategy for any game situation in poker. In practice, they take a "spot", a set of public cards and betting history, and produce an output strategy. Because the strategy approximates an equilibrium, it is provably (up to epsilon) *non-exploitable*: if a player plays a different strategy than your equilibrium, they can't beat you in expectation. 

Commercial solvers have existed for years, but they tend to be quite expensive. I wanted to make an open source, in-browser solver that I could offer for free. Given the compute requirements, I needed to find a way to run the neural net and algorithm in the browser. There are good ways to evaluate models using WebGL or WebGPU, but there is no general tensor-library equivalent of PyTorch[^1]. I spent months building and testing different models in PyTorch. Even when I was satisfied with the final output running on my computer, there was no way to achieve my goal of serving it in the browser.

## Reference Implementations

But this is 2026. All I needed was code that produced the same output, quickly, in WebGPU (same function; different platform). I've learned to spot the reference-implementation pattern anywhere: [PyTorch is a correctness oracle](https://docs.pytorch.org/devlogs/compiler/2026-07-25-pytorch-a-reference-language/). So I instructed Codex to build me a set of WebGPU kernels that allowed evaluation of the model and the core algorithm, and to confirm parity with the PyTorch reference. It passed the parity tests after a single prompt, so I left it running in a loop overnight to optimize the kernels. With that simple approach, Codex got a greater than 10x speedup over its own naive implementation on its first attempt—and it also flagged that I needed to switch the models' activation function for performance. 

![The original prompt asking Codex to create the custom kernels](<./Pasted image 20260715141729.png>)

To first order, libraries exist because writing correct, fast, well-architected code is expensive, so we amortize that cost across thousands of users and accept the abstraction penalties that come with generality. If generation is cheap and verifiable, that tradeoff can flip: in this case, a custom kernel that does exactly my computation can beat a general library. As [others have noted](https://simonwillison.net/2025/Dec/15/porting-justhtml/), a test suite you trust to exercise all relevant behavior can be better than a specification in the LLM era.

This does not work everywhere. The computation has to be well defined, the reference implementation has to be trustworthy, and the tests have to capture the behavior that matters.

## In Practice

Equilibrium solving relies on a search-style algorithm called [counterfactual regret minimization (CFR)](https://www.ma.imperial.ac.uk/~dturaev/neller-lanctot.pdf). Traditional solvers come with giant tables of strategies and expected values in different spots; they use a technique called abstraction to collapse similar spots into one bucket. A more modern approach instead  "re-solves" each spot to a limited search depth and uses a neural network as an approximation function at the depth cutoff. Both tabular (e.g. Piosolver) and neural (e.g. GTOWizard) commercial solvers are available.

I wrote the first implementation of the CFR algorithm last fall, largely manually. At that point, the LLMs were really only useful for bug-hunting and enhanced Google. They struggled to generate code that worked, let alone code I actually wanted to commit. Even on eager PyTorch code, they would regularly introduce for loops to iterate over tensors (a huge no-no). And when I tried to make custom kernels, they simply couldn't do it for nonstandard, complex operations.

Many months later, the situation is much different. The models do not always write perfect code the first time, but now they can usually implement an entire paper correctly from scratch. I can ask the agent to survey the literature for CFR variants, implement them, and compare performance. It can autonomously run short-run trials to optimize hyperparameters and derive basic scaling laws. All the things I deferred last fall because they weren't on the critical path to a working model can now just get done. On the WebGPU task in particular, the verifiable reward meant I could leave the LLM running for hours (days) until it produced what I wanted. 

Even though agents are now writing essentially all my code, I am still the planning and judgment layer on top—in my experiments, the models don't have that capability yet. This project still took me months of work supervising LLM coding and experiments. Put another way, I'm delegating more and more to the agents, but they still struggle to decide what to build.

## Conclusion

Library and language choice are less binding than ever. An extension of this principle: [rewrites are no longer the forbidden fruit](https://simonwillison.net/2026/Jul/8/rewriting-bun-in-rust/).

The solver is available at [holdem.computer](https://holdem.computer), and the code is all available at https://github.com/phulin/poker2.

[^1]: There is a TensorFlow project called TFJS, but it seems to be largely abandoned, does not support several primitive operations I needed, and in testing was quite slow.

### Postscript

I did most of this work while a participant at the [Recurse Center](https://recurse.com), a retreat for programmers in NYC and one of my favorite places in the world. If you're wondering whether to apply, you should!

This project combined methods from different papers in the academic literature. In particular, I found [DeepStack](https://arxiv.org/abs/1701.01724) and [ReBeL](https://arxiv.org/abs/2007.13544) to be very helpful, but there are too many papers I relied on to list here.

The live model is not the strongest poker solver out there, and it only supports two-player ("heads-up") play. It is also missing commercial-solver features like "node locking" (which tells you how to exploit a non-equilibrium strategy from your opponent). I'd need more GPU time for the underlying model to become a really strong player, as it has probably been trained with 100x less compute than models in the academic literature.
