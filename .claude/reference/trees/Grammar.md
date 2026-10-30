# Grammar

## Description

A species' L-system is a parametric, stochastic, bracketed grammar: an axiom and a set of production rules, rewritten a fixed number of iterations, then read by a 3D turtle to build the branch skeleton.

## Alphabet

- F(l) draws a branch segment of length l and moves the turtle forward.
- f(l) moves forward without drawing.
- A and B are apices; they draw nothing and exist only to be rewritten.
- "+" and "-" turn (yaw) by the species angle or a given one.
- "&" and "^" pitch down and up.
- "<" and ">" roll left and right.
- "|" turns around 180 degrees.
- "!" multiplies the current radius by the species radius decay (the drawn radii follow the pipe model: [Turtle](#turtle)).
- "[" pushes the turtle state and starts a child branch, one branch order deeper; "]" pops it.
- L places a leaf cluster at the turtle's position and orientation.
- T(e) sets the tropism strength of the current branch and every branch grown from it, so a willow's shoots hang and a poplar's limbs stay upright while the trunk grows straight.

## Rules

- A rule has a predecessor symbol, an optional condition on its parameters, a successor and a probability. The probabilities of the rules sharing a predecessor sum to 1.
- Successor parameters are arithmetic on the predecessor's parameters and species constants.
- Rewriting stops at the species iteration count, or earlier when the string would exceed the species segment cap.

## Determinism

- Every random choice, in rule selection and in parameter jitter, comes from one seeded PRNG whose seed is the variant seed. The same species definition and seed produce an identical skeleton on every platform and every run.
- The PRNG is a fixed integer algorithm owned by the tree code, never the language's or engine's default random source.

## Turtle

- The turtle keeps position, an orientation frame, the current radius and the current branch order.
- After each segment its heading bends toward the species tropism vector (gravity or light) by the branch's tropism strength, the species strength unless T changed it.
- Radii follow the pipe model: a segment is as thick as the leaf points it carries, r = tip x w^(1/e), the exponent fitted so the trunk keeps the turtle's radius and every shoot ends at the species' tip radius. Every branch tapers along its length and to a thin tip, and a parent is never thinner than a child leaving it. "!" sets only the trunk's radius this way.

## Skeleton

- The result is a tree of segments, each with start, end, start and end radius, branch order, parent segment and its distance from the root along the branch path.
- Each segment also stores a prune priority: the length times radius of its whole subtree, so the finest twigs have the lowest priority.
- Leaf points carry position, orientation, branch order and the segment they hang from.

## Timing

Derivation and meshing happen when a stage loads, off the main thread, never during a frame.
