# antislop attribution

Upstream: [miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop), distributed as `antislop-ai` on npm. Copyright (c) 2026 Miqdad Badjuber. Licensed under MIT; see [LICENSE](LICENSE).

The `skills/` files preserve the project's installed upstream skill snapshot as source reference. These documents are not executed, and Rexbot does not run the npm installer or modify the owner's agent configuration at runtime.

Rexbot's default system prompt includes an adapted, compact version of all 38 core rules, plus accessibility, responsive layout, copy, and comment guidance, in `packages/shared/src/prompt/antislop.ts`. Installation prompts and agent-specific setup instructions are intentionally excluded from the runtime prompt. Rexbot's owner selected filtering during work. The user can supply task-specific design direction as usual.

This is prompt guidance, not a guarantee that a configured model will follow every rule. The surrounding Rexbot application remains AGPL-3.0-only; the upstream materials retain their MIT license.
