// ---------------------------------------------------------------------------
// Demo-only hardcoded planner outputs.
//
// We bypass the LLM planner for the specific Anish + Andrew demo pair so the
// session is fully deterministic across demo runs:
//   - Stitch 1: Andrew teaches Anish on "Time vs. Space Complexity"      (peer_teach)
//   - Stitch 2: Both learn "Analyzing Loops & Recursive Algorithms" together (llm_teach)
//   - Stitch 3: Anish teaches Andrew on "Big-O / Big-Theta / Big-Omega"  (peer_teach)
//
// This guarantees:
//   - Both students alternate teacher/learner roles (showing both directions
//     of the matching algorithm in one session)
//   - Each does a quiz where they're the learner
//   - One shared LLM-taught topic so judges see all three stitch modes
//   - No Gemini quota burn for the demo flow
//
// Gated entirely on member IDs, so any other pair still goes through the
// real LLM planner.
// ---------------------------------------------------------------------------

import { PlannerStitch } from "./spaces";

const ANISH_ID = "ee70c391-82a2-43ff-8c59-d219c3113332";
const ANDREW_ID = "18869d24-d31c-4710-9969-8b3c79b8d1c0";

const SUB_TIME_VS_SPACE = "b5f6a3cd-31fd-40bd-ab7f-7995cbfee2fc";
const SUB_ANALYZING_LOOPS = "1cbd7e35-459d-4a4c-9c7c-f7facd82e5a4";
const SUB_BIG_O = "72735154-11c5-4271-b22b-6ea4b478ddf8";

/** Returns the canned plan for the Anish + Andrew demo pair, or null when
 *  the pair doesn't match — caller falls through to the real LLM planner. */
export function getDemoStitches(memberIds: string[]): PlannerStitch[] | null {
  const set = new Set(memberIds);
  if (set.size !== 2) return null;
  if (!set.has(ANISH_ID) || !set.has(ANDREW_ID)) return null;
  return DEMO_STITCHES;
}

// ---------------------------------------------------------------------------
// Canned hints + explanations for the demo questions.
//
// Why: chat-actions.ts (getQuizHint, getQuizFeedback) calls Gemini for every
// hint and every quiz submission. Free-tier flash-lite caps at 20 calls/day,
// which a single demo session can blow through. For the 9 known demo
// questions we short-circuit Gemini entirely and return these canned strings,
// so demos never depend on remaining quota.
//
// Indexed by subconceptId → array of { hint, explanationRight, explanationWrong }
// in the same order as the questions in DEMO_STITCHES.
// ---------------------------------------------------------------------------

interface DemoQuestionAnnotations {
  hint: string;
  /** Shown when the student picked the right answer. */
  explanationRight: string;
  /** Shown when they picked anything else. */
  explanationWrong: string;
}

const DEMO_ANNOTATIONS: Record<string, DemoQuestionAnnotations[]> = {
  // Time vs. Space Complexity Trade-offs
  [SUB_TIME_VS_SPACE]: [
    {
      hint: "Think about both ends of the trade-off — when is the extra memory cheap, and when is it expensive?",
      explanationRight:
        "Right — small one-shot calls don't justify the memory overhead, and embedded hardware can't afford it either, so both situations make the rewrite a bad call.",
      explanationWrong:
        "The rewrite is a bad idea in BOTH cases — embedded hardware is memory-constrained AND a one-shot call on small n won't recoup the extra space. The correct answer covers both situations.",
    },
    {
      hint: "Memoization is the canonical example of trading one resource for another. Which two resources?",
      explanationRight:
        "Exactly — memoization stores subproblem results in memory so you don't recompute them. More space, fewer recomputations.",
      explanationWrong:
        "Memoization caches subproblem results in extra memory so you skip redundant recomputations. It's the textbook 'spend space to save time' trade-off.",
    },
    {
      hint: "Which option uses no auxiliary data structures whatsoever?",
      explanationRight:
        "Right — two pointers walk the array in place. No hash set, no memo table, no prefix-sum array. Pure O(1) extra space.",
      explanationWrong:
        "Two pointers is the only option that uses zero auxiliary structures. The others (hash set, memo table, prefix sums) all allocate O(n) extra space.",
    },
  ],

  // Analyzing Loops and Recursive Algorithms
  [SUB_ANALYZING_LOOPS]: [
    {
      hint: "Count the total iterations: 1 + 2 + 3 + ... + n. What does that sum to?",
      explanationRight:
        "Correct — the inner loop runs i times, so the total work is 1+2+...+n = n(n+1)/2, which is Θ(n²).",
      explanationWrong:
        "The inner loop runs i times for each outer i, so total iterations = 1+2+...+n = n(n+1)/2 ≈ n²/2 → O(n²). The triangular shape is what gives away the n² growth.",
    },
    {
      hint: "Binary search halves the search space each step. What kind of recurrence is that?",
      explanationRight:
        "Right — binary search throws away half the array per call and does O(1) work to compare, giving T(n) = T(n/2) + O(1), which solves to O(log n).",
      explanationWrong:
        "Binary search recurses on HALF the array (T(n/2)) and does O(1) work per call to compare. T(n) = T(n/2) + O(1) is the canonical log-n recurrence.",
    },
    {
      hint: "When the counter doubles, how many doublings can you do before exceeding n?",
      explanationRight:
        "Exactly — doubling from 1 to n takes log₂(n) steps, so the loop runs O(log n) times.",
      explanationWrong:
        "Each iteration multiplies i by 2, so after k steps i = 2^k. Solving 2^k = n gives k = log₂(n) → O(log n) iterations. Doubling is always a log-time pattern.",
    },
  ],

  // Big-O, Big-Theta, and Big-Omega Notation
  [SUB_BIG_O]: [
    {
      hint: "Big-O is an upper bound. Big-Theta means the function grows EXACTLY at that rate, not slower.",
      explanationRight:
        "Right — Θ(n²) would mean linear search's runtime grows at the n² rate, but it actually grows linearly. The other three are all valid (loose) bounds.",
      explanationWrong:
        "Θ(n²) is the wrong claim because Theta is a TIGHT bound — it would mean linear search grows at the n² rate, but it grows linearly. The other three statements are all (loose but valid) bounds on a linear algorithm.",
    },
    {
      hint: "Drop the constants and lower-order terms. What's left?",
      explanationRight:
        "Right — drop the constants (3, 7, 100) and the lower-order n term, and you're left with n². Theta because it's both an upper and lower bound.",
      explanationWrong:
        "Strip constants and lower-order terms from 3n² + 7n + 100 and you're left with n². Theta(n²) is the tightest correct bound — Big-O(n²) would also be true, but Theta is tighter.",
    },
    {
      hint: "Big-O claims an upper bound. Is n log n upper-bounded by n²?",
      explanationRight:
        "Right — Θ(n log n) implies the function is bounded above by any function that grows at least as fast as n log n, including n².",
      explanationWrong:
        "If a function is Θ(n log n), it's also O(n²) because n log n grows slower than n² — Big-O is just an upper bound, and any larger function is a valid (loose) upper bound. The other options are wrong: O(n) is too tight, Ω(n²) is too strong, and Θ(n) contradicts Θ(n log n).",
    },
  ],
};

/** Lookup a canned hint for a demo question. Returns null when the
 *  subconcept isn't a demo subconcept or the index is out of range —
 *  caller falls through to the real Gemini hint path. */
export function getDemoHint(
  subconceptId: string,
  questionIdx: number
): string | null {
  const arr = DEMO_ANNOTATIONS[subconceptId];
  if (!arr) return null;
  return arr[questionIdx]?.hint ?? null;
}

/** Lookup canned per-question explanations for a full demo quiz. Returns
 *  null when the subconcept isn't part of the demo plan or the array
 *  length doesn't match — caller falls through to Gemini. */
export function getDemoExplanations(
  subconceptId: string,
  grades: boolean[]
): string[] | null {
  const arr = DEMO_ANNOTATIONS[subconceptId];
  if (!arr) return null;
  if (arr.length !== grades.length) return null;
  return grades.map((right, i) =>
    right ? arr[i].explanationRight : arr[i].explanationWrong
  );
}

const DEMO_STITCHES: PlannerStitch[] = [
  // -------------------------------------------------------------------------
  // Stitch 1 — Andrew teaches Anish: Time vs. Space Complexity Trade-offs
  // -------------------------------------------------------------------------
  {
    subconceptId: SUB_TIME_VS_SPACE,
    mode: "peer_teach",
    teacherUserId: ANDREW_ID,
    learnerUserIds: [ANISH_ID],
    teachContent:
      "Walk Anish through how programmers trade memory for speed. Use the classic example: caching results in a hash map (extra space) to avoid recomputation (saved time). Cover when the trade-off is worth it (slow operations, repeated calls) vs when it's not (memory-constrained systems, one-shot computations). Use your snippet panel as your guide.",
    questions: [
      {
        prompt:
          "An algorithm runs in O(n²) time using O(1) extra space. You can rewrite it to run in O(n) time using O(n) extra space. When is this rewrite generally a bad idea?",
        choices: [
          "When n is large and the function is called many times",
          "When you're running on a memory-constrained device like an embedded sensor",
          "When the algorithm is called only once and n is small",
          "Both B and C",
        ],
        correctIndex: 3,
      },
      {
        prompt:
          "Memoization in dynamic programming is a classic time-vs-space trade-off. What does it actually trade?",
        choices: [
          "More CPU cycles for less memory usage",
          "More memory for fewer redundant recomputations",
          "Less code complexity for more runtime",
          "Better cache locality for higher disk I/O",
        ],
        correctIndex: 1,
      },
      {
        prompt:
          "Which of the following is a pure time optimization that does NOT require additional space beyond O(1)?",
        choices: [
          "Building a hash set of seen values to detect duplicates in O(n)",
          "Using two pointers to find a pair summing to a target in a sorted array",
          "Memoizing recursive calls in a top-down DP",
          "Precomputing prefix sums to answer range queries in O(1)",
        ],
        correctIndex: 1,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Stitch 2 — LLM teaches both: Analyzing Loops and Recursive Algorithms
  // -------------------------------------------------------------------------
  {
    subconceptId: SUB_ANALYZING_LOOPS,
    mode: "llm_teach",
    learnerUserIds: [ANISH_ID, ANDREW_ID],
    teachContent:
      "When you analyze a loop, you count how many times the loop body runs as a function of input size n. A single loop from 0 to n is O(n). Nested loops multiply: a loop inside a loop, both running n times, is O(n²). For recursive algorithms, you write a recurrence that describes the work done at each call. T(n) = T(n-1) + O(1) describes simple linear recursion → O(n). T(n) = 2·T(n/2) + O(n) describes merge sort's split-and-combine pattern → O(n log n) by the Master Theorem. The trick is to identify the loop's growth pattern (additive vs multiplicative) and the recursion's branching factor (how many subproblems × how big each one is).",
    questions: [
      {
        prompt:
          "What is the time complexity of this loop?\n\nfor i = 1 to n:\n    for j = 1 to i:\n        print(i, j)",
        choices: ["O(n)", "O(n log n)", "O(n²)", "O(2^n)"],
        correctIndex: 2,
      },
      {
        prompt:
          "Which recurrence describes binary search on a sorted array of length n?",
        choices: [
          "T(n) = T(n-1) + O(1)",
          "T(n) = T(n/2) + O(1)",
          "T(n) = 2·T(n/2) + O(n)",
          "T(n) = T(n-1) + O(n)",
        ],
        correctIndex: 1,
      },
      {
        prompt:
          "A loop counter doubles each iteration: i = 1, 2, 4, 8, ..., n. How many iterations does it run?",
        choices: ["O(n)", "O(log n)", "O(√n)", "O(n / 2)"],
        correctIndex: 1,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Stitch 3 — Anish teaches Andrew: Big-O, Big-Theta, and Big-Omega
  // -------------------------------------------------------------------------
  {
    subconceptId: SUB_BIG_O,
    mode: "peer_teach",
    teacherUserId: ANISH_ID,
    learnerUserIds: [ANDREW_ID],
    teachContent:
      "Walk Andrew through what each Greek letter actually claims. Big-O = upper bound (\"grows no faster than\"). Big-Omega = lower bound (\"grows no slower than\"). Big-Theta = tight bound (both). The key intuition: O is what most engineers say casually but it's the WEAKEST claim. Theta is the strongest. Use the snippet panel for the formal definitions, then test his intuition with a concrete example like linear search (Theta(n) worst case, but only O(n) for the best case).",
    questions: [
      {
        prompt:
          "Linear search on an unsorted array. Which statement about its runtime is WRONG?",
        choices: [
          "It is O(n²) — true because n grows no faster than n²",
          "It is O(n) — true and tight",
          "It is Θ(n²) — true because n is always proportional to n²",
          "It is Ω(1) — true because every algorithm takes at least constant time",
        ],
        correctIndex: 2,
      },
      {
        prompt:
          "An algorithm has runtime T(n) = 3n² + 7n + 100. Which of the following is the TIGHTEST correct bound?",
        choices: ["O(n)", "Θ(n²)", "Ω(n³)", "O(n log n)"],
        correctIndex: 1,
      },
      {
        prompt:
          "An algorithm runs in Θ(n log n). Which of the following statements is also true?",
        choices: [
          "It runs in O(n) — because n grows slower than n log n",
          "It runs in Ω(n²) — because n² is a valid lower bound",
          "It runs in O(n²) — because n log n grows no faster than n²",
          "It runs in Θ(n) — because Θ(n log n) implies Θ(n)",
        ],
        correctIndex: 2,
      },
    ],
  },
];
